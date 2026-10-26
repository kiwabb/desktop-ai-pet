//! Companion-only preferences. This file never reads or writes credentials.
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Mutex};

pub const FILE_NAME: &str = "companion-preferences.json";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompanionPreferences {
    pub scale: f64,
    pub always_on_top: bool,
}

impl Default for CompanionPreferences {
    fn default() -> Self {
        Self {
            scale: 1.0,
            always_on_top: true,
        }
    }
}

impl CompanionPreferences {
    pub fn validate(self) -> Result<Self, String> {
        if [0.8, 1.0, 1.2].contains(&self.scale) {
            Ok(self)
        } else {
            Err("桌宠大小仅支持 80%、100% 或 120%".to_owned())
        }
    }
}

pub struct CompanionPreferencesState {
    pub current: Mutex<CompanionPreferences>,
    pub write_lock: tokio::sync::Mutex<()>,
}

impl CompanionPreferencesState {
    pub fn new(preferences: CompanionPreferences) -> Self {
        Self {
            current: Mutex::new(preferences),
            write_lock: tokio::sync::Mutex::new(()),
        }
    }
    pub fn get(&self) -> Result<CompanionPreferences, String> {
        Ok(*self
            .current
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()))
    }
}

pub fn load(path: &Path) -> Result<CompanionPreferences, String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(CompanionPreferences::default())
        }
        Err(error) => return Err(format!("读取桌宠偏好失败：{error}")),
    };
    serde_json::from_slice::<CompanionPreferences>(&bytes)
        .map_err(|error| format!("桌宠偏好格式无效：{error}"))?
        .validate()
}

pub fn save(path: &Path, preferences: CompanionPreferences) -> Result<(), String> {
    let preferences = preferences.validate()?;
    let directory = path.parent().ok_or("桌宠偏好目录无效")?;
    std::fs::create_dir_all(directory).map_err(|error| format!("创建桌宠偏好目录失败：{error}"))?;
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(&preferences).map_err(|error| error.to_string())?;
    std::fs::write(&temporary, bytes).map_err(|error| format!("写入桌宠偏好失败：{error}"))?;
    std::fs::rename(&temporary, path).map_err(|error| format!("保存桌宠偏好失败：{error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_explicit_presets() {
        for scale in [0.8, 1., 1.2] {
            assert!(CompanionPreferences {
                scale,
                always_on_top: false
            }
            .validate()
            .is_ok());
        }
        for scale in [0., -1., 0.9, 1.21, f64::NAN, f64::INFINITY] {
            assert!(CompanionPreferences {
                scale,
                always_on_top: true
            }
            .validate()
            .is_err());
        }
    }
    #[test]
    fn wire_shape_is_camel_case_and_contains_no_other_configuration() {
        let preferences = CompanionPreferences::default();
        assert_eq!(
            serde_json::to_value(preferences).unwrap(),
            serde_json::json!({"scale":1.0,"alwaysOnTop":true})
        );
        assert!(serde_json::from_str::<CompanionPreferences>(
            r#"{"scale":1,"alwaysOnTop":true,"token":"unused"}"#
        )
        .is_err());
    }
    #[test]
    fn separate_preference_file_round_trips_and_invalid_write_preserves_prior_data() {
        let directory = std::env::temp_dir().join(format!(
            "companion-preferences-test-{}",
            uuid::Uuid::new_v4()
        ));
        let path = directory.join(FILE_NAME);
        assert_eq!(load(&path).unwrap(), CompanionPreferences::default());
        let saved = CompanionPreferences {
            scale: 0.8,
            always_on_top: false,
        };
        save(&path, saved).unwrap();
        assert_eq!(load(&path).unwrap(), saved);
        assert!(save(&path, CompanionPreferences { scale: 5., ..saved }).is_err());
        assert_eq!(load(&path).unwrap(), saved);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
