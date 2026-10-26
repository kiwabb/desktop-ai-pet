//! Local run executor: submit → durable acceptance → claim loop → tool loop,
//! mirroring `server/app/agent_service.py` against the local SQLite store.
use super::context::{AssembledContext, ContextPlan};
use super::context_summary;
use super::plugin_runtime;
use super::prompts;
use super::store::{RunRow, Store, StoreError};
use crate::agent_protocol::{Envelope, RunStatus};
use crate::backend::{AgentState, LocalConfig};
use crate::llm::{
    ChatMessage, LlmConfig, LlmError, ModelToolCall, OpenAiClient, ToolCallAccumulator,
};
use chrono::Utc;
use chrono_tz::Tz;
use futures_util::StreamExt;
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

/// Same bound as the server's PET_AGENT_MAX_AGENT_STEPS default.
const MAX_AGENT_STEPS: usize = 8;

/// Applies durable store envelopes through the same Snapshot projection the
/// server mode uses; on any gap the whole snapshot is re-read from the store.
/// Returns false when a newer generation owns the view.
fn apply_envelopes(
    app: &AppHandle,
    generation: u64,
    store: &Store,
    envelopes: &[Envelope],
) -> bool {
    if envelopes.is_empty() {
        let state = app.state::<AgentState>();
        let inner = state.lock();
        return inner.view.generation == generation;
    }
    let state = app.state::<AgentState>();
    let mut inner = state.lock();
    if inner.view.generation != generation {
        return false;
    }
    let mut broken = false;
    for envelope in envelopes {
        if let Err(_gap) = inner.view.snapshot.apply(envelope) {
            broken = true;
            break;
        }
    }
    if broken {
        let session_id = inner.view.snapshot.session_id.clone();
        if let Ok(snapshot) = store.snapshot(&session_id) {
            inner.view.snapshot = snapshot;
        }
    }
    inner.view.revision += 1;
    let _ = app.emit("agent:view", &inner.view);
    true
}

pub async fn submit(app: &AppHandle, request_id: String, text: String) -> Result<(), String> {
    let (generation, store, session_id, config) = {
        let state = app.state::<AgentState>();
        let inner = state.lock();
        if inner.view.connection != "connected" || !inner.view.model_configured {
            return Err("单机模式模型尚未配置，请先在设置中完成配置".into());
        }
        let store = inner
            .store
            .clone()
            .ok_or("本地存储不可用，请重新保存单机模式配置")?;
        let config = inner
            .config
            .as_ref()
            .ok_or("请先完成单机模式配置")?
            .local
            .effective();
        crate::backend::normalized_url(&config.base_url, "模型服务地址")?;
        (
            inner.view.generation,
            store,
            inner.view.snapshot.session_id.clone(),
            config,
        )
    };
    let (accepted, duplicate) = store
        .submit(&session_id, &request_id, &text)
        .map_err(|error| error.message())?;
    // A repeated request resolves once the original acceptance is durable.
    if duplicate || !apply_envelopes(app, generation, &store, &[accepted]) {
        return Ok(());
    }
    let state = app.state::<AgentState>();
    let mut inner = state.lock();
    if inner.view.generation != generation {
        return Ok(());
    }
    context_summary::cancel(&mut inner);
    // One worker drains the durable queue. Never replace its abort handle with
    // a second worker that exits immediately because the session is running.
    if inner.run_task.is_some() {
        return Ok(());
    }
    let worker_id = uuid::Uuid::new_v4().to_string();
    let handle = app.clone();
    let worker_store = store.clone();
    let worker_label = worker_id.clone();
    let worker = tauri::async_runtime::spawn(async move {
        worker_loop(
            &handle,
            generation,
            &worker_store,
            &session_id,
            &config,
            &worker_label,
        )
        .await;
    });
    inner.run_task = Some((worker_id, worker));
    Ok(())
}

/// Claims queued runs one at a time; extra workers exit on the empty/running
/// check, keeping one running run per session without a lease.
async fn worker_loop(
    app: &AppHandle,
    generation: u64,
    store: &Arc<Store>,
    session_id: &str,
    config: &LocalConfig,
    worker_id: &str,
) {
    let mut last_run = None;
    loop {
        let claimed = {
            let state = app.state::<AgentState>();
            let mut inner = state.lock();
            if inner.view.generation != generation
                || !matches!(&inner.run_task, Some((id, _)) if id == worker_id)
            {
                break;
            }
            match store.claim(session_id) {
                Ok(Some(claimed)) => Some(claimed),
                _ => {
                    inner.run_task = None;
                    None
                }
            }
        };
        let Some(claimed) = claimed else {
            break;
        };
        if !apply_envelopes(app, generation, store, &[claimed.envelope]) {
            break;
        }
        if !execute_run(app, generation, store, &claimed.run, config).await {
            break;
        }
        last_run = Some(claimed.run.id);
    }
    let state = app.state::<AgentState>();
    let mut inner = state.lock();
    // A newer worker may already own the slot; only clear our own handle.
    if inner.view.generation == generation
        && matches!(&inner.run_task, Some((id, _)) if *id == worker_id)
    {
        inner.run_task = None;
    }
    drop(inner);
    if let Some(run_id) = last_run {
        context_summary::schedule(app, generation, store.clone(), &run_id, config.clone());
    }
}

enum LoopOutcome {
    Completed,
    /// Ownership or view moved on; recovery owns the terminal state.
    Lost,
    Failed(String),
}

/// Fixed failure classes with the server's "committed tool results survive"
/// suffix (agent_service.execution_error).
fn failure_message(error: &LlmError) -> String {
    format!("{}，已保存的工具结果保留", error.message())
}

fn step_limit_message() -> String {
    "已达到工具推理步数上限，已保存的工具结果保留".into()
}

fn timeout_message() -> String {
    "任务执行超时，已保存的工具结果保留".into()
}

fn build_context(store: &Store, run: &RunRow, timezone: &Tz) -> Result<ContextPlan, StoreError> {
    let snapshot = store.context_snapshot(&run.id)?;
    let received = chrono::DateTime::parse_from_rfc3339(&run.created_at)
        .map(|parsed| parsed.with_timezone(&Utc))
        .map_err(|_| StoreError::Internal)?;
    Ok(ContextPlan::new(
        snapshot,
        prompts::system_prompt(timezone, received, Utc::now()),
    ))
}

/// One model step: stream visible text into the durable assistant message and
/// accumulate tool-call deltas into complete calls before executing.
async fn model_step(
    app: &AppHandle,
    generation: u64,
    store: &Store,
    run: &RunRow,
    client: &OpenAiClient,
    context: AssembledContext,
    tools: &[Value],
    step: usize,
) -> Result<(String, Vec<ModelToolCall>), LoopOutcome> {
    let mut metrics = context.metrics;
    let _ = store.record_context_metrics(&run.id, step, &metrics);
    let started = std::time::Instant::now();
    let mut first_chunk = None;
    let mut first_text = None;
    let mut provider_usage = Value::Null;
    let mut stream = Box::pin(
        client
            .chat_stream(&context.messages, Some(tools))
            .await
            .map_err(|error| LoopOutcome::Failed(failure_message(&error)))?,
    );
    let mut text = String::new();
    let mut accumulator = ToolCallAccumulator::default();
    let mut any_chunk = false;
    // The chunk read ceiling lives in the stream itself (sse.rs), so
    // keep-alive bytes reset it; empty chunks never reach append_delta.
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|error| LoopOutcome::Failed(failure_message(&error)))?;
        first_chunk.get_or_insert_with(|| started.elapsed().as_millis() as u64);
        if let Some(usage) = &chunk.usage {
            provider_usage = serde_json::json!({
                "prompt_tokens": usage.prompt_tokens,
                "completion_tokens": usage.completion_tokens,
                "total_tokens": usage.total_tokens,
                "cached_tokens": usage.prompt_tokens_details.as_ref().and_then(|d| d.cached_tokens),
            });
        }
        any_chunk = true;
        accumulator.push(&chunk.tool_calls);
        if chunk.content.is_empty() {
            continue;
        }
        first_text.get_or_insert_with(|| started.elapsed().as_millis() as u64);
        text.push_str(&chunk.content);
        let envelope = store
            .append_delta(&run.id, &chunk.content)
            .map_err(|_| LoopOutcome::Failed(failure_message(&LlmError::Failed)))?;
        if let Some(envelope) = envelope {
            if !apply_envelopes(app, generation, store, &[envelope]) {
                return Err(LoopOutcome::Lost);
            }
        } else {
            // The run is no longer running: recovery owns it.
            return Err(LoopOutcome::Lost);
        }
    }
    if !any_chunk {
        return Err(LoopOutcome::Failed(failure_message(&LlmError::Failed)));
    }
    let calls = accumulator
        .finish()
        .map_err(|_| LoopOutcome::Failed(failure_message(&LlmError::Failed)))?;
    if calls.is_empty() && text.is_empty() {
        return Err(LoopOutcome::Failed(failure_message(&LlmError::Failed)));
    }
    metrics["first_chunk_ms"] = serde_json::json!(first_chunk);
    metrics["first_text_ms"] = serde_json::json!(first_text);
    metrics["duration_ms"] = serde_json::json!(started.elapsed().as_millis() as u64);
    metrics["provider_usage"] = provider_usage;
    metrics["completed"] = Value::Bool(true);
    let _ = store.record_context_metrics(&run.id, step, &metrics);
    Ok((text, calls))
}

async fn tool_loop(
    app: &AppHandle,
    generation: u64,
    store: &Store,
    run: &RunRow,
    config: &LocalConfig,
) -> LoopOutcome {
    let timezone: Tz = config.timezone.parse().unwrap_or(chrono_tz::Asia::Shanghai);
    let plan = match build_context(store, run, &timezone) {
        Ok(plan) => plan,
        Err(_) => return LoopOutcome::Failed(failure_message(&LlmError::Failed)),
    };
    let mut current = vec![ChatMessage::text("user", run.input_text.clone())];
    let client = match OpenAiClient::new(LlmConfig {
        base_url: config.base_url.clone(),
        api_key: config.api_key.clone(),
        model: config.model.clone(),
        timeout_secs: config.timeout_secs,
    }) {
        Ok(client) => client,
        Err(error) => return LoopOutcome::Failed(failure_message(&error)),
    };
    let plugins = plugin_runtime::builtin_plugins();
    let tools = plugins.model_tools();
    let mut steps = 0;
    loop {
        if steps >= MAX_AGENT_STEPS {
            return LoopOutcome::Failed(step_limit_message());
        }
        steps += 1;
        if !apply_envelopes(app, generation, store, &[]) {
            return LoopOutcome::Lost;
        }
        let assembled = plan.assemble(&current, tools);
        let (text, calls) = match model_step(
            app, generation, store, run, &client, assembled, tools, steps,
        )
        .await
        {
            Ok(step) => step,
            Err(outcome) => return outcome,
        };
        if calls.is_empty() {
            return LoopOutcome::Completed;
        }
        if calls.len() > MAX_AGENT_STEPS {
            return LoopOutcome::Failed(step_limit_message());
        }
        current.push(ChatMessage::assistant(text, &calls));
        for call in &calls {
            let executed = match plugins.execute(store, &run.id, call) {
                Ok(Some(executed)) => executed,
                // LeaseLost analog: the terminal state belongs to recovery now.
                Ok(None) => return LoopOutcome::Lost,
                Err(_) => return LoopOutcome::Failed(failure_message(&LlmError::Failed)),
            };
            if !apply_envelopes(app, generation, store, &executed.envelopes) {
                return LoopOutcome::Lost;
            }
            // Tool results go back as JSON tool messages (agent_service.tools_node).
            let body = if matches!(
                executed.view.status,
                crate::agent_protocol::ToolStatus::Completed
            ) {
                executed.view.result.clone().unwrap_or(Value::Null)
            } else {
                serde_json::json!({"error": executed.view.error})
            };
            let content = match serde_json::to_string(&body) {
                Ok(content) => content,
                Err(_) => return LoopOutcome::Failed(failure_message(&LlmError::Failed)),
            };
            current.push(ChatMessage::tool(call, content));
        }
    }
}

/// Executes one claimed run to its terminal state. Returns false when the view
/// or run ownership moved on and the worker should stop.
async fn execute_run(
    app: &AppHandle,
    generation: u64,
    store: &Store,
    run: &RunRow,
    config: &LocalConfig,
) -> bool {
    let execution = tool_loop(app, generation, store, run, config);
    let outcome = match tokio::time::timeout(
        std::time::Duration::from_secs(config.timeout_secs.max(1)),
        execution,
    )
    .await
    {
        Err(_) => LoopOutcome::Failed(timeout_message()),
        Ok(outcome) => outcome,
    };
    let (status, error) = match outcome {
        LoopOutcome::Completed => (RunStatus::Completed, None),
        LoopOutcome::Lost => return false,
        LoopOutcome::Failed(message) => (RunStatus::Failed, Some(message)),
    };
    match store.finish_run(&run.id, status, error.as_deref()) {
        Ok(envelopes) => apply_envelopes(app, generation, store, &envelopes),
        Err(_) => false,
    }
}
