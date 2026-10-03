//! Local image customization. Independent of chat runtime, database and secrets.
mod assets;
mod provider;
mod storage;

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

const KINDS: [&str; 4] = ["base", "closed", "happy", "talk"];
#[derive(Clone, Serialize, Deserialize)]
pub struct Asset {
    pub width: u32,
    pub height: u32,
    pub anchor_x: u32,
    pub anchor_y: u32,
    #[serde(default)]
    pub connector_x: Option<u32>,
    #[serde(default)]
    pub connector_y: Option<u32>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Preset {
    #[serde(default)]
    pub theme: Option<Theme>,
    #[serde(default)]
    pub colors: Vec<String>,
    #[serde(default)]
    pub colors_version: u8,
    pub id: String,
    pub name: String,
    pub accent: String,
    pub created_at: String,
    pub assets: BTreeMap<String, Asset>,
    #[serde(default)]
    pub badge: Option<String>,
}
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Theme {
    pub palette: String,
    pub primary: String,
    pub secondary: String,
    pub strength: u8,
}
impl Theme {
    fn validate(&self) -> Result<(), String> {
        if ![
            "character",
            "apricot",
            "rose",
            "mint",
            "sky",
            "lilac",
            "custom",
        ]
        .contains(&self.palette.as_str())
            || self.strength > 100
        {
            return Err("主题搭配或色彩浓度无效".into());
        }
        storage::accent(&self.primary)?;
        storage::accent(&self.secondary)?;
        Ok(())
    }
    fn character(colors: &[String], fallback: &str) -> Self {
        Self {
            palette: "character".into(),
            primary: colors.first().cloned().unwrap_or_else(|| fallback.into()),
            secondary: colors.get(1).cloned().unwrap_or_else(|| "#d49b98".into()),
            strength: 65,
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
pub struct JobView {
    pub id: String,
    pub name: String,
    pub status: String,
    pub stage: String,
    pub completed: Vec<String>,
    pub request_count: u32,
    pub error: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Job {
    view: JobView,
    references: usize,
    #[serde(default)]
    attempt: u64,
    #[serde(default)]
    badge: Option<String>,
}
#[derive(Clone, Default, Serialize, Deserialize)]
struct Settings {
    base_url: String,
    model: String,
    key_account: Option<String>,
}
#[derive(Clone, Serialize)]
pub struct SettingsView {
    base_url: String,
    model: String,
    has_key: bool,
}
#[derive(Clone, Serialize)]
pub struct View {
    revision: u64,
    active_id: String,
    presets: Vec<Preset>,
    job: Option<JobView>,
    badge_job: Option<BadgeJob>,
    settings: SettingsView,
    warning: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Store {
    version: u32,
    revision: u64,
    active_id: String,
    presets: Vec<Preset>,
    job: Option<Job>,
    #[serde(default)]
    badge_job: Option<BadgeJob>,
    settings: Settings,
    warning: Option<String>,
}
impl Default for Store {
    fn default() -> Self {
        Self {
            version: 1,
            revision: 0,
            active_id: "default".into(),
            presets: vec![],
            job: None,
            badge_job: None,
            settings: Settings::default(),
            warning: None,
        }
    }
}
impl Store {
    fn view(&self) -> View {
        View {
            revision: self.revision,
            active_id: self.active_id.clone(),
            presets: self.presets.clone(),
            job: self.job.as_ref().map(|j| j.view.clone()),
            badge_job: self.badge_job.clone(),
            settings: SettingsView {
                base_url: self.settings.base_url.clone(),
                model: self.settings.model.clone(),
                has_key: self.settings.key_account.is_some(),
            },
            warning: self.warning.clone(),
        }
    }
    fn running(&self) -> bool {
        self.badge_job
            .as_ref()
            .is_some_and(|j| j.status == "running")
            || self
                .job
                .as_ref()
                .is_some_and(|j| j.view.status == "running")
    }
}
#[derive(Default)]
struct Inner {
    store: Option<Store>,
    cancel: Option<tokio::sync::watch::Sender<bool>>,
    badge_cancel: Option<tokio::sync::watch::Sender<bool>>,
}
#[derive(Default, Clone)]
pub struct CustomizationState {
    inner: Arc<Mutex<Inner>>,
    geometry: Arc<Mutex<Option<Asset>>>,
}

pub fn active_geometry(app: &AppHandle) -> Option<Asset> {
    app.state::<CustomizationState>()
        .geometry
        .lock()
        .ok()?
        .clone()
}
fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|_| "无法访问定制目录")?
        .join("customization")
        .join("v1"))
}

/// Every filesystem/decode/credential transaction uses the blocking pool.
async fn access<T: Send + 'static>(
    app: AppHandle,
    f: impl FnOnce(&Path, &mut Inner) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = root(&app)?;
        let state = app.state::<CustomizationState>();
        let mut inner = state.inner.lock().map_err(|_| "定制状态不可用")?;
        if inner.store.is_none() {
            inner.store = Some(storage::load(&root)?);
        }
        let result = f(&root, &mut inner);
        let store = inner.store.as_ref().unwrap();
        let geometry = store
            .presets
            .iter()
            .find(|p| p.id == store.active_id)
            .and_then(|p| p.assets.get("base"))
            .cloned();
        if let Ok(mut cached) = state.geometry.lock() {
            *cached = geometry;
        }
        drop(inner);
        result
    })
    .await
    .map_err(|_| "定制后台任务中断")?
}
fn commit(root: &Path, inner: &mut Inner, mut next: Store) -> Result<View, String> {
    next.revision = inner
        .store
        .as_ref()
        .unwrap()
        .revision
        .checked_add(1)
        .ok_or("定制版本超出限制")?;
    storage::save(root, &next)?;
    let view = next.view();
    inner.store = Some(next);
    Ok(view)
}
// Terminal intent must stop the local worker even if the disk becomes unwritable.
// The persisted running job will recover as interrupted on the next launch.
fn terminal_commit(root: &Path, inner: &mut Inner, mut next: Store) -> View {
    match commit(root, inner, next.clone()) {
        Ok(view) => view,
        Err(_) => {
            next.revision = inner.store.as_ref().unwrap().revision.saturating_add(1);
            next.warning = Some(
                "本地任务已停止，但状态未能保存；请检查可用磁盘空间。重启不会自动重发请求".into(),
            );
            let view = next.view();
            inner.store = Some(next);
            view
        }
    }
}
fn publish(app: &AppHandle, mut view: View) -> View {
    if app.emit("customization:changed", &view).is_err() {
        let notification = "窗口通知失败；重新打开面板后会恢复同步";
        view.warning = Some(match view.warning.take() {
            Some(existing) => format!("{existing}；{notification}"),
            None => notification.into(),
        });
    }
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Ok(viewport) = super::panel_viewport(&handle) {
            let _ = handle.emit_to("chat", "pet-panel:viewport-changed", viewport);
        }
    });
    view
}
#[tauri::command]
pub async fn customization_view(app: AppHandle) -> Result<View, String> {
    access(app, |_, inner| Ok(inner.store.as_ref().unwrap().view())).await
}
#[tauri::command]
pub async fn customization_asset(
    app: AppHandle,
    id: String,
    kind: String,
) -> Result<String, String> {
    access(app, move |root, inner| {
        let store = inner.store.as_ref().unwrap();
        let job = store.job.as_ref().filter(|j| j.view.id == id);
        let preset = store.presets.iter().any(|p| p.id == id);
        if (!preset && job.is_none()) || (kind.starts_with("reference-") && job.is_none()) {
            return Err("找不到这个定制资产".into());
        }
        if let Some(token) = kind.strip_prefix("badge-") {
            if !store
                .presets
                .iter()
                .any(|p| p.id == id && p.badge.as_deref() == Some(token))
                && !store.badge_job.as_ref().is_some_and(|j| {
                    j.preset_id == id && j.status == "ready" && j.result.as_deref() == Some(token)
                })
            {
                return Err("找不到这个标志".into());
            }
        }
        let bytes = storage::read(
            &storage::asset_path(root, &id, &kind)?,
            storage::MAX_DISK_IMAGE,
        )?;
        if kind.starts_with("badge-") {
            assets::validate_badge(&bytes)?;
        }
        Ok(assets::data_uri(&bytes))
    })
    .await
}
#[derive(Deserialize)]
pub struct SaveSettings {
    base_url: String,
    model: String,
    api_key: String,
    clear_key: bool,
}
#[tauri::command]
pub async fn customization_save_settings(
    app: AppHandle,
    settings: SaveSettings,
) -> Result<View, String> {
    let view = access(app.clone(), move |root, inner| {
        let mut next = inner.store.as_ref().unwrap().clone();
        if next.running() {
            return Err("请先取消当前生成，再修改图片服务".into());
        }
        let base_url = crate::backend::normalized_url(&settings.base_url, "图片服务地址")?;
        let model = settings.model.trim().to_owned();
        if model.is_empty() || model.len() > 200 || model.chars().any(char::is_control) {
            return Err("请输入有效的图片模型名称".into());
        }
        if settings.api_key.len() > 8192 {
            return Err("图片 API Key 过长".into());
        }
        let old_account = next.settings.key_account.clone();
        let account = if !settings.api_key.trim().is_empty() {
            let id = uuid::Uuid::new_v4().to_string();
            provider::credential(&id)?
                .set_password(settings.api_key.trim())
                .map_err(|_| "无法将图片 API Key 写入系统凭据存储")?;
            Some(id)
        } else if settings.clear_key || base_url != next.settings.base_url {
            None
        } else {
            old_account.clone()
        };
        next.settings = Settings {
            base_url,
            model,
            key_account: account.clone(),
        };
        let result = commit(root, inner, next);
        if result.is_err() {
            if account != old_account {
                if let Some(id) = account {
                    let _ = provider::credential(&id)
                        .and_then(|e| e.delete_credential().map_err(|_| "清理失败".into()));
                }
            }
        } else if account != old_account {
            if let Some(id) = old_account {
                let _ = provider::credential(&id)
                    .and_then(|e| e.delete_credential().map_err(|_| "清理失败".into()));
            }
        }
        result
    })
    .await?;
    Ok(publish(&app, view))
}

// Explicitly authorized copy: credentials never cross the IPC boundary.
fn chat_source(
    inner: &crate::backend::Inner,
) -> Result<(u64, crate::backend::LocalConfig), String> {
    let config = inner.config.as_ref().ok_or("请先配置聊天连接")?;
    if config.mode != crate::backend::Mode::Local {
        return Err("仅单机模式支持使用聊天连接，请先切换到单机模式".into());
    }
    let mut local = config.local.effective();
    local.base_url = crate::backend::normalized_url(&local.base_url, "聊天模型服务地址")?;
    Ok((inner.view.generation, local))
}
fn ensure_chat_source(
    inner: &crate::backend::Inner,
    generation: u64,
    source: &crate::backend::LocalConfig,
) -> Result<(), String> {
    let (current_generation, current) = chat_source(inner)?;
    if current_generation != generation
        || current.base_url != source.base_url
        || current.api_key != source.api_key
    {
        return Err("聊天连接已更换，请重新点击使用聊天连接".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn customization_use_chat_connection(
    app: AppHandle,
    model: String,
) -> Result<View, String> {
    let model = model.trim().to_owned();
    if model.is_empty() || model.len() > 200 || model.chars().any(char::is_control) {
        return Err("请先填写有效的图片模型名称".into());
    }
    let handle = app.clone();
    let view = tauri::async_runtime::spawn_blocking(move || {
        let root = root(&handle)?;
        let state = handle.state::<CustomizationState>();
        let (revision, old_account) = {
            let mut inner = state.inner.lock().map_err(|_| "定制状态不可用")?;
            if inner.store.is_none() {
                inner.store = Some(storage::load(&root)?);
            }
            let store = inner.store.as_ref().unwrap();
            if store.running() {
                return Err("请先取消当前生成，再修改图片服务".into());
            }
            (store.revision, store.settings.key_account.clone())
        };
        let agent = handle.state::<crate::backend::AgentState>();
        let (generation, source) = chat_source(&agent.lock())?;
        // Both locks are released before any OS credential UI can block.
        let key = crate::backend::credentials::load_saved_key(
            &source,
            &crate::backend::credentials::PlatformStore,
        )?;
        if key.trim().is_empty() {
            return Err("聊天连接没有可用密钥，请先保存聊天密钥".into());
        }
        if key.len() > 8192 {
            return Err("聊天 API Key 过长".into());
        }
        let account = uuid::Uuid::new_v4().to_string();
        let entry = provider::credential(&account)?;
        entry
            .set_password(key.trim())
            .map_err(|_| "无法将图片 API Key 写入系统凭据存储")?;
        let result = (|| {
            // Hold source ownership only for the bounded durable commit, never keyring I/O.
            let agent_inner = agent.lock();
            ensure_chat_source(&agent_inner, generation, &source)?;
            let mut inner = state.inner.lock().map_err(|_| "定制状态不可用")?;
            let mut next = inner.store.as_ref().unwrap().clone();
            if next.revision != revision || next.running() {
                return Err("定制设置已变化，请重新点击使用聊天连接".into());
            }
            next.settings = Settings {
                base_url: source.base_url.clone(),
                model,
                key_account: Some(account.clone()),
            };
            commit(&root, &mut inner, next)
        })();
        // Rollback/retirement also happens after both guards are released.
        if result.is_err() {
            let _ = entry.delete_credential();
        } else if let Some(old) = old_account {
            if let Ok(entry) = provider::credential(&old) {
                let _ = entry.delete_credential();
            }
        }
        result
    })
    .await
    .map_err(|_| "复制聊天连接的后台任务中断")??;
    Ok(publish(&app, view))
}

#[tauri::command]
pub async fn customization_start(
    app: AppHandle,
    name: String,
    images: Vec<String>,
) -> Result<View, String> {
    let (view, cancel) = access(app.clone(), move |root, inner| {
        let mut next = inner.store.as_ref().unwrap().clone();
        if next.running() {
            return Err("已有生成进行中，请等待或取消".into());
        }
        if next.settings.base_url.is_empty() || next.settings.model.is_empty() {
            return Err("请先配置图片服务".into());
        }
        let name = storage::name(&name)?;
        let refs = assets::import(&images)?;
        let id = uuid::Uuid::new_v4().to_string();
        for (index, bytes) in refs.iter().enumerate() {
            storage::atomic(
                &storage::asset_path(root, &id, &format!("reference-{index}"))?,
                bytes,
            )?;
        }
        next.job = Some(Job {
            view: JobView {
                id,
                name,
                status: "running".into(),
                stage: "base".into(),
                completed: vec![],
                request_count: 0,
                error: None,
            },
            references: refs.len(),
            attempt: next.revision + 1,
            badge: None,
        });
        let view = commit(root, inner, next)?;
        let (tx, rx) = tokio::sync::watch::channel(false);
        inner.cancel = Some(tx);
        Ok((view, rx))
    })
    .await?;
    let id = view.job.as_ref().unwrap().id.clone();
    launch(app.clone(), id, view.revision, cancel);
    Ok(publish(&app, view))
}
#[tauri::command]
pub async fn customization_cancel(app: AppHandle, id: String) -> Result<View, String> {
    let view = access(app.clone(), move |root, inner| {
        let mut next = inner.store.as_ref().unwrap().clone();
        let job = next
            .job
            .as_mut()
            .filter(|j| j.view.id == id)
            .ok_or("生成任务已改变，请刷新")?;
        if job.view.status != "running" {
            return Ok(next.view());
        }
        job.view.status = "cancelled".into();
        job.view.error =
            Some("已停止本地等待。已发出的请求仍由图片服务计费，继续生成需要手动操作".into());
        let view = terminal_commit(root, inner, next);
        if let Some(cancel) = inner.cancel.take() {
            let _ = cancel.send(true);
        }
        Ok(view)
    })
    .await?;
    Ok(publish(&app, view))
}
#[tauri::command]
pub async fn customization_retry(
    app: AppHandle,
    id: String,
    stage: Option<String>,
) -> Result<View, String> {
    let (view, cancel) = access(app.clone(), move |root, inner| {
        let mut next = inner.store.as_ref().unwrap().clone();
        if next.running() {
            return Err("已有生成进行中，请等待或取消".into());
        }
        if next.active_id == id {
            return Err("请先切换到其他桌宠，再重做这个方案".into());
        }
        if let Some(stage) = &stage {
            if !KINDS.contains(&stage.as_str()) {
                return Err("无效的重做状态".into());
            }
        }
        let mut job = next
            .job
            .clone()
            .filter(|j| j.view.id == id)
            .ok_or("仅可继续最近一次生成；其他方案请重新上传参考图")?;
        if job.view.status == "ready" && stage.is_none() {
            return Err("这个方案已完成，请选择要重做的状态".into());
        }
        // Never overwrite a completed preset when redoing it: keep a durable good copy.
        if next.presets.iter().any(|p| p.id == id) {
            let new_id = uuid::Uuid::new_v4().to_string();
            for kind in KINDS
                .into_iter()
                .map(str::to_owned)
                .chain((0..job.references).map(|i| format!("reference-{i}")))
            {
                let bytes = storage::read(
                    &storage::asset_path(root, &id, &kind)?,
                    storage::MAX_DISK_IMAGE,
                )?;
                storage::atomic(&storage::asset_path(root, &new_id, &kind)?, &bytes)?;
            }
            job.badge = next
                .presets
                .iter()
                .find(|p| p.id == id)
                .and_then(|p| p.badge.clone());
            if let Some(token) = &job.badge {
                let kind = format!("badge-{token}");
                match storage::asset_path(root, &id, &kind)
                    .and_then(|path| storage::read(&path, storage::MAX_DISK_IMAGE))
                {
                    Ok(bytes) if assets::validate_badge(&bytes).is_ok() => {
                        storage::atomic(&storage::asset_path(root, &new_id, &kind)?, &bytes)?
                    }
                    _ => {
                        job.badge = None;
                        next.warning =
                            Some("原标志无法读取，重做方案将使用猫爪；原方案仍保留".into());
                    }
                }
            }
            job.view.id = new_id;
        }
        if let Some(stage) = stage {
            if stage == "base" {
                job.view.completed.clear();
            } else {
                job.view.completed.retain(|k| k != &stage);
            }
        }
        job.view.stage = resume_stage(&job.view.completed).into();
        job.view.status = "running".into();
        job.view.error = None;
        job.attempt = next.revision + 1;
        next.job = Some(job);
        let view = commit(root, inner, next)?;
        let (tx, rx) = tokio::sync::watch::channel(false);
        inner.cancel = Some(tx);
        Ok((view, rx))
    })
    .await?;
    launch(
        app.clone(),
        view.job.as_ref().unwrap().id.clone(),
        view.revision,
        cancel,
    );
    Ok(publish(&app, view))
}
#[tauri::command]
pub async fn customization_activate(app: AppHandle, id: String) -> Result<View, String> {
    let view = access(app.clone(), move |root, inner| {
        let mut next = inner.store.as_ref().unwrap().clone();
        if id != "default" {
            storage::validate_preset(root, &next, &id)?;
        }
        next.active_id = id;
        next.warning = None;
        commit(root, inner, next)
    })
    .await?;
    Ok(publish(&app, view))
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum BadgeUpdate {
    Select { token: String },
    Reset,
}
fn update_preset(
    root: &Path,
    next: &mut Store,
    id: &str,
    name: &str,
    accent: &str,
    badge: Option<BadgeUpdate>,
) -> Result<(), String> {
    let preset = next
        .presets
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or("找不到这个桌宠方案")?;
    preset.name = storage::name(name)?;
    preset.accent = storage::accent(accent)?;
    match badge {
        Some(BadgeUpdate::Select { token }) => {
            if !next.badge_job.as_ref().is_some_and(|j| {
                j.preset_id == id
                    && j.status == "ready"
                    && j.result.as_deref() == Some(token.as_str())
            }) {
                return Err("标志预览已更新，请重新选择生成结果".into());
            }
            let bytes = storage::read(
                &storage::asset_path(root, &id, &format!("badge-{token}"))?,
                storage::MAX_DISK_IMAGE,
            )?;
            assets::validate_badge(&bytes)?;
            preset.badge = Some(token);
        }
        Some(BadgeUpdate::Reset) => {
            if next
                .badge_job
                .as_ref()
                .is_some_and(|j| j.preset_id == id && j.status == "running")
            {
                return Err("请先取消标志生成".into());
            }
            preset.badge = None;
        }
        None => (),
    }
    Ok(())
}
#[tauri::command]
pub async fn customization_update(
    app: AppHandle,
    id: String,
    name: String,
    accent: String,
    badge: Option<BadgeUpdate>,
    theme: Option<Theme>,
) -> Result<View, String> {
    let view = access(app.clone(), move |root, inner| {
        let mut next = inner.store.as_ref().unwrap().clone();
        update_preset(root, &mut next, &id, &name, &accent, badge)?;
        if let Some(theme) = theme {
            theme.validate()?;
            let preset = next
                .presets
                .iter_mut()
                .find(|p| p.id == id)
                .ok_or("找不到这个桌宠方案")?;
            preset.accent = theme.primary.clone();
            preset.theme = Some(theme);
        }
        commit(root, inner, next)
    })
    .await?;
    Ok(publish(&app, view))
}
#[tauri::command]
pub async fn customization_delete(app: AppHandle, id: String) -> Result<View, String> {
    let view = access(app.clone(), move |root, inner| {
        let mut next = inner.store.as_ref().unwrap().clone();
        if !storage::valid_id(&id) || next.active_id == id {
            return Err("不能删除当前使用的桌宠，请先切换方案".into());
        }
        if next
            .job
            .as_ref()
            .is_some_and(|j| j.view.id == id && j.view.status == "running")
        {
            return Err("请先取消这个方案的生成".into());
        }
        if !next.presets.iter().any(|p| p.id == id) {
            return Err("找不到这个桌宠方案".into());
        }
        if next
            .badge_job
            .as_ref()
            .is_some_and(|j| j.preset_id == id && j.status == "running")
        {
            return Err("请先取消标志生成".into());
        }
        next.presets.retain(|p| p.id != id);
        if next.badge_job.as_ref().is_some_and(|j| j.preset_id == id) {
            next.badge_job = None;
        }
        if next.job.as_ref().is_some_and(|j| j.view.id == id) {
            next.job = None;
        }
        let mut view = commit(root, inner, next)?;
        let dir = storage::asset_path(root, &id, "base")?
            .parent()
            .unwrap()
            .to_owned();
        if std::fs::remove_dir_all(dir).is_err() {
            view.warning = Some("方案已删除，部分图片文件未能清理".into());
        }
        Ok(view)
    })
    .await?;
    Ok(publish(&app, view))
}

fn resume_stage(completed: &[String]) -> &'static str {
    KINDS
        .into_iter()
        .find(|kind| !completed.iter().any(|v| v == kind))
        .unwrap_or("saving")
}
fn current<'a>(store: &'a mut Store, id: &str, attempt: u64) -> Result<&'a mut Job, String> {
    store
        .job
        .as_mut()
        .filter(|j| j.view.id == id && j.view.status == "running" && j.attempt == attempt)
        .ok_or_else(|| "生成任务已停止".into())
}
async fn cancellation_requested(cancel: &mut tokio::sync::watch::Receiver<bool>) {
    loop {
        if *cancel.borrow() {
            return;
        }
        if cancel.changed().await.is_err() {
            // Sender disposal is lifecycle cleanup, not user cancellation.
            std::future::pending::<()>().await;
        }
    }
}
fn launch(
    app: AppHandle,
    id: String,
    attempt: u64,
    mut cancel: tokio::sync::watch::Receiver<bool>,
) {
    tauri::async_runtime::spawn(async move {
        let result = tokio::select! {
            _=cancellation_requested(&mut cancel)=>return,
            result=tokio::time::timeout(std::time::Duration::from_secs(20*60),run_job(app.clone(),id.clone(),attempt))=>match result {Ok(r)=>r,Err(_)=>Err("生成超过 20 分钟，已停止本地等待；可手动继续，已发请求仍由服务商计费".into())},
        };
        if let Err(error) = result {
            if let Ok(view) = access(app.clone(), move |root, inner| {
                let mut next = inner.store.as_ref().unwrap().clone();
                let job = current(&mut next, &id, attempt)?;
                job.view.status = "failed".into();
                job.view.error = Some(error);
                Ok(terminal_commit(root, inner, next))
            })
            .await
            {
                publish(&app, view);
            }
        }
    });
}
async fn lookup_key_with(
    settings: Settings,
    lookup: impl FnOnce(&Settings) -> Result<String, String> + Send + 'static,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || lookup(&settings))
        .await
        .map_err(|_| "图片凭据读取中断")?
}
async fn run_job(app: AppHandle, id: String, attempt: u64) -> Result<(), String> {
    let job_id = id.clone();
    // Keys are loaded only in response to Start/Retry, never on startup/view.
    let (settings, requires_request) = access(app.clone(), move |_, inner| {
        let store = inner.store.as_mut().unwrap();
        current(store, &job_id, attempt)?;
        let requires_request =
            resume_stage(&store.job.as_ref().unwrap().view.completed) != "saving";
        Ok((store.settings.clone(), requires_request))
    })
    .await?;
    // Never hold the customization mutex while the OS waits for a user prompt.
    // Cancellation/view stay available; the loop fences the attempt again before HTTP.
    let key = if requires_request {
        lookup_key_with(settings.clone(), provider::key).await?
    } else {
        String::new()
    };
    loop {
        let job_id = id.clone();
        let (stage, inputs, view) = access(app.clone(), move |root, inner| {
            let mut next = inner.store.as_ref().unwrap().clone();
            let job = current(&mut next, &job_id, attempt)?;
            let stage = KINDS
                .iter()
                .find(|k| !job.view.completed.iter().any(|v| v == **k))
                .map(|k| k.to_string());
            let Some(stage) = stage else {
                return Ok((None, vec![], next.view()));
            };
            let kinds = if stage == "base" {
                (0..job.references)
                    .map(|i| format!("reference-{i}"))
                    .collect::<Vec<_>>()
            } else {
                vec!["base".into()]
            };
            let inputs = kinds
                .iter()
                .map(|k| {
                    storage::read(
                        &storage::asset_path(root, &job_id, k)?,
                        storage::MAX_DISK_IMAGE,
                    )
                })
                .collect::<Result<Vec<_>, String>>()?;
            job.view.stage = stage.clone();
            job.view.request_count += 1;
            let view = commit(root, inner, next)?;
            Ok((Some(stage), inputs, view))
        })
        .await?;
        publish(&app, view);
        let Some(stage) = stage else {
            break;
        };
        let bytes = provider::edit(&settings, &key, inputs, &stage).await?;
        let job_id = id.clone();
        let view = access(app.clone(), move |root, inner| {
            let mut next = inner.store.as_ref().unwrap().clone();
            current(&mut next, &job_id, attempt)?;
            let (bytes, _, _) = assets::generated(&bytes)?;
            if stage != "base" {
                let base = storage::read(
                    &storage::asset_path(root, &job_id, "base")?,
                    storage::MAX_DISK_IMAGE,
                )?;
                assets::consistent_with_base(&base, &bytes)?;
            }
            storage::atomic(&storage::asset_path(root, &job_id, &stage)?, &bytes)?;
            let job = current(&mut next, &job_id, attempt)?;
            job.view.completed.push(stage);
            commit(root, inner, next)
        })
        .await?;
        publish(&app, view);
    }
    let view = access(app.clone(), move |root, inner| {
        let mut next = inner.store.as_ref().unwrap().clone();
        let job = current(&mut next, &id, attempt)?.clone();
        let mut metadata = BTreeMap::new();
        let mut accent = String::new();
        for kind in KINDS {
            let bytes = storage::read(
                &storage::asset_path(root, &id, kind)?,
                storage::MAX_DISK_IMAGE,
            )?;
            let (_, meta, color) = assets::generated(&bytes)?;
            metadata.insert(kind.into(), meta);
            if kind == "base" {
                accent = color;
            }
        }
        let colors = assets::character_colors(&storage::read(
            &storage::asset_path(root, &id, "base")?,
            storage::MAX_DISK_IMAGE,
        )?)?;
        let theme = Theme::character(&colors, &accent);
        let accent = theme.primary.clone();
        next.presets.push(Preset {
            theme: Some(theme),
            colors,
            colors_version: assets::COLORS_VERSION,
            id: id.clone(),
            name: job.view.name,
            accent,
            created_at: chrono::Utc::now().to_rfc3339(),
            assets: metadata,
            badge: job.badge,
        });
        let job = current(&mut next, &id, attempt)?;
        job.view.status = "ready".into();
        job.view.stage = "saving".into();
        job.view.error = None;
        let view = commit(root, inner, next)?;
        // Retain sender: dropping it here can win launch select before ready publication.
        Ok(view)
    })
    .await?;
    publish(&app, view);
    Ok(())
}

#[derive(Clone, Serialize, Deserialize)]
struct BadgeJob {
    id: String,
    preset_id: String,
    status: String,
    request_count: u32,
    result: Option<String>,
    error: Option<String>,
}
fn current_badge<'a>(store: &'a mut Store, id: &str) -> Result<&'a mut BadgeJob, String> {
    store
        .badge_job
        .as_mut()
        .filter(|j| j.id == id && j.status == "running")
        .ok_or_else(|| "标志任务已结束，忽略旧结果".into())
}
#[tauri::command]
pub async fn customization_badge_start(app: AppHandle, id: String) -> Result<View, String> {
    let (view, cancel) = access(app.clone(), move |root, inner| {
        let mut next = inner.store.as_ref().unwrap().clone();
        if next.running() {
            return Err("已有图片生成进行中，请等待或取消".into());
        }
        if next.settings.base_url.is_empty() || next.settings.model.is_empty() {
            return Err("请先配置图片服务".into());
        }
        storage::validate_preset(root, &next, &id)?;
        let count = next
            .badge_job
            .as_ref()
            .filter(|j| j.preset_id == id)
            .map_or(0, |j| j.request_count);
        next.badge_job = Some(BadgeJob {
            id: uuid::Uuid::new_v4().to_string(),
            preset_id: id,
            status: "running".into(),
            request_count: count,
            result: None,
            error: None,
        });
        let view = commit(root, inner, next)?;
        let (tx, rx) = tokio::sync::watch::channel(false);
        inner.badge_cancel = Some(tx);
        Ok((view, rx))
    })
    .await?;
    let id = view.badge_job.as_ref().unwrap().id.clone();
    let worker_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut cancel = cancel;
        let result = tokio::select! {
            _=cancellation_requested(&mut cancel)=>return,
            result=tokio::time::timeout(std::time::Duration::from_secs(6*60), run_badge(worker_app.clone(), id.clone()))=> match result { Ok(result)=>result, Err(_)=>Err("标志生成超时；未自动重试，已发请求仍可能计费".into()) },
        };
        if let Err(error) = result {
            if let Ok(view) = access(worker_app.clone(), move |root, inner| {
                let mut next = inner.store.as_ref().unwrap().clone();
                let job = current_badge(&mut next, &id)?;
                job.status = "failed".into();
                job.error = Some(error);
                Ok(terminal_commit(root, inner, next))
            })
            .await
            {
                publish(&worker_app, view);
            }
        }
    });
    Ok(publish(&app, view))
}
#[tauri::command]
pub async fn customization_badge_cancel(app: AppHandle, id: String) -> Result<View, String> {
    let view = access(app.clone(), move |root, inner| {
        let mut next = inner.store.as_ref().unwrap().clone();
        let job = current_badge(&mut next, &id)?;
        job.status = "cancelled".into();
        job.error = None;
        if let Some(sender) = inner.badge_cancel.take() {
            let _ = sender.send(true);
        }
        Ok(terminal_commit(root, inner, next))
    })
    .await?;
    Ok(publish(&app, view))
}
async fn run_badge(app: AppHandle, id: String) -> Result<(), String> {
    let job_id = id.clone();
    let settings = access(app.clone(), move |_, inner| {
        let store = inner.store.as_mut().unwrap();
        current_badge(store, &job_id)?;
        Ok(store.settings.clone())
    })
    .await?;
    let key = lookup_key_with(settings.clone(), provider::key).await?;
    let job_id = id.clone();
    let (bytes, view) = access(app.clone(), move |root, inner| {
        let mut next = inner.store.as_ref().unwrap().clone();
        let job = current_badge(&mut next, &job_id)?;
        let bytes = storage::read(
            &storage::asset_path(root, &job.preset_id, "base")?,
            storage::MAX_DISK_IMAGE,
        )?;
        job.request_count = job.request_count.checked_add(1).ok_or("请求计数超出限制")?;
        Ok((bytes, commit(root, inner, next)?))
    })
    .await?;
    publish(&app, view);
    let bytes = provider::edit(&settings, &key, vec![bytes], "badge").await?;
    let view = access(app.clone(), move |root, inner| {
        let mut next = inner.store.as_ref().unwrap().clone();
        let job = current_badge(&mut next, &id)?;
        let bytes = assets::badge(&bytes)?;
        let token = uuid::Uuid::new_v4().to_string();
        let path = storage::asset_path(root, &job.preset_id, &format!("badge-{token}"))?;
        storage::atomic(&path, &bytes)?;
        job.status = "ready".into();
        job.result = Some(token);
        job.error = None;
        let result = commit(root, inner, next);
        if result.is_err() {
            let _ = std::fs::remove_file(path);
        }
        result
    })
    .await?;
    publish(&app, view);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn complete_theme_is_validated_and_omission_preserves_saved_choice() {
        let mut preset: Preset = serde_json::from_value(serde_json::json!({"id":uuid::Uuid::new_v4().to_string(),"name":"猫","accent":"#aabbcc","created_at":"test","assets":{}})).unwrap();
        assert!(preset.theme.is_none());
        assert!(preset.colors.is_empty());
        let mut theme = Theme {
            palette: "mint".into(),
            primary: "#459f87".into(),
            secondary: "#c5b567".into(),
            strength: 65,
        };
        assert!(theme.validate().is_ok());
        theme.strength = 101;
        assert!(theme.validate().is_err());
        theme.strength = 65;
        theme.secondary = "red".into();
        assert!(theme.validate().is_err());
        theme.secondary = "#c5b567".into();
        preset.theme = Some(theme.clone());
        let id = preset.id.clone();
        let mut store = Store::default();
        store.presets.push(preset);
        update_preset(
            Path::new("unused"),
            &mut store,
            &id,
            "新名字",
            "#112233",
            None,
        )
        .unwrap();
        assert_eq!(store.presets[0].theme, Some(theme));
        let decoded: Store = serde_json::from_slice(&serde_json::to_vec(&store).unwrap()).unwrap();
        assert_eq!(decoded.presets[0].theme, store.presets[0].theme);
    }
    #[test]
    fn badge_old_presets_and_omitted_update_preserve_compatibility() {
        let mut preset: Preset = serde_json::from_value(serde_json::json!({"id":uuid::Uuid::new_v4().to_string(),"name":"猫","accent":"#aabbcc","created_at":"test","assets":{}})).unwrap();
        assert!(preset.badge.is_none());
        let token = uuid::Uuid::new_v4().to_string();
        preset.badge = Some(token.clone());
        let id = preset.id.clone();
        let mut store = Store::default();
        store.presets.push(preset);
        update_preset(
            Path::new("/not-used"),
            &mut store,
            &id,
            "小猫",
            "#112233",
            None,
        )
        .unwrap();
        assert_eq!(store.presets[0].badge.as_deref(), Some(token.as_str()));
        update_preset(
            Path::new("/not-used"),
            &mut store,
            &id,
            "小猫",
            "#112233",
            Some(BadgeUpdate::Reset),
        )
        .unwrap();
        assert!(store.presets[0].badge.is_none());
    }
    #[test]
    fn badge_attempt_fences_cancelled_and_replaced_work_and_mutual_exclusion() {
        let mut store = Store::default();
        store.badge_job = Some(BadgeJob {
            id: "first".into(),
            preset_id: "pet".into(),
            status: "running".into(),
            request_count: 0,
            result: None,
            error: None,
        });
        assert!(store.running());
        current_badge(&mut store, "first").unwrap().status = "cancelled".into();
        assert!(!store.running());
        assert!(current_badge(&mut store, "first").is_err());
        store.badge_job.as_mut().unwrap().id = "second".into();
        store.badge_job.as_mut().unwrap().status = "running".into();
        assert!(current_badge(&mut store, "first").is_err());
        assert!(current_badge(&mut store, "second").is_ok());
    }
    #[test]
    fn badge_select_requires_ready_owned_valid_asset_and_commits_same_active_id() {
        let dir = std::env::temp_dir().join(format!("pet-badge-test-{}", uuid::Uuid::new_v4()));
        let id = uuid::Uuid::new_v4().to_string();
        let token = uuid::Uuid::new_v4().to_string();
        let mut store = Store::default();
        store.active_id = id.clone();
        store.presets.push(Preset {
            theme: None,
            colors: vec![],
            colors_version: 0,
            id: id.clone(),
            name: "猫".into(),
            accent: "#aabbcc".into(),
            created_at: "test".into(),
            assets: BTreeMap::new(),
            badge: None,
        });
        store.badge_job = Some(BadgeJob {
            id: uuid::Uuid::new_v4().to_string(),
            preset_id: id.clone(),
            status: "ready".into(),
            request_count: 1,
            result: Some(token.clone()),
            error: None,
        });
        let mut inner = Inner {
            store: Some(store.clone()),
            ..Default::default()
        };
        let mut next = store.clone();
        assert!(update_preset(
            &dir,
            &mut next,
            &id,
            "猫",
            "#aabbcc",
            Some(BadgeUpdate::Select {
                token: token.clone()
            })
        )
        .is_err());
        assert!(inner.store.as_ref().unwrap().presets[0].badge.is_none());
        let image = image::DynamicImage::ImageRgba8(image::RgbaImage::from_fn(64, 64, |x, y| {
            image::Rgba([20, 30, 40, if x < 8 || y < 8 { 0 } else { 255 }])
        }));
        let mut bytes = std::io::Cursor::new(Vec::new());
        image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
        storage::atomic(
            &storage::asset_path(&dir, &id, &format!("badge-{token}")).unwrap(),
            &bytes.into_inner(),
        )
        .unwrap();
        let mut next = store;
        update_preset(
            &dir,
            &mut next,
            &id,
            "猫",
            "#aabbcc",
            Some(BadgeUpdate::Select {
                token: token.clone(),
            }),
        )
        .unwrap();
        let view = commit(&dir, &mut inner, next).unwrap();
        assert_eq!(view.active_id, id);
        assert_eq!(view.revision, 1);
        assert_eq!(view.presets[0].badge.as_deref(), Some(token.as_str()));
        let mut next = inner.store.as_ref().unwrap().clone();
        update_preset(
            &dir,
            &mut next,
            &id,
            "猫",
            "#aabbcc",
            Some(BadgeUpdate::Reset),
        )
        .unwrap();
        let view = commit(&dir, &mut inner, next).unwrap();
        assert_eq!(view.revision, 2);
        assert!(view.presets[0].badge.is_none());
        assert_eq!(view.badge_job.as_ref().unwrap().request_count, 1);
        assert_eq!(
            view.badge_job.as_ref().unwrap().result.as_deref(),
            Some(token.as_str())
        );
        let mut next = inner.store.as_ref().unwrap().clone();
        update_preset(
            &dir,
            &mut next,
            &id,
            "猫",
            "#aabbcc",
            Some(BadgeUpdate::Select {
                token: token.clone(),
            }),
        )
        .unwrap();
        let view = commit(&dir, &mut inner, next).unwrap();
        assert_eq!(view.presets[0].badge.as_deref(), Some(token.as_str()));
        assert_eq!(view.badge_job.as_ref().unwrap().request_count, 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    fn job(id: String, attempt: u64) -> Job {
        Job {
            view: JobView {
                id,
                name: "测试".into(),
                status: "running".into(),
                stage: "base".into(),
                completed: vec![],
                request_count: 0,
                error: None,
            },
            references: 1,
            attempt,
            badge: None,
        }
    }
    #[tokio::test]
    async fn sender_cleanup_is_not_cancellation_and_cannot_suppress_ready() {
        let (sender, mut receiver) = tokio::sync::watch::channel(false);
        drop(sender);
        assert!(tokio::time::timeout(
            std::time::Duration::from_millis(10),
            cancellation_requested(&mut receiver)
        )
        .await
        .is_err());
        let (sender, mut receiver) = tokio::sync::watch::channel(false);
        sender.send(true).unwrap();
        assert!(tokio::time::timeout(
            std::time::Duration::from_millis(100),
            cancellation_requested(&mut receiver)
        )
        .await
        .is_ok());
    }
    #[tokio::test]
    async fn waiting_for_credentials_does_not_lock_view_or_cancel_and_late_key_cannot_request() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let id = uuid::Uuid::new_v4().to_string();
        let mut store = Store::default();
        store.job = Some(job(id.clone(), 1));
        let shared = Arc::new(Mutex::new(store));
        let requests = Arc::new(AtomicUsize::new(0));
        let worker_store = shared.clone();
        let worker_requests = requests.clone();
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let worker = tokio::spawn(async move {
            let settings = { worker_store.lock().unwrap().settings.clone() };
            let _key = lookup_key_with(settings, move |_| {
                started_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok("unit-key".into())
            })
            .await?;
            let mut store = worker_store.lock().unwrap();
            current(&mut store, &id, 1)?;
            worker_requests.fetch_add(1, Ordering::SeqCst);
            Ok::<(), String>(())
        });
        started_rx.await.unwrap();
        {
            let mut store = shared
                .try_lock()
                .expect("credential prompt must not own state lock");
            assert_eq!(store.view().job.unwrap().status, "running");
            store.job.as_mut().unwrap().view.status = "cancelled".into();
        }
        release_tx.send(()).unwrap();
        assert!(worker.await.unwrap().is_err());
        assert_eq!(requests.load(Ordering::SeqCst), 0);
    }
    #[test]
    fn cancelled_and_retried_attempt_rejects_late_result() {
        let id = uuid::Uuid::new_v4().to_string();
        let mut store = Store::default();
        store.job = Some(job(id.clone(), 4));
        assert!(current(&mut store, &id, 4).is_ok());
        store.job.as_mut().unwrap().view.status = "cancelled".into();
        assert!(current(&mut store, &id, 4).is_err());
        store.job = Some(job(id.clone(), 6));
        assert!(current(&mut store, &id, 4).is_err());
        assert!(current(&mut store, &id, 6).is_ok());
    }
    #[test]
    fn failed_persistence_keeps_committed_selection_and_revision() {
        let dir = std::env::temp_dir().join(format!("pet-custom-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::create_dir(dir.join("state.json")).unwrap();
        let mut inner = Inner {
            store: Some(Store::default()),
            cancel: None,
            badge_cancel: None,
        };
        let mut next = Store::default();
        next.active_id = uuid::Uuid::new_v4().to_string();
        assert!(commit(&dir, &mut inner, next).is_err());
        let actual = inner.store.unwrap();
        assert_eq!(actual.active_id, "default");
        assert_eq!(actual.revision, 0);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn successful_commit_increments_revision_and_preserves_unrelated_store() {
        let dir = std::env::temp_dir().join(format!("pet-custom-test-{}", uuid::Uuid::new_v4()));
        let mut inner = Inner {
            store: Some(Store::default()),
            cancel: None,
            badge_cancel: None,
        };
        let next = Store::default();
        let view = commit(&dir, &mut inner, next).unwrap();
        assert_eq!(view.revision, 1);
        assert_eq!(storage::load(&dir).unwrap().revision, 1);
        assert!(!dir.join("agent-local.db").exists());
        assert!(!dir.join("agent-config.json").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn completed_assets_resume_saving_without_another_request() {
        let completed = KINDS.map(str::to_owned).to_vec();
        assert_eq!(resume_stage(&completed), "saving");
        assert_eq!(resume_stage(&completed[..2]), "happy");
    }
    #[test]
    fn serialized_state_has_only_image_credential_reference() {
        let mut store = Store::default();
        store.settings.key_account = Some(uuid::Uuid::new_v4().to_string());
        let json = serde_json::to_string(&store).unwrap();
        assert!(!json.contains("api_key"));
        let view = serde_json::to_value(store.view()).unwrap();
        assert_eq!(view["settings"]["has_key"], true);
        assert!(view["settings"].get("key_account").is_none());
    }
}

#[cfg(test)]
mod chat_connection_tests {
    use super::*;
    fn local() -> crate::backend::Inner {
        let mut inner = crate::backend::Inner::default();
        let mut config = crate::backend::Config::default();
        config.mode = crate::backend::Mode::Local;
        config.local.base_url = "https://example.invalid/v1".into();
        config.local.api_key = "fixture-key".into();
        inner.config = Some(config);
        inner
    }
    #[test]
    fn explicit_copy_requires_local_config_and_fences_reconfiguration() {
        assert!(chat_source(&crate::backend::Inner::default()).is_err());
        let mut inner = local();
        let (generation, source) = chat_source(&inner).unwrap();
        assert!(ensure_chat_source(&inner, generation, &source).is_ok());
        inner.view.generation += 1;
        assert!(ensure_chat_source(&inner, generation, &source).is_err());
        inner.view.generation = generation;
        inner.config.as_mut().unwrap().local.base_url = "https://other.invalid/v1".into();
        assert!(ensure_chat_source(&inner, generation, &source).is_err());
        inner.config.as_mut().unwrap().mode = crate::backend::Mode::Server;
        assert!(chat_source(&inner).is_err());
    }
    #[test]
    fn explicit_copy_fences_key_changes_without_exposing_the_key() {
        let mut inner = local();
        let (generation, source) = chat_source(&inner).unwrap();
        inner.config.as_mut().unwrap().local.api_key = "replacement-fixture".into();
        let error = ensure_chat_source(&inner, generation, &source).unwrap_err();
        assert!(!error.contains("fixture"));
        let view = Store::default().view();
        assert!(!serde_json::to_string(&view).unwrap().contains("api_key"));
    }
}
