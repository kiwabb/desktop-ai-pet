pub mod credentials;
pub mod local;
pub mod server;

use crate::agent_protocol::Snapshot;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, fs, io::Write, sync::Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, oneshot};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    #[default]
    Server,
    Local,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct ServerConfig {
    pub base_url: String,
    pub token: String,
    pub session_id: Option<String>,
}

fn default_timeout_secs() -> u64 {
    90
}
fn default_timezone() -> String {
    "Asia/Shanghai".into()
}

#[derive(Clone, Deserialize, Serialize)]
pub struct LocalConfig {
    #[serde(default)]
    pub base_url: String,
    /// In-memory only: hydrated from / migrated into the OS credential store
    /// (`credentials` module); deserialization still accepts a legacy plaintext
    /// field so it can be moved, but serialization never writes it to disk.
    #[serde(default, skip_serializing)]
    pub api_key: String,
    #[serde(default)]
    pub model: String,
    #[serde(default = "default_timeout_secs")]
    pub timeout_secs: u64,
    #[serde(default = "default_timezone")]
    pub timezone: String,
}

impl Default for LocalConfig {
    fn default() -> Self {
        Self {
            base_url: String::new(),
            api_key: String::new(),
            model: String::new(),
            timeout_secs: default_timeout_secs(),
            timezone: default_timezone(),
        }
    }
}

impl LocalConfig {
    /// Stored values win; empty fields fall back to PET_AGENT_MODEL_* env vars.
    pub fn effective(&self) -> Self {
        self.resolve(env_value)
    }

    fn resolve(&self, env: impl Fn(&str) -> Option<String>) -> Self {
        let pick = |stored: &str, key: &str| {
            let stored = stored.trim();
            if stored.is_empty() {
                env(key).unwrap_or_default()
            } else {
                stored.to_owned()
            }
        };
        Self {
            base_url: pick(&self.base_url, "PET_AGENT_MODEL_BASE_URL"),
            api_key: pick(&self.api_key, "PET_AGENT_MODEL_API_KEY"),
            model: pick(&self.model, "PET_AGENT_MODEL_NAME"),
            timeout_secs: self.timeout_secs,
            timezone: self.timezone.clone(),
        }
    }

    pub fn model_configured(&self) -> bool {
        !self.base_url.is_empty() && !self.api_key.is_empty() && !self.model.is_empty()
    }
}

fn env_value(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

#[derive(Clone, Default, Deserialize, Serialize)]
pub struct Config {
    #[serde(default)]
    pub mode: Mode,
    #[serde(default)]
    pub server: ServerConfig,
    #[serde(default)]
    pub local: LocalConfig,
}

#[derive(Deserialize)]
struct LegacyConfig {
    base_url: String,
    token: String,
    session_id: Option<String>,
}

impl Config {
    /// Files written before the mode field existed migrate to server mode.
    fn parse(bytes: &[u8]) -> Option<Config> {
        let value: Value = serde_json::from_slice(bytes).ok()?;
        if value.get("mode").is_some() {
            return serde_json::from_value(value).ok();
        }
        let legacy: LegacyConfig = serde_json::from_value(value).ok()?;
        Some(Config {
            mode: Mode::Server,
            server: ServerConfig {
                base_url: legacy.base_url,
                token: legacy.token,
                session_id: legacy.session_id,
            },
            local: LocalConfig::default(),
        })
    }
}

#[derive(Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub mode: Mode,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub local_base_url: String,
    #[serde(default)]
    pub local_api_key: String,
    #[serde(default)]
    pub local_model: String,
}

#[derive(Clone, Default, Serialize)]
pub struct View {
    pub(crate) generation: u64,
    pub(crate) revision: u64,
    pub(crate) mode: Mode,
    pub(crate) configured: bool,
    pub(crate) endpoint: Option<String>,
    pub(crate) connection: String,
    pub(crate) node_connected: bool,
    pub(crate) node_error: Option<String>,
    pub(crate) model: Option<String>,
    pub(crate) model_configured: bool,
    pub(crate) error: Option<String>,
    pub(crate) snapshot: Snapshot,
    /// Stored endpoints/secrets presence for both modes, so the settings form
    /// can reuse saved values no matter which mode is active.
    pub(crate) server_endpoint: Option<String>,
    pub(crate) server_has_token: bool,
    pub(crate) local_endpoint: Option<String>,
    pub(crate) local_model: Option<String>,
    pub(crate) local_has_key: bool,
    pub(crate) reminders: Vec<Todo>,
    pub(crate) reminder_error: Option<String>,
    pub(crate) todo_revision: u64,
}

#[derive(Default)]
pub(crate) struct Inner {
    pub(crate) config: Option<Config>,
    pub(crate) view: View,
    pub(crate) sender: Option<mpsc::Sender<Value>>,
    pub(crate) task: Option<tauri::async_runtime::JoinHandle<()>>,
    /// Tagged with the run id so a finishing run never clears a newer handle.
    pub(crate) run_task: Option<(String, tauri::async_runtime::JoinHandle<()>)>,
    /// Local mode's SQLite runtime store (None in server mode).
    pub(crate) store: Option<std::sync::Arc<crate::local_agent::store::Store>>,
    pub(crate) initialized: bool,
    pub(crate) todo_mutation_epoch: u64,
    pub(crate) todo_writes_in_flight: u64,
    pub(crate) acknowledgements: HashMap<String, oneshot::Sender<Result<(), String>>>,
}

#[derive(Default)]
pub struct AgentState(pub(crate) Mutex<Inner>);

impl AgentState {
    /// A panic while holding the lock must not cascade into every subsequent
    /// command failing: no invariant is left half-mutated across a panic here
    /// (mutations are single-threaded field writes), so recover the guard.
    pub(crate) fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TodoStatus {
    Pending,
    Completed,
}
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct Todo {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) status: TodoStatus,
    pub(crate) created_at: String,
    pub(crate) remind_at: Option<String>,
}
#[derive(Serialize)]
pub struct TodoListView {
    generation: u64,
    items: Vec<Todo>,
}
#[derive(Serialize)]
pub struct TodoCompletionView {
    generation: u64,
    item: Todo,
}

/// One chat data source per mode; the command layer dispatches on the saved mode.
pub trait AgentBackend {
    /// Reset the view for a new generation and spawn background loops, if any.
    fn start(
        app: &AppHandle,
        inner: &mut Inner,
        generation: u64,
        config: &Config,
    ) -> Option<tauri::async_runtime::JoinHandle<()>>;
    /// Resolves once the run is durably accepted by the mode's own semantics.
    async fn submit(app: &AppHandle, request_id: String, text: String) -> Result<(), String>;
}

pub(crate) fn normalized_url(raw: &str, label: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(raw.trim()).map_err(|_| format!("请输入有效的{label}"))?;
    let local = matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    );
    if (url.scheme() != "https" && !(url.scheme() == "http" && local))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "远程服务必须使用 HTTPS；仅本机回环地址允许 HTTP，地址不能包含凭证或查询参数".into(),
        );
    }
    Ok(url.as_str().trim_end_matches('/').into())
}
fn path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|_| "无法访问助手配置目录")?
        .join("agent-config.json"))
}
fn persist(app: &AppHandle, config: &Config) -> Result<(), String> {
    let path = path(app)?;
    fs::create_dir_all(path.parent().ok_or("配置目录不存在")?)
        .map_err(|_| "无法创建助手配置目录")?;
    let temp = path.with_extension("tmp");
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temp).map_err(|_| "无法保存助手配置")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|_| "无法保护设备凭证")?;
    }
    file.write_all(&serde_json::to_vec(config).map_err(|_| "配置编码失败")?)
        .map_err(|_| "配置写入失败")?;
    file.sync_all().map_err(|_| "配置写入失败")?;
    fs::rename(temp, path).map_err(|_| "配置保存失败".into())
}
pub(crate) fn change(app: &AppHandle, generation: u64, f: impl FnOnce(&mut Inner)) {
    let state = app.state::<AgentState>();
    let mut inner = state.lock();
    if inner.view.generation != generation {
        return;
    }
    f(&mut inner);
    inner.view.revision += 1;
    let _ = app.emit("agent:view", &inner.view);
}
/// Where todo commands read/write, dispatched on the saved mode; both sources
/// share the same generation/epoch fencing and `agent:view` update path.
enum TodoSource {
    Server(ServerConfig),
    Local(std::sync::Arc<crate::local_agent::store::Store>),
}

fn todo_config(inner: &Inner) -> Result<(TodoSource, u64), String> {
    let config = inner.config.clone().ok_or("请先配置助手服务")?;
    match config.mode {
        Mode::Server => Ok((TodoSource::Server(config.server), inner.view.generation)),
        Mode::Local => Ok((
            TodoSource::Local(
                inner
                    .store
                    .clone()
                    .ok_or("本地存储不可用，请重新保存单机模式配置")?,
            ),
            inner.view.generation,
        )),
    }
}

fn start(app: &AppHandle, inner: &mut Inner, config: Config) {
    if let Some(task) = inner.task.take() {
        task.abort();
    }
    if let Some((_, task)) = inner.run_task.take() {
        task.abort();
    }
    let generation = inner.view.generation + 1;
    inner.sender = None;
    inner.store = None;
    inner.todo_mutation_epoch = 0;
    inner.todo_writes_in_flight = 0;
    inner.acknowledgements.clear();
    inner.task = match config.mode {
        Mode::Server => server::ServerBackend::start(app, inner, generation, &config),
        Mode::Local => local::LocalBackend::start(app, inner, generation, &config),
    };
    inner.view.server_endpoint =
        (!config.server.base_url.is_empty()).then(|| config.server.base_url.clone());
    inner.view.server_has_token = !config.server.token.is_empty();
    inner.view.local_endpoint =
        (!config.local.base_url.is_empty()).then(|| config.local.base_url.clone());
    inner.view.local_model = (!config.local.model.is_empty()).then(|| config.local.model.clone());
    inner.view.local_has_key = !config.local.api_key.is_empty();
    inner.config = Some(config);
}

#[tauri::command]
pub async fn agent_complete_todo(
    app: AppHandle,
    todo_id: String,
) -> Result<TodoCompletionView, String> {
    update_todo(app, todo_id, server::TodoAction::Complete).await
}

#[tauri::command]
pub async fn agent_create_todo(app: AppHandle, title: String) -> Result<TodoCompletionView, String> {
    let title = validate_todo_title(&title)?;
    let (source, generation) = begin_todo_write(&app)?;
    let result = match source {
        TodoSource::Server(config) => server::create_todo_http(&config, &title).await,
        TodoSource::Local(store) => crate::local_agent::plugins::todo::TodoStore::new(&store)
            .create_todo(&title)
            .map_err(|error| error.message()),
    };
    finish_todo_write(&app, generation, result)
}

#[tauri::command]
pub async fn agent_update_todo(app: AppHandle, todo_id: String, title: String) -> Result<TodoCompletionView, String> {
    let title = validate_todo_title(&title)?;
    let (source, generation) = begin_todo_write(&app)?;
    let result = match source {
        TodoSource::Server(config) => server::update_todo_title_http(&config, &todo_id, &title).await,
        TodoSource::Local(store) => {
            let todo_id = uuid::Uuid::parse_str(&todo_id)
                .map_err(|_| "待办标识不正确".to_owned())?
                .to_string();
            crate::local_agent::plugins::todo::TodoStore::new(&store)
                .update_todo_title(&todo_id, &title)
                .map_err(|error| error.message())
        }
    };
    finish_todo_write(&app, generation, result)
}

#[tauri::command]
pub async fn agent_delete_todo(app: AppHandle, todo_id: String) -> Result<TodoCompletionView, String> {
    let (source, generation) = begin_todo_write(&app)?;
    let result = match source {
        TodoSource::Server(config) => server::delete_todo_http(&config, &todo_id).await,
        TodoSource::Local(store) => {
            let todo_id = uuid::Uuid::parse_str(&todo_id)
                .map_err(|_| "待办标识不正确".to_owned())?
                .to_string();
            crate::local_agent::plugins::todo::TodoStore::new(&store)
                .delete_todo(&todo_id)
                .map_err(|error| error.message())
        }
    };
    finish_todo_write(&app, generation, result)
}

/// Shared client-side title rule so both modes fail identically before any I/O.
fn validate_todo_title(title: &str) -> Result<String, String> {
    if title.trim().is_empty() || title.chars().count() > 2000 {
        return Err("待办标题需为 1 到 2000 个字符".into());
    }
    Ok(title.trim().to_owned())
}

#[tauri::command]
pub async fn agent_reopen_todo(app: AppHandle, todo_id: String) -> Result<TodoCompletionView, String> {
    update_todo(app, todo_id, server::TodoAction::Reopen).await
}

async fn update_todo(app: AppHandle, todo_id: String, action: server::TodoAction) -> Result<TodoCompletionView, String> {
    let (source, generation) = begin_todo_write(&app)?;
    let result = match source {
        TodoSource::Server(config) => server::update_todo_http(&config, &todo_id, action).await,
        TodoSource::Local(store) => {
            let todo_id = uuid::Uuid::parse_str(&todo_id)
                .map_err(|_| "待办标识不正确".to_owned())?
                .to_string();
            match action {
                server::TodoAction::Complete => crate::local_agent::plugins::todo::TodoStore::new(&store).complete_todo(&todo_id),
                server::TodoAction::Reopen => crate::local_agent::plugins::todo::TodoStore::new(&store).reopen_todo(&todo_id),
            }
            .map_err(|error| error.message())
        }
    };
    finish_todo_write(&app, generation, result)
}

fn begin_todo_write(app: &AppHandle) -> Result<(TodoSource, u64), String> {
    let state = app.state::<AgentState>();
    let mut inner = state.lock();
    let source = todo_config(&inner)?;
    inner.todo_mutation_epoch += 1;
    inner.todo_writes_in_flight += 1;
    Ok(source)
}

fn apply_todo_write(inner: &mut Inner, generation: u64, result: Result<Todo, String>) -> Result<TodoCompletionView, String> {
    if inner.view.generation != generation {
        return Err("助手配置已更换，请重新查询待办".into());
    }
    inner.todo_mutation_epoch += 1;
    inner.todo_writes_in_flight -= 1;
    let item = result?;
    inner.view.reminders.retain(|todo| todo.id != item.id);
    inner.view.todo_revision += 1;
    Ok(TodoCompletionView { generation, item })
}

fn finish_todo_write(app: &AppHandle, generation: u64, result: Result<Todo, String>) -> Result<TodoCompletionView, String> {
    let state = app.state::<AgentState>();
    let mut inner = state.lock();
    let result = apply_todo_write(&mut inner, generation, result);
    if result.is_ok() {
        inner.view.revision += 1;
        let _ = app.emit("agent:view", &inner.view);
    }
    result
}

#[tauri::command]
pub async fn agent_set_todo_reminder(app: AppHandle, todo_id: String, remind_at: Option<String>, expected_remind_at: Option<String>) -> Result<TodoCompletionView, String> {
    let (source, generation) = begin_todo_write(&app)?;
    let result = match source {
        TodoSource::Server(config) => server::set_reminder_http(&config, &todo_id, remind_at.as_deref(), expected_remind_at.as_deref()).await,
        TodoSource::Local(store) => local_set_reminder(&store, &todo_id, remind_at.as_deref(), expected_remind_at.as_deref()),
    };
    finish_todo_write(&app, generation, result)
}

/// Local-mode reminder writes validate like the server's HTTP boundary and map
/// failures onto the same message families, so the frontend cannot tell modes apart.
fn local_set_reminder(store: &crate::local_agent::store::Store, todo_id: &str, remind_at: Option<&str>, expected_remind_at: Option<&str>) -> Result<Todo, String> {
    let todo_id = uuid::Uuid::parse_str(todo_id)
        .map_err(|_| "待办标识不正确".to_owned())?
        .to_string();
    let parse = |value: Option<&str>| {
        crate::local_agent::store::parse_reminder_time(
            &value.map_or(serde_json::Value::Null, |text| serde_json::Value::String(text.to_owned())),
        )
        .map_err(|_| "提醒时间无效或已经过去，请重新设置".to_owned())
    };
    let target = parse(remind_at)?;
    let expected = parse(expected_remind_at)?;
    crate::local_agent::plugins::todo::TodoStore::new(store)
        .set_todo_reminder(&todo_id, target, expected)
        .map_err(|error| match error {
            crate::local_agent::store::StoreError::Conflict(_) => "待办或提醒已被修改，请刷新后重试".into(),
            crate::local_agent::store::StoreError::Validation(_) => "提醒时间无效或已经过去，请重新设置".into(),
            other => other.message(),
        })
}

pub(crate) fn apply_reminder_poll(inner: &mut Inner, generation: u64, epoch: u64, result: Result<Vec<Todo>, String>) -> bool {
    if inner.view.generation != generation || inner.todo_mutation_epoch != epoch || inner.todo_writes_in_flight > 0 {
        return false;
    }
    match result {
        Ok(items) => {
            let changed = inner.view.reminders != items || inner.view.reminder_error.is_some();
            inner.view.reminders = items;
            inner.view.reminder_error = None;
            changed
        }
        Err(error) => {
            let changed = inner.view.reminder_error.as_ref() != Some(&error);
            inner.view.reminder_error = Some(error);
            changed
        }
    }
}

#[tauri::command]
pub async fn agent_list_todos(app: AppHandle) -> Result<TodoListView, String> {
    let (source, generation) = {
        let state = app.state::<AgentState>();
        let inner = state.lock();
        todo_config(&inner)?
    };
    let items = match source {
        TodoSource::Server(config) => server::fetch_todos(&config).await?,
        TodoSource::Local(store) => crate::local_agent::plugins::todo::TodoStore::new(&store)
            .list_todos()
            .map_err(|error| error.message())?,
    };
    let state = app.state::<AgentState>();
    let inner = state.lock();
    if inner.view.generation != generation {
        return Err("助手配置已更换，请重新查询待办".into());
    }
    Ok(TodoListView { generation, items })
}

// Keychain and config filesystem calls may wait on OS security services. Keep
// the existing serialized transactions, but never run them on AppKit's thread
// or hold an async executor worker while waiting for credential I/O.
async fn blocking_config<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work).await
        .map_err(|_| "助手配置操作中断，请重试".to_owned())
}

#[tauri::command]
pub async fn agent_view(app: AppHandle) -> Result<View, String> {
    blocking_config(move || agent_view_blocking(app)).await
}

fn agent_view_blocking(app: AppHandle) -> View {
    let state = app.state::<AgentState>();
    let mut inner = state.lock();
    if !inner.initialized {
        inner.initialized = true;
        let config = path(&app)
            .ok()
            .and_then(|p| fs::read(p).ok())
            .and_then(|b| Config::parse(&b))
            .filter(|c| match c.mode {
                Mode::Server => {
                    normalized_url(&c.server.base_url, "助手服务地址").is_ok()
                        && !c.server.token.is_empty()
                }
                Mode::Local => true,
            });
        if let Some(mut config) = config {
            // Move any legacy plaintext key into the OS credential store and
            // rewrite the config scrubbed; hydrate the in-memory key either way.
            if credentials::hydrate(&mut config.local, &credentials::PlatformStore) {
                let _ = persist(&app, &config);
            }
            start(&app, &mut inner, config);
        } else {
            inner.view.connection = "unconfigured".into();
        }
    }
    inner.view.clone()
}

#[tauri::command]
pub async fn save_agent_settings(app: AppHandle, settings: Settings) -> Result<View, String> {
    blocking_config(move || save_agent_settings_blocking(app, settings)).await?
}

fn save_agent_settings_blocking(app: AppHandle, settings: Settings) -> Result<View, String> {
    let state = app.state::<AgentState>();
    let mut inner = state.lock();
    let mut config = inner.config.clone().unwrap_or_default();
    match settings.mode {
        Mode::Server => {
            let base_url = normalized_url(&settings.base_url, "助手服务地址")?;
            let same = config.server.base_url == base_url;
            let token_input = settings.token.trim();
            let token = if token_input.is_empty() {
                if same && !config.server.token.is_empty() {
                    config.server.token.clone()
                } else {
                    return Err("更换地址必须重新输入该服务的设备凭证".into());
                }
            } else {
                token_input.to_owned()
            };
            if token.chars().any(char::is_control) {
                return Err("设备凭证格式不正确".into());
            }
            let session_id = if same && config.server.token == token {
                config.server.session_id.clone()
            } else {
                None
            };
            config.server = ServerConfig {
                base_url,
                token,
                session_id,
            };
        }
        Mode::Local => {
            let stored = config.local.clone();
            let url_input = settings.local_base_url.trim();
            let base_url = if url_input.is_empty() {
                stored.base_url.clone()
            } else {
                normalized_url(url_input, "模型服务地址")?
            };
            let key_input = settings.local_api_key.trim();
            if key_input.chars().any(char::is_control) {
                return Err("API Key 格式不正确".into());
            }
            // The key lands in the OS credential store before the config file
            // is rewritten, so plaintext never reaches the disk.
            let api_key =
                credentials::save_key(&credentials::PlatformStore, key_input, &base_url, &stored)?;
            let model_input = settings.local_model.trim();
            let model = if model_input.is_empty() {
                stored.model.clone()
            } else {
                model_input.to_owned()
            };
            config.local = LocalConfig {
                base_url,
                api_key,
                model,
                ..stored
            };
        }
    }
    config.mode = settings.mode;
    persist(&app, &config)?;
    inner.initialized = true;
    start(&app, &mut inner, config);
    let _ = app.emit("agent:view", &inner.view);
    Ok(inner.view.clone())
}

#[tauri::command]
pub async fn agent_list_models(app: AppHandle, base_url: String, api_key: String) -> Result<Vec<String>, String> {
    let stored = {
        let state = app.state::<AgentState>();
        let inner = state.lock();
        inner.config.as_ref().map(|config| config.local.effective())
    };
    let url_input = base_url.trim();
    let base_url = if url_input.is_empty() {
        stored
            .as_ref()
            .map(|config| config.base_url.clone())
            .filter(|url| !url.is_empty())
            .ok_or("请输入模型服务地址")?
    } else {
        normalized_url(url_input, "模型服务地址")?
    };
    let key_input = api_key.trim();
    let api_key = if !key_input.is_empty() {
        key_input.to_owned()
    } else {
        stored
            .filter(|config| config.base_url == base_url)
            .map(|config| config.api_key)
            .unwrap_or_default()
    };
    crate::llm::list_models(&base_url, &api_key).await
}

#[tauri::command]
pub async fn agent_submit(app: AppHandle, request_id: String, text: String) -> Result<(), String> {
    if text.trim().is_empty() || text.len() > 32000 || uuid::Uuid::parse_str(&request_id).is_err() {
        return Err("消息或请求标识不正确".into());
    }
    let mode = {
        let state = app.state::<AgentState>();
        let inner = state.lock();
        inner.config.as_ref().map(|config| config.mode).unwrap_or_default()
    };
    match mode {
        Mode::Server => server::ServerBackend::submit(&app, request_id, text).await,
        Mode::Local => local::LocalBackend::submit(&app, request_id, text).await,
    }
}

#[cfg(test)]
mod tests {
    #[tokio::test(flavor = "current_thread")]
    async fn credential_wait_does_not_block_the_async_executor() {
        let caller = std::thread::current().id();
        let (started, ready) = tokio::sync::oneshot::channel();
        let (release, wait) = std::sync::mpsc::channel();
        let task = tokio::spawn(super::blocking_config(move || {
            let _ = started.send(std::thread::current().id());
            wait.recv_timeout(std::time::Duration::from_secs(2)).unwrap();
            7
        }));
        let worker = tokio::time::timeout(std::time::Duration::from_millis(500), ready).await.unwrap().unwrap();
        assert_ne!(worker, caller);
        tokio::time::timeout(std::time::Duration::from_millis(500), tokio::time::sleep(std::time::Duration::from_millis(5))).await.unwrap();
        release.send(()).unwrap();
        assert_eq!(task.await.unwrap().unwrap(), 7);
    }

    use super::*;

    #[test]
    fn legacy_config_migrates_to_server_mode() {
        let legacy = serde_json::json!({
            "base_url": "http://127.0.0.1:18081",
            "token": "device-token",
            "session_id": "session-1",
        });
        let config = Config::parse(legacy.to_string().as_bytes()).unwrap();
        assert_eq!(config.mode, Mode::Server);
        assert_eq!(config.server.base_url, "http://127.0.0.1:18081");
        assert_eq!(config.server.token, "device-token");
        assert_eq!(config.server.session_id.as_deref(), Some("session-1"));
        assert_eq!(config.local.timeout_secs, 90);
        assert_eq!(config.local.timezone, "Asia/Shanghai");
    }

    #[test]
    fn dual_mode_config_keeps_both_sections() {
        let bytes = serde_json::to_vec(&serde_json::json!({
            "mode": "local",
            "server": {"base_url": "https://assistant.example.com", "token": "t", "session_id": null},
            "local": {"base_url": "https://api.example.com/v1", "api_key": "k", "model": "m"},
        }))
        .unwrap();
        let config = Config::parse(&bytes).unwrap();
        assert_eq!(config.mode, Mode::Local);
        assert_eq!(config.server.base_url, "https://assistant.example.com");
        assert!(config.local.model_configured());
        assert_eq!(config.local.timeout_secs, 90);
        let roundtrip = Config::parse(&serde_json::to_vec(&config).unwrap()).unwrap();
        assert_eq!(roundtrip.local.model, "m");
    }

    #[test]
    fn persisted_config_never_contains_the_local_api_key() {
        let config = Config {
            mode: Mode::Local,
            local: LocalConfig {
                base_url: "https://api.example.com/v1".into(),
                api_key: "unit-only-secret".into(),
                model: "m".into(),
                ..Default::default()
            },
            ..Default::default()
        };
        let bytes = serde_json::to_vec(&config).unwrap();
        let text = String::from_utf8(bytes.clone()).unwrap();
        assert!(!text.contains("unit-only-secret"));
        assert!(!text.contains("api_key"));
        // Deserialization still accepts the legacy field so it can migrate.
        let legacy = serde_json::json!({"mode": "local", "local": {"api_key": "unit-only-secret"}});
        let parsed = Config::parse(legacy.to_string().as_bytes()).unwrap();
        assert_eq!(parsed.local.api_key, "unit-only-secret");
    }

    #[test]
    fn local_env_fallback_only_fills_empty_fields() {
        let stored = LocalConfig {
            base_url: "https://api.example.com/v1".into(),
            ..Default::default()
        };
        let env = |key: &str| match key {
            "PET_AGENT_MODEL_BASE_URL" => Some("https://env.example.com/v1".into()),
            "PET_AGENT_MODEL_API_KEY" => Some("env-key".into()),
            "PET_AGENT_MODEL_NAME" => Some("env-model".into()),
            _ => None,
        };
        let resolved = stored.resolve(env);
        assert_eq!(resolved.base_url, "https://api.example.com/v1");
        assert_eq!(resolved.api_key, "env-key");
        assert_eq!(resolved.model, "env-model");
        assert!(resolved.model_configured());
        let empty = LocalConfig::default().resolve(|_| None);
        assert!(!empty.model_configured());
    }

    #[test]
    fn todo_query_does_not_require_model_or_websockets() {
        assert!(todo_config(&Inner::default()).is_err());
        let mut inner = Inner {
            config: Some(Config {
                mode: Mode::Server,
                server: ServerConfig {
                    base_url: "http://127.0.0.1:1".into(),
                    token: "unit-only".into(),
                    session_id: None,
                },
                local: LocalConfig::default(),
            }),
            ..Default::default()
        };
        inner.view.generation = 7;
        let (_, generation) = todo_config(&inner).unwrap();
        assert_eq!(generation, 7);
        assert!(!inner.view.model_configured);
        assert!(!inner.view.node_connected);
        assert!(inner.sender.is_none());
    }

    #[test]
    fn todo_commands_require_the_local_store_in_local_mode() {
        let inner = Inner {
            config: Some(Config {
                mode: Mode::Local,
                ..Default::default()
            }),
            ..Default::default()
        };
        assert!(todo_config(&inner).err().unwrap().contains("本地存储"));
    }

    fn isolated_reminder() -> Todo {
        Todo { id: "00000000-0000-0000-0000-000000000001".into(), title: "isolated".into(),
            status: TodoStatus::Pending, created_at: "2026-09-07T00:00:00Z".into(),
            remind_at: Some("2026-09-07T08:00:00Z".into()) }
    }

    #[test]
    fn reminder_poll_preserves_failed_data_and_rejects_mutation_or_generation_races() {
        let mut inner = Inner::default();
        inner.view.generation = 4;
        let due = vec![isolated_reminder()];
        assert!(apply_reminder_poll(&mut inner, 4, 0, Ok(due.clone())));
        assert!(!apply_reminder_poll(&mut inner, 4, 0, Ok(due.clone())));
        assert!(apply_reminder_poll(&mut inner, 4, 0, Err("offline".into())));
        assert_eq!(inner.view.reminders, due);
        assert!(!apply_reminder_poll(&mut inner, 3, 0, Ok(vec![])));
        assert_eq!(inner.view.reminders, due);
        inner.todo_mutation_epoch = 1;
        inner.todo_writes_in_flight = 1;
        assert!(!apply_reminder_poll(&mut inner, 4, 0, Ok(vec![])));
        assert!(!apply_reminder_poll(&mut inner, 4, 1, Ok(vec![])));
        let mut completed = isolated_reminder();
        completed.status = TodoStatus::Completed;
        completed.remind_at = None;
        apply_todo_write(&mut inner, 4, Ok(completed)).unwrap();
        assert!(inner.view.reminders.is_empty());
        assert_eq!(inner.view.todo_revision, 1);
        assert_eq!(inner.todo_writes_in_flight, 0);
        assert!(!apply_reminder_poll(&mut inner, 4, 1, Ok(due.clone())));
        assert!(apply_reminder_poll(&mut inner, 4, 2, Ok(vec![]))); // clears error
        inner.view.reminders = due.clone();
        inner.todo_writes_in_flight = 1;
        assert!(apply_todo_write(&mut inner, 4, Err("uncertain".into())).is_err());
        assert_eq!(inner.view.reminders, due);
        assert_eq!(inner.todo_writes_in_flight, 0);
        assert_eq!(inner.view.todo_revision, 1);
        let epoch = inner.todo_mutation_epoch;
        assert!(apply_todo_write(&mut inner, 3, Ok(isolated_reminder())).is_err());
        assert_eq!(inner.todo_mutation_epoch, epoch);
    }

    #[test]
    fn remote_credentials_require_tls_and_clean_origin() {
        assert!(normalized_url("http://example.com", "助手服务地址").is_err());
        assert!(normalized_url("https://secret@example.com", "助手服务地址").is_err());
        assert!(normalized_url("https://example.com?token=secret", "助手服务地址").is_err());
        assert!(normalized_url("http://127.0.0.1:8000", "助手服务地址").is_ok());
        assert!(normalized_url("https://example.com/", "模型服务地址").is_ok());
        assert!(normalized_url("not a url", "模型服务地址").unwrap_err().contains("模型服务地址"));
    }
}
