use super::{
    apply_memo_review_poll, apply_reminder_poll, normalized_url, AgentBackend, AgentState, Config,
    Inner, LocalConfig, Mode, View,
};
use crate::agent_protocol::Snapshot;
use crate::local_agent::{runtime, store::Store};
use chrono::Utc;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

pub struct LocalBackend;

/// (configured, model_configured): the local runtime is always ready once
/// anything is configured, so a partial setup mirrors the server mode's
/// "connected, model missing" shape instead of an alarming disconnect; a
/// fully empty setup is unconfigured and the UI offers the settings page.
fn readiness(local: &LocalConfig) -> (bool, bool) {
    let valid_url =
        local.base_url.is_empty() || normalized_url(&local.base_url, "模型服务地址").is_ok();
    let configured =
        !local.base_url.is_empty() || !local.api_key.is_empty() || !local.model.is_empty();
    (configured, valid_url && local.model_configured())
}

/// The database lives next to agent-config.json in the app config directory.
fn open_store(app: &AppHandle) -> Result<Arc<Store>, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|_| "无法访问助手配置目录")?
        .join("agent-local.db");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| "无法创建助手配置目录")?;
    }
    Store::open(&path)
        .map(Arc::new)
        .map_err(|error| error.message())
}

/// Restart/generation recovery (runtime_store.recover_expired): interrupted
/// runs are finalized, then history is restored from the durable snapshot.
fn restore_session(store: &Store) -> Snapshot {
    if store.recover_interrupted().is_err() {
        return Snapshot::default();
    }
    let session_id = match store.latest_session() {
        Ok(Some(id)) => id,
        _ => match store.create_session() {
            Ok(id) => id,
            Err(_) => return Snapshot::default(),
        },
    };
    store.snapshot(&session_id).unwrap_or_else(|_| Snapshot {
        session_id,
        ..Default::default()
    })
}

/// Same 15s polling shape as the server mode, sourced from the local store.
async fn poll_reminders(app: AppHandle, generation: u64, store: Arc<Store>) {
    loop {
        let epoch = {
            let state = app.state::<AgentState>();
            let inner = state.lock();
            if inner.view.generation != generation {
                return;
            }
            inner.todo_mutation_epoch
        };
        let result = crate::local_agent::plugins::todo::TodoStore::new(&store)
            .due_reminders(Utc::now())
            .map_err(|error| error.message());
        {
            let state = app.state::<AgentState>();
            let mut inner = state.lock();
            if apply_reminder_poll(&mut inner, generation, epoch, result) {
                inner.view.revision += 1;
                let _ = app.emit("agent:view", &inner.view);
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(15)).await;
    }
}

/// Same 15s polling shape as poll_reminders, sourced from the local memo store.
async fn poll_memo_reviews(app: AppHandle, generation: u64, store: Arc<Store>) {
    loop {
        let epoch = {
            let state = app.state::<AgentState>();
            let inner = state.lock();
            if inner.view.generation != generation {
                return;
            }
            inner.todo_mutation_epoch
        };
        let result = crate::local_agent::plugins::memo::MemoStore::new(&store)
            .due_reviews(Utc::now())
            .map_err(|error| error.message());
        {
            let state = app.state::<AgentState>();
            let mut inner = state.lock();
            if apply_memo_review_poll(&mut inner, generation, epoch, result) {
                inner.view.revision += 1;
                let _ = app.emit("agent:view", &inner.view);
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(15)).await;
    }
}

impl AgentBackend for LocalBackend {
    fn start(
        app: &AppHandle,
        inner: &mut Inner,
        generation: u64,
        config: &Config,
    ) -> Option<tauri::async_runtime::JoinHandle<()>> {
        let local = config.local.effective();
        let (configured, model_configured) = readiness(&local);
        let (store, snapshot, storage_error) = match open_store(app) {
            Ok(store) => {
                let snapshot = restore_session(&store);
                (Some(store), snapshot, None)
            }
            Err(error) => (
                None,
                Snapshot {
                    session_id: uuid::Uuid::new_v4().to_string(),
                    ..Default::default()
                },
                Some(error),
            ),
        };
        let storage_available = store.is_some();
        inner.store = store.clone();
        inner.view = View {
            generation,
            mode: Mode::Local,
            configured,
            endpoint: (!local.base_url.is_empty()).then_some(local.base_url.clone()),
            connection: if !storage_available {
                "disconnected"
            } else if configured {
                "connected"
            } else {
                "unconfigured"
            }
            .into(),
            node_connected: true,
            model: (!local.model.is_empty()).then_some(local.model.clone()),
            model_configured,
            error: storage_error,
            snapshot,
            ..Default::default()
        };
        store.map(|store| {
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                let memo_store = store.clone();
                let memo_handle = handle.clone();
                tokio::join!(
                    poll_reminders(handle, generation, store),
                    poll_memo_reviews(memo_handle, generation, memo_store),
                );
            })
        })
    }

    async fn submit(app: &AppHandle, request_id: String, text: String) -> Result<(), String> {
        runtime::submit(app, request_id, text).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readiness_mirrors_server_mode_unconfigured_shapes() {
        assert_eq!(readiness(&LocalConfig::default()), (false, false));
        let partial = LocalConfig {
            base_url: "http://127.0.0.1:11434/v1".into(),
            ..Default::default()
        };
        assert_eq!(readiness(&partial), (true, false));
        let full = LocalConfig {
            base_url: "http://127.0.0.1:11434/v1".into(),
            api_key: "k".into(),
            model: "m".into(),
            ..Default::default()
        };
        assert_eq!(readiness(&full), (true, true));
        let bad_url = LocalConfig {
            base_url: "http://remote.example.com".into(),
            ..full
        };
        assert_eq!(readiness(&bad_url), (true, false));
    }

    #[test]
    fn restore_recovers_interrupted_runs_and_history() {
        let store = Store::open_memory();
        let session = store.create_session().unwrap();
        store
            .submit(&session, &uuid::Uuid::new_v4().to_string(), "历史消息")
            .unwrap();
        let claimed = store.claim(&session).unwrap().unwrap();
        store.append_delta(&claimed.run.id, "部分回复").unwrap();
        // Simulate a crash: the run is still running when the session restores.
        let snapshot = restore_session(&store);
        assert_eq!(snapshot.session_id, session);
        assert_eq!(snapshot.messages.len(), 2);
        assert_eq!(snapshot.messages[0].content, "历史消息");
        assert_eq!(snapshot.messages[1].content, "部分回复");
        assert!(snapshot
            .runs
            .iter()
            .all(|run| run.status == crate::agent_protocol::RunStatus::Interrupted));
        assert!(store
            .submit(&session, &uuid::Uuid::new_v4().to_string(), "新消息")
            .is_ok());
    }
}
