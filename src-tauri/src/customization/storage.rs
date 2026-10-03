use super::*;
use serde::de::DeserializeOwned;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub const MAX_DISK_IMAGE: usize = 20 * 1024 * 1024;

pub fn valid_id(id: &str) -> bool {
    uuid::Uuid::parse_str(id).is_ok_and(|uuid| uuid.to_string() == id)
}
pub fn valid_kind(kind: &str) -> bool {
    kind.strip_prefix("badge-").is_some_and(valid_id)
        || KINDS.contains(&kind)
        || matches!(
            kind,
            "reference-0" | "reference-1" | "reference-2" | "reference-3"
        )
}
pub fn name(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 40 || trimmed.chars().any(char::is_control) {
        Err("名字应为 1–40 个可见字符".into())
    } else {
        Ok(trimmed.into())
    }
}
pub fn accent(value: &str) -> Result<String, String> {
    if value.len() == 7
        && value.starts_with('#')
        && value[1..].bytes().all(|v| v.is_ascii_hexdigit())
    {
        Ok(value.to_lowercase())
    } else {
        Err("请选择有效的主题主色".into())
    }
}
pub fn read(path: &Path, max: usize) -> Result<Vec<u8>, String> {
    let meta = fs::symlink_metadata(path).map_err(|_| "无法读取定制文件")?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > max as u64 {
        return Err("定制文件超过限制或类型无效".into());
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|_| "无法读取定制文件")?
        .take(max as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取定制文件")?;
    if bytes.len() > max {
        return Err("定制文件超过限制".into());
    }
    Ok(bytes)
}
pub fn asset_path(root: &Path, id: &str, kind: &str) -> Result<PathBuf, String> {
    if !valid_id(id) || !valid_kind(kind) {
        return Err("无效的定制资产标识".into());
    }
    let dir = root.join("assets").join(id);
    if fs::symlink_metadata(&dir).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("定制目录不可为符号链接".into());
    }
    Ok(dir.join(format!("{kind}.png")))
}
pub fn atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("无效的定制保存路径")?;
    fs::create_dir_all(parent).map_err(|_| "无法创建定制目录")?;
    let temp = parent.join(format!(".{}.tmp", uuid::Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| {
        let mut file = options.open(&temp).map_err(|_| "无法写入定制文件")?;
        file.write_all(bytes).map_err(|_| "无法写入定制文件")?;
        file.sync_all().map_err(|_| "无法同步定制文件")?;
        fs::rename(&temp, path).map_err(|_| "无法提交定制文件")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}
fn json<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    serde_json::from_slice(&read(path, 2 * 1024 * 1024)?)
        .map_err(|_| "定制记录已损坏，原文件已保留".into())
}
pub fn load(root: &Path) -> Result<Store, String> {
    let path = root.join("state.json");
    if !path.exists() {
        return Ok(Store::default());
    }
    let mut store: Store = json(&path)?;
    if store.version != 1
        || (store.active_id != "default" && !valid_id(&store.active_id))
        || store.presets.iter().any(|p| {
            !valid_id(&p.id)
                || accent(&p.accent).is_err()
                || name(&p.name).is_err()
                || p.theme.as_ref().is_some_and(|t| t.validate().is_err())
                || p.colors.len() > 4
                || p.colors.iter().any(|c| accent(c).is_err())
        })
        || store
            .job
            .as_ref()
            .is_some_and(|j| !valid_id(&j.view.id) || j.references == 0 || j.references > 4)
    {
        return Err("定制记录版本或内容无效，原文件已保留".into());
    }
    let mut changed = false;
    // Add bounded local palette candidates without changing any saved appearance.
    // A missing image remains the existing recoverable asset error, not a load failure.
    for preset in &mut store.presets {
        if preset.colors_version < super::assets::COLORS_VERSION {
            if let Ok(colors) = asset_path(root, &preset.id, "base")
                .and_then(|path| read(&path, MAX_DISK_IMAGE))
                .and_then(|bytes| super::assets::character_colors(&bytes))
            {
                preset.colors = colors;
                preset.colors_version = super::assets::COLORS_VERSION;
                changed = true;
            }
        }
    }
    if let Some(job) = store.badge_job.as_mut() {
        if !valid_id(&job.id) || !valid_id(&job.preset_id) {
            return Err("标志任务记录无效".into());
        }
        if job.status == "running" {
            job.status = "interrupted".into();
            job.error = Some("上次标志生成已中断；点击重新生成才会请求".into());
            changed = true;
        }
    }

    if let Some(job) = store.job.as_mut() {
        if job.view.status == "running" {
            job.view.status = "interrupted".into();
            job.view.error = Some("上次生成被中断；已完成图片保留，点击继续才会重新请求".into());
            changed = true;
        }
    }
    if store.active_id != "default" && validate_preset(root, &store, &store.active_id).is_err() {
        store.active_id = "default".into();
        store.warning =
            Some("上次定制的素材损坏或缺失，已恢复默认桌宠；保存的方案记录仍保留".into());
        changed = true;
    }
    if changed {
        store.revision = store.revision.checked_add(1).ok_or("定制版本超出限制")?;
        save(root, &store)?;
    }
    Ok(store)
}
pub fn save(root: &Path, store: &Store) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(store).map_err(|_| "无法保存定制记录")?;
    atomic(&root.join("state.json"), &bytes)
}
pub fn validate_preset(root: &Path, store: &Store, id: &str) -> Result<(), String> {
    let preset = store
        .presets
        .iter()
        .find(|p| p.id == id)
        .ok_or("找不到这个桌宠方案")?;
    for kind in KINDS {
        let meta = preset.assets.get(kind).ok_or("桌宠方案缺少状态图片")?;
        if (meta.width, meta.height) != (assets::WIDTH, assets::HEIGHT) {
            return Err("桌宠图片尺寸无效".into());
        }
        let bytes = read(&asset_path(root, id, kind)?, MAX_DISK_IMAGE)?;
        assets::generated(&bytes)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_path_traversal_and_invalid_names() {
        let root = Path::new("/tmp/test");
        assert!(asset_path(root, "../keys", "base").is_err());
        assert!(asset_path(root, &uuid::Uuid::new_v4().to_string(), "../../config").is_err());
        assert!(name(" \n ").is_err());
        assert!(accent("red").is_err());
    }
    #[test]
    fn restart_interrupts_without_charging_and_keeps_defaults() {
        let root = std::env::temp_dir().join(format!("pet-custom-test-{}", uuid::Uuid::new_v4()));
        let mut store = Store::default();
        store.job = Some(Job {
            view: JobView {
                id: uuid::Uuid::new_v4().to_string(),
                name: "测试".into(),
                status: "running".into(),
                stage: "closed".into(),
                completed: vec!["base".into()],
                request_count: 2,
                error: None,
            },
            references: 1,
            attempt: 1,
            badge: None,
        });
        save(&root, &store).unwrap();
        let loaded = load(&root).unwrap();
        assert_eq!(loaded.job.as_ref().unwrap().view.status, "interrupted");
        assert_eq!(loaded.job.unwrap().view.request_count, 2);
        assert_eq!(loaded.active_id, "default");
        assert_eq!(loaded.revision, 1);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn missing_active_asset_restores_default_but_preserves_saved_record() {
        let root = std::env::temp_dir().join(format!("pet-custom-test-{}", uuid::Uuid::new_v4()));
        let mut store = Store::default();
        let id = uuid::Uuid::new_v4().to_string();
        store.active_id = id.clone();
        store.presets.push(Preset {
            theme: None,
            colors: vec![],
            colors_version: 0,
            id,
            name: "保留方案".into(),
            accent: "#987654".into(),
            created_at: "test".into(),
            assets: BTreeMap::new(),
            badge: None,
        });
        save(&root, &store).unwrap();
        let actual = load(&root).unwrap();
        assert_eq!(actual.active_id, "default");
        assert_eq!(actual.presets.len(), 1);
        assert!(actual.warning.unwrap().contains("损坏或缺失"));
        assert_eq!(load(&root).unwrap().active_id, "default");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn backfills_colors_once_without_switching_legacy_theme_or_touching_image() {
        // Synthetic PNG fixture owned entirely by this test.
        let root = std::env::temp_dir().join(format!("pet-theme-test-{}", uuid::Uuid::new_v4()));
        let id = uuid::Uuid::new_v4().to_string();
        let image = image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            64,
            64,
            image::Rgba([194, 123, 61, 255]),
        ));
        let mut buffer = std::io::Cursor::new(Vec::new());
        image
            .write_to(&mut buffer, image::ImageFormat::Png)
            .unwrap();
        let bytes = buffer.into_inner();
        let path = asset_path(&root, &id, "base").unwrap();
        atomic(&path, &bytes).unwrap();
        let mut store = Store::default();
        store.presets.push(Preset {
            id,
            name: "test".into(),
            accent: "#b3a469".into(),
            theme: None,
            colors: vec![],
            colors_version: 0,
            created_at: "test".into(),
            assets: BTreeMap::new(),
            badge: None,
        });
        save(&root, &store).unwrap();
        let loaded = load(&root).unwrap();
        assert_eq!(loaded.presets[0].accent, "#b3a469");
        assert!(loaded.presets[0].theme.is_none());
        assert_eq!(loaded.presets[0].colors, vec!["#c27b3d"]);
        assert_eq!(loaded.active_id, "default");
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(load(&root).unwrap().revision, loaded.revision);
        assert_eq!(
            loaded.presets[0].colors_version,
            super::super::assets::COLORS_VERSION
        );
        let mut cached = loaded;
        cached.presets[0].colors_version = 1;
        cached.presets[0].colors = vec!["#c8b8b2".into()];
        cached.presets[0].theme = Some(super::super::Theme {
            palette: "character".into(),
            primary: "#c8b8b2".into(),
            secondary: "#483832".into(),
            strength: 65,
        });
        save(&root, &cached).unwrap();
        let refreshed = load(&root).unwrap();
        assert_eq!(refreshed.presets[0].colors, vec!["#c27b3d"]);
        assert_eq!(refreshed.presets[0].theme, cached.presets[0].theme);
        assert_eq!(refreshed.presets[0].accent, cached.presets[0].accent);
        assert_eq!(load(&root).unwrap().revision, refreshed.revision);
        assert_eq!(fs::read(&path).unwrap(), bytes);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn badge_restart_interrupts_without_automatic_request() {
        let root = std::env::temp_dir().join(format!("pet-badge-test-{}", uuid::Uuid::new_v4()));
        let mut store = Store::default();
        store.badge_job = Some(BadgeJob {
            id: uuid::Uuid::new_v4().to_string(),
            preset_id: uuid::Uuid::new_v4().to_string(),
            status: "running".into(),
            request_count: 3,
            result: None,
            error: None,
        });
        save(&root, &store).unwrap();
        let loaded = load(&root).unwrap();
        assert_eq!(loaded.badge_job.as_ref().unwrap().status, "interrupted");
        assert_eq!(loaded.badge_job.as_ref().unwrap().request_count, 3);
        assert!(!loaded.running());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn corrupt_store_is_not_overwritten() {
        let root = std::env::temp_dir().join(format!("pet-custom-test-{}", uuid::Uuid::new_v4()));
        atomic(&root.join("state.json"), b"bad json").unwrap();
        assert!(load(&root).is_err());
        assert_eq!(fs::read(root.join("state.json")).unwrap(), b"bad json");
        fs::remove_dir_all(root).unwrap();
    }
}
