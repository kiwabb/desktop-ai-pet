//! Local-mode model API key lives in the OS credential store (macOS Keychain,
//! Windows Credential Manager, Linux Secret Service), never on disk: the
//! `LocalConfig.api_key` field is in-memory only (`skip_serializing`), hydrated
//! from here at startup and updated here before any settings save persists.

use super::LocalConfig;

/// Stable identifiers shared by every install, so the key survives updates.
const SERVICE: &str = "desktop-ai-pet";
const ACCOUNT: &str = "local-llm-api-key";

/// Credential access abstracted so tests never touch a real keychain.
pub trait CredentialStore {
    fn get(&self) -> Result<Option<String>, String>;
    fn set(&self, secret: &str) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}

/// Production store backed by the OS credential manager.
pub struct PlatformStore;

impl PlatformStore {
    fn entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, ACCOUNT).map_err(|_| "系统凭据存储不可用".to_owned())
    }
}

impl CredentialStore for PlatformStore {
    fn get(&self) -> Result<Option<String>, String> {
        match Self::entry()?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("无法读取系统凭据存储中的 API Key".into()),
        }
    }

    fn set(&self, secret: &str) -> Result<(), String> {
        Self::entry()?
            .set_password(secret)
            .map_err(|_| "无法将 API Key 保存到系统凭据存储".into())
    }

    fn delete(&self) -> Result<(), String> {
        match Self::entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("无法清除系统凭据存储中的 API Key".into()),
        }
    }
}

/// Startup reconciliation: a legacy plaintext key (written before the keyring
/// migration) moves into the store; otherwise the in-memory field is hydrated
/// from the store. Returns true when the caller must rewrite the config file to
/// scrub migrated plaintext. On store failure the plaintext stays untouched, so
/// nothing is lost and the migration retries on the next launch.
pub fn hydrate(config: &mut LocalConfig, store: &impl CredentialStore) -> bool {
    if !config.api_key.is_empty() {
        return store.set(&config.api_key).is_ok();
    }
    config.api_key = store.get().ok().flatten().unwrap_or_default();
    false
}

/// Settings save: a fresh key goes to the store before the config is persisted,
/// so plaintext never reaches the disk; switching endpoints without a fresh key
/// drops the stale credential instead of leaking it across services.
pub fn save_key(
    store: &impl CredentialStore,
    key_input: &str,
    base_url: &str,
    stored: &LocalConfig,
) -> Result<String, String> {
    if !key_input.is_empty() {
        store.set(key_input)?;
        return Ok(key_input.to_owned());
    }
    if base_url == stored.base_url {
        return Ok(stored.api_key.clone());
    }
    let _ = store.delete();
    Ok(String::new())
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::cell::RefCell;

    /// In-memory stand-in; the real keychain is never touched from tests.
    pub struct MemoryStore {
        pub secret: RefCell<Option<String>>,
        pub fail_writes: bool,
    }

    impl MemoryStore {
        pub fn with(secret: Option<&str>) -> Self {
            Self {
                secret: RefCell::new(secret.map(str::to_owned)),
                fail_writes: false,
            }
        }
    }

    impl CredentialStore for MemoryStore {
        fn get(&self) -> Result<Option<String>, String> {
            Ok(self.secret.borrow().clone())
        }
        fn set(&self, secret: &str) -> Result<(), String> {
            if self.fail_writes {
                return Err("unit-only store failure".into());
            }
            *self.secret.borrow_mut() = Some(secret.to_owned());
            Ok(())
        }
        fn delete(&self) -> Result<(), String> {
            *self.secret.borrow_mut() = None;
            Ok(())
        }
    }

    #[test]
    fn legacy_plaintext_migrates_into_the_store() {
        let store = MemoryStore::with(None);
        let mut config = LocalConfig {
            api_key: "legacy-key".into(),
            ..Default::default()
        };
        assert!(hydrate(&mut config, &store), "caller must scrub the config file");
        assert_eq!(*store.secret.borrow(), Some("legacy-key".to_owned()));
        // The in-memory field keeps the key so the running session still works.
        assert_eq!(config.api_key, "legacy-key");
    }

    #[test]
    fn failed_migration_keeps_plaintext_for_next_launch_retry() {
        let store = MemoryStore {
            fail_writes: true,
            ..MemoryStore::with(None)
        };
        let mut config = LocalConfig {
            api_key: "legacy-key".into(),
            ..Default::default()
        };
        assert!(!hydrate(&mut config, &store), "no scrub rewrite without a durable copy");
        assert_eq!(config.api_key, "legacy-key");
    }

    #[test]
    fn hydration_loads_the_stored_key_and_tolerates_an_empty_store() {
        let store = MemoryStore::with(Some("stored-key"));
        let mut config = LocalConfig::default();
        assert!(!hydrate(&mut config, &store));
        assert_eq!(config.api_key, "stored-key");
        let empty = MemoryStore::with(None);
        let mut config = LocalConfig::default();
        assert!(!hydrate(&mut config, &empty));
        assert!(config.api_key.is_empty());
    }

    #[test]
    fn save_key_stores_fresh_keys_and_drops_stale_ones() {
        let stored = LocalConfig {
            base_url: "https://api.example.com/v1".into(),
            api_key: "old-key".into(),
            ..Default::default()
        };
        let store = MemoryStore::with(Some("old-key"));
        assert_eq!(
            save_key(&store, "new-key", &stored.base_url, &stored).unwrap(),
            "new-key"
        );
        assert_eq!(*store.secret.borrow(), Some("new-key".to_owned()));
        assert_eq!(save_key(&store, "", &stored.base_url, &stored).unwrap(), "old-key");
        assert_eq!(
            save_key(&store, "", "https://other.example.com/v1", &stored).unwrap(),
            ""
        );
        assert_eq!(*store.secret.borrow(), None);
        let failing = MemoryStore {
            fail_writes: true,
            ..MemoryStore::with(None)
        };
        assert!(save_key(&failing, "new-key", &stored.base_url, &stored).is_err());
    }
}
