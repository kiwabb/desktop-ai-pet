//! SQLite authority for the local runtime, mirroring `server/app/runtime_store.py`.
//!
//! Tables mirror `server/migrations/002_runtime.sql` + 003 + 004 semantics for a
//! single local account. Every visible mutation commits its event in the same
//! transaction; `agent_sessions.seq` is the strictly increasing watermark and
//! `request_id` uniqueness makes submissions idempotent across restarts.
use crate::agent_protocol::{Envelope, Message, Role, Run, RunStatus, Snapshot, ToolCall, ToolStatus};
use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Mutex;

pub const HISTORY_WINDOW: i64 = 40;
pub const UNRESOLVED_TOOL_WINDOW: i64 = 20;

/// (role, content) message pairs plus unresolved tool records, in server shape.
pub type History = (Vec<(String, String)>, Vec<Value>);

/// Fixed, safe failure classes; SQL/driver details never surface.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StoreError {
    /// 400-class: caller input violates a validation rule.
    Validation(String),
    /// 404-class: target record does not exist.
    NotFound(String),
    /// 409-class: reminder optimistic lock or completed target.
    Conflict(String),
    Internal,
}

impl StoreError {
    pub fn message(&self) -> String {
        match self {
            Self::Validation(message) | Self::NotFound(message) | Self::Conflict(message) => {
                message.clone()
            }
            Self::Internal => "本地存储暂时不可用，请重启应用重试".into(),
        }
    }
}

impl From<rusqlite::Error> for StoreError {
    fn from(_: rusqlite::Error) -> Self {
        Self::Internal
    }
}
impl From<serde_json::Error> for StoreError {
    fn from(_: serde_json::Error) -> Self {
        Self::Internal
    }
}

const SCHEMA_V1: &str = "
CREATE TABLE agent_sessions (
    id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE agent_runs (
    ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id),
    request_id TEXT NOT NULL UNIQUE,
    input_text TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','interrupted')),
    error TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX agent_runs_queue ON agent_runs(status, ordinal);
CREATE UNIQUE INDEX agent_one_running_per_session ON agent_runs(session_id) WHERE status = 'running';
CREATE TABLE agent_messages (
    ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id),
    run_id TEXT NOT NULL REFERENCES agent_runs(id),
    role TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(run_id, role)
);
CREATE INDEX agent_messages_session ON agent_messages(session_id, ordinal);
CREATE TABLE agent_tool_calls (
    ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    run_id TEXT NOT NULL REFERENCES agent_runs(id),
    model_call_id TEXT NOT NULL,
    name TEXT NOT NULL,
    arguments TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running','completed','failed','needs_reconciliation')),
    result TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(run_id, model_call_id)
);
CREATE TABLE todos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 2000),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
    source_tool_call_id TEXT UNIQUE REFERENCES agent_tool_calls(id),
    remind_at TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX todos_created ON todos(created_at, id);
CREATE INDEX todos_pending_remind_at ON todos(remind_at, id)
    WHERE status = 'pending' AND remind_at IS NOT NULL;
CREATE TABLE agent_events (
    session_id TEXT NOT NULL REFERENCES agent_sessions(id),
    seq INTEGER NOT NULL,
    run_id TEXT NOT NULL,
    type TEXT NOT NULL,
    envelope TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (session_id, seq)
);
";

/// All persisted instants use one fixed-width UTC format so lexicographic
/// comparison in SQL equals chronological order.
pub fn normalize_instant(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Micros, true)
}

fn now_stamp() -> String {
    normalize_instant(Utc::now())
}

/// Port of `contracts.reminder_time`: null or timezone-aware ISO, nothing else.
pub fn parse_reminder_time(value: &Value) -> Result<Option<DateTime<Utc>>, StoreError> {
    match value {
        Value::Null => Ok(None),
        Value::String(text) => DateTime::parse_from_rfc3339(text)
            .map(|parsed| parsed.with_timezone(&Utc))
            .map(Some)
            .map_err(|_| StoreError::Validation("提醒时间必须为有效的带时区 ISO 时间".into())),
        _ => Err(StoreError::Validation(
            "提醒时间必须为带时区的 ISO 时间或 null".into(),
        )),
    }
}

pub(crate) fn uuid_text(value: &str) -> Result<String, StoreError> {
    uuid::Uuid::parse_str(value)
        .map(|id| id.to_string())
        .map_err(|_| StoreError::Validation("标识必须为有效 UUID".into()))
}

fn run_status_name(status: RunStatus) -> &'static str {
    match status {
        RunStatus::Queued => "queued",
        RunStatus::Running => "running",
        RunStatus::Completed => "completed",
        RunStatus::Failed => "failed",
        RunStatus::Interrupted => "interrupted",
    }
}

fn parse_run_status(value: &str) -> RunStatus {
    match value {
        "running" => RunStatus::Running,
        "completed" => RunStatus::Completed,
        "failed" => RunStatus::Failed,
        "interrupted" => RunStatus::Interrupted,
        _ => RunStatus::Queued,
    }
}

fn parse_tool_status(value: &str) -> ToolStatus {
    match value {
        "completed" => ToolStatus::Completed,
        "failed" => ToolStatus::Failed,
        "needs_reconciliation" => ToolStatus::NeedsReconciliation,
        _ => ToolStatus::Running,
    }
}

/// Durable run row; the runtime needs the input text and acceptance clock.
#[derive(Clone, Debug)]
pub struct RunRow {
    pub id: String,
    pub session_id: String,
    pub request_id: String,
    pub input_text: String,
    pub ordinal: i64,
    pub created_at: String,
    pub status: RunStatus,
    pub error: Option<String>,
}

impl RunRow {
    pub fn view(&self) -> Run {
        Run {
            id: self.id.clone(),
            request_id: self.request_id.clone(),
            status: self.status.clone(),
            error: self.error.clone(),
        }
    }

    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            session_id: row.get("session_id")?,
            request_id: row.get("request_id")?,
            input_text: row.get("input_text")?,
            ordinal: row.get("ordinal")?,
            created_at: row.get("created_at")?,
            status: parse_run_status(&row.get::<_, String>("status")?),
            error: row.get("error")?,
        })
    }
}

fn message_from_row(row: &Row) -> rusqlite::Result<Message> {
    Ok(Message {
        id: row.get("id")?,
        role: if row.get::<_, String>("role")? == "user" {
            Role::User
        } else {
            Role::Assistant
        },
        content: row.get("content")?,
        created_at: row.get("created_at")?,
        run_id: Some(row.get("run_id")?),
    })
}

fn tool_from_row(row: &Row) -> rusqlite::Result<ToolCall> {
    let result: Option<String> = row.get("result")?;
    Ok(ToolCall {
        id: row.get("id")?,
        run_id: row.get("run_id")?,
        name: row.get("name")?,
        status: parse_tool_status(&row.get::<_, String>("status")?),
        result: result.and_then(|text| serde_json::from_str(&text).ok()),
        error: row.get("error")?,
    })
}

fn run_row(conn: &Connection, run_id: &str) -> Result<RunRow, StoreError> {
    conn.query_row(
        "SELECT * FROM agent_runs WHERE id = ?1",
        params![run_id],
        RunRow::from_row,
    )
    .map_err(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => StoreError::Internal,
        other => other.into(),
    })
}

/// Bumps the session watermark and persists the envelope in one statement pair;
/// callers always run inside the transaction of the mutation being announced.
fn event(conn: &Connection, run: &RunRow, kind: &str, payload: Value) -> Result<Envelope, StoreError> {
    let seq: i64 = conn.query_row(
        "UPDATE agent_sessions SET seq = seq + 1 WHERE id = ?1 RETURNING seq",
        params![run.session_id],
        |row| row.get(0),
    )?;
    let envelope = Envelope {
        v: 1,
        kind: kind.into(),
        session_id: Some(run.session_id.clone()),
        request_id: Some(run.request_id.clone()),
        run_id: Some(run.id.clone()),
        seq: Some(seq as u64),
        payload,
    };
    conn.execute(
        "INSERT INTO agent_events(session_id, seq, run_id, type, envelope, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            run.session_id,
            seq,
            run.id,
            kind,
            serde_json::to_string(&envelope)?,
            now_stamp()
        ],
    )?;
    Ok(envelope)
}

fn tool_view_by_id(conn: &Connection, tool_id: &str) -> Result<ToolCall, StoreError> {
    Ok(conn.query_row(
        "SELECT * FROM agent_tool_calls WHERE id = ?1",
        params![tool_id],
        tool_from_row,
    )?)
}

/// Called inside the SAME transaction as the business effect (runtime_store.finish_tool).
fn finish_tool_tx(
    conn: &Connection,
    run: &RunRow,
    tool_id: &str,
    result: Option<Value>,
    error: Option<String>,
) -> Result<(ToolCall, Envelope), StoreError> {
    let status = if error.is_some() { "failed" } else { "completed" };
    let changed = conn.execute(
        "UPDATE agent_tool_calls SET status = ?1, result = ?2, error = ?3 \
         WHERE id = ?4 AND run_id = ?5 AND status = 'running'",
        params![
            status,
            result.as_ref().map(serde_json::to_string).transpose()?,
            error,
            tool_id,
            run.id
        ],
    )?;
    if changed != 1 {
        // LeaseLost analog: the outcome is already owned by someone else.
        return Err(StoreError::Internal);
    }
    let view = tool_view_by_id(conn, tool_id)?;
    let envelope = event(conn, run, "tool.finished", json!({"tool_call": view}))?;
    Ok((view, envelope))
}

/// Shared terminal transition (runtime_store._terminal): pending tool calls
/// become needs_reconciliation before the run's own terminal event.
fn terminal_tx(
    conn: &Connection,
    run: &RunRow,
    status: RunStatus,
    error: Option<&str>,
) -> Result<Vec<Envelope>, StoreError> {
    let mut envelopes = Vec::new();
    let mut statement = conn.prepare(
        "UPDATE agent_tool_calls SET status = 'needs_reconciliation', error = ?1 \
         WHERE run_id = ?2 AND status = 'running' RETURNING *",
    )?;
    let calls = statement
        .query_map(params!["执行中断，结果需要核实，未自动重试", run.id], tool_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    for call in calls {
        envelopes.push(event(conn, run, "tool.finished", json!({"tool_call": call}))?);
    }
    let mut finished = run.clone();
    finished.status = status.clone();
    finished.error = error.map(str::to_owned);
    conn.execute(
        "UPDATE agent_runs SET status = ?1, error = ?2 WHERE id = ?3",
        params![run_status_name(status.clone()), error, run.id],
    )?;
    let kind = format!("run.{}", run_status_name(status));
    envelopes.push(event(conn, &finished, &kind, json!({"run": finished.view()}))?);
    Ok(envelopes)
}

#[derive(Debug)]
pub enum StartedTool {
    /// Freshly persisted running call; the executor must run the business logic.
    Fresh(ToolCall, Envelope),
    /// Repeated call with a committed outcome; never re-execute its effect.
    Existing(ToolCall),
}

pub struct ClaimedRun {
    pub run: RunRow,
    pub envelope: Envelope,
}

pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
    /// Recover a poisoned guard instead of cascading one panic into every
    /// later store call; SQLite transactions roll back on drop, so the
    /// connection never exposes a half-committed mutation.
    fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn open(path: &Path) -> Result<Self, StoreError> {
        let conn = Connection::open(path)?;
        Self::initialize(conn)
    }

    #[cfg(test)]
    pub fn open_memory() -> Self {
        Self::initialize(Connection::open_in_memory().unwrap()).unwrap()
    }

    fn initialize(conn: Connection) -> Result<Self, StoreError> {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;",
        )?;
        let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if version < 1 {
            conn.execute_batch(SCHEMA_V1)?;
            conn.execute_batch("PRAGMA user_version = 1;")?;
        }
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn latest_session(&self) -> Result<Option<String>, StoreError> {
        let conn = self.conn();
        Ok(conn
            .query_row(
                "SELECT id FROM agent_sessions ORDER BY created_at DESC, rowid DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn create_session(&self) -> Result<String, StoreError> {
        let id = uuid::Uuid::new_v4().to_string();
        let conn = self.conn();
        conn.execute(
            "INSERT INTO agent_sessions(id, created_at) VALUES (?1, ?2)",
            params![id, now_stamp()],
        )?;
        Ok(id)
    }

    pub fn snapshot(&self, session_id: &str) -> Result<Snapshot, StoreError> {
        let conn = self.conn();
        let seq: i64 = conn
            .query_row(
                "SELECT seq FROM agent_sessions WHERE id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| StoreError::NotFound("会话不存在".into()))?;
        let mut statement =
            conn.prepare("SELECT * FROM agent_messages WHERE session_id = ?1 ORDER BY ordinal")?;
        let messages = statement
            .query_map(params![session_id], message_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        let mut statement =
            conn.prepare("SELECT * FROM agent_runs WHERE session_id = ?1 ORDER BY ordinal")?;
        let runs = statement
            .query_map(params![session_id], RunRow::from_row)?
            .collect::<Result<Vec<_>, _>>()?
            .iter()
            .map(RunRow::view)
            .collect::<Vec<_>>();
        drop(statement);
        let mut statement = conn.prepare(
            "SELECT t.* FROM agent_tool_calls t JOIN agent_runs r ON r.id = t.run_id \
             WHERE r.session_id = ?1 ORDER BY t.ordinal",
        )?;
        let tool_calls = statement
            .query_map(params![session_id], tool_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Snapshot {
            session_id: session_id.into(),
            seq: seq as u64,
            messages,
            runs,
            tool_calls,
        })
    }

    /// Durable acceptance (runtime_store.submit). `Ok((envelope, true))` is a
    /// repeated request returning its original acceptance without a new run.
    pub fn submit(
        &self,
        session_id: &str,
        request_id: &str,
        text: &str,
    ) -> Result<(Envelope, bool), StoreError> {
        let session_id = uuid_text(session_id)?;
        let request_id = uuid_text(request_id)?;
        if text.trim().is_empty() || text.chars().count() > 16000 {
            return Err(StoreError::Validation("消息需为 1 到 16000 个字符".into()));
        }
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        tx.query_row(
            "SELECT id FROM agent_sessions WHERE id = ?1",
            params![session_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| StoreError::NotFound("会话不存在".into()))?;
        let existing = tx
            .query_row(
                "SELECT * FROM agent_runs WHERE request_id = ?1",
                params![request_id],
                RunRow::from_row,
            )
            .optional()?;
        if let Some(existing) = existing {
            if existing.session_id != session_id || existing.input_text != text {
                return Err(StoreError::Validation(
                    "该请求标识已用于不同的消息，请使用新的请求标识".into(),
                ));
            }
            let envelope: String = tx.query_row(
                "SELECT envelope FROM agent_events WHERE run_id = ?1 AND type = 'run.accepted'",
                params![existing.id],
                |row| row.get(0),
            )?;
            return Ok((serde_json::from_str(&envelope)?, true));
        }
        let mut run = RunRow {
            id: uuid::Uuid::new_v4().to_string(),
            session_id: session_id.clone(),
            request_id,
            input_text: text.to_owned(),
            ordinal: 0,
            created_at: now_stamp(),
            status: RunStatus::Queued,
            error: None,
        };
        run.ordinal = tx.query_row(
            "INSERT INTO agent_runs(id, session_id, request_id, input_text, status, created_at) \
             VALUES (?1, ?2, ?3, ?4, 'queued', ?5) RETURNING ordinal",
            params![run.id, run.session_id, run.request_id, run.input_text, run.created_at],
            |row| row.get(0),
        )?;
        let mut messages = Vec::with_capacity(2);
        for (role, content) in [(Role::User, text.to_owned()), (Role::Assistant, String::new())] {
            let message = Message {
                id: uuid::Uuid::new_v4().to_string(),
                role,
                content,
                created_at: run.created_at.clone(),
                run_id: Some(run.id.clone()),
            };
            tx.execute(
                "INSERT INTO agent_messages(id, session_id, run_id, role, content, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    message.id,
                    session_id,
                    run.id,
                    match message.role {
                        Role::User => "user",
                        Role::Assistant => "assistant",
                    },
                    message.content,
                    message.created_at
                ],
            )?;
            messages.push(message);
        }
        let envelope = event(
            &tx,
            &run,
            "run.accepted",
            json!({
                "run": run.view(),
                "user_message": messages[0],
                "assistant_message": messages[1],
            }),
        )?;
        tx.commit()?;
        Ok((envelope, false))
    }

    /// Claims the earliest queued run of the session only when nothing is
    /// running (runtime_store.claim minus leases; the process mutex and the
    /// partial unique index keep at most one running run per session).
    pub fn claim(&self, session_id: &str) -> Result<Option<ClaimedRun>, StoreError> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        let run = tx
            .query_row(
                "SELECT * FROM agent_runs WHERE session_id = ?1 AND status = 'queued' \
                 AND NOT EXISTS (SELECT 1 FROM agent_runs WHERE session_id = ?1 AND status = 'running') \
                 ORDER BY ordinal LIMIT 1",
                params![session_id],
                RunRow::from_row,
            )
            .optional()?;
        let Some(mut run) = run else {
            return Ok(None);
        };
        tx.execute(
            "UPDATE agent_runs SET status = 'running' WHERE id = ?1",
            params![run.id],
        )?;
        run.status = RunStatus::Running;
        let envelope = event(&tx, &run, "run.started", json!({"run": run.view()}))?;
        tx.commit()?;
        Ok(Some(ClaimedRun { run, envelope }))
    }

    /// Appends visible text to the run's assistant message (runtime_store.append_delta).
    /// `Ok(None)` means the run is no longer running: recovery owns it now.
    pub fn append_delta(&self, run_id: &str, text: &str) -> Result<Option<Envelope>, StoreError> {
        if text.is_empty() {
            return Ok(None);
        }
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        let run = run_row(&tx, run_id)?;
        if !matches!(run.status, RunStatus::Running) {
            return Ok(None);
        }
        let message_id: String = tx.query_row(
            "UPDATE agent_messages SET content = content || ?1 \
             WHERE run_id = ?2 AND role = 'assistant' RETURNING id",
            params![text, run_id],
            |row| row.get(0),
        )?;
        let envelope = event(
            &tx,
            &run,
            "message.delta",
            json!({"message_id": message_id, "text": text}),
        )?;
        tx.commit()?;
        Ok(Some(envelope))
    }

    /// Idempotent tool-start (runtime_store.start_tool); the uuid5 key keeps a
    /// repeated graph/tool call from repeating a write. `Ok(None)` = lease lost.
    pub fn start_tool(
        &self,
        run_id: &str,
        call_id: &str,
        business_name: &str,
        arguments: &Value,
    ) -> Result<Option<StartedTool>, StoreError> {
        if call_id.is_empty() || call_id.len() > 256 {
            return Err(StoreError::Validation("模型工具调用标识无效".into()));
        }
        let tool_id = uuid::Uuid::new_v5(
            &uuid::Uuid::parse_str(run_id).map_err(|_| StoreError::Internal)?,
            call_id.as_bytes(),
        )
        .to_string();
        let arguments = serde_json::to_string(arguments)?;
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        let run = run_row(&tx, run_id)?;
        if !matches!(run.status, RunStatus::Running) {
            return Ok(None);
        }
        let existing = tx
            .query_row(
                "SELECT * FROM agent_tool_calls WHERE id = ?1",
                params![tool_id],
                tool_from_row,
            )
            .optional()?;
        if let Some(existing) = existing {
            let stored_arguments = serde_json::to_string(&existing_json(&tx, &tool_id)?)?;
            if existing.name != business_name || stored_arguments != arguments {
                return Err(StoreError::Validation(
                    "工具调用标识对应的参数发生冲突".into(),
                ));
            }
            return match existing.status {
                ToolStatus::Completed | ToolStatus::Failed => {
                    Ok(Some(StartedTool::Existing(existing)))
                }
                _ => Err(StoreError::Internal),
            };
        }
        tx.execute(
            "INSERT INTO agent_tool_calls(id, run_id, model_call_id, name, arguments, status, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6)",
            params![tool_id, run_id, call_id, business_name, arguments, now_stamp()],
        )?;
        let view = tool_view_by_id(&tx, &tool_id)?;
        let envelope = event(&tx, &run, "tool.started", json!({"tool_call": view}))?;
        tx.commit()?;
        Ok(Some(StartedTool::Fresh(view, envelope)))
    }

    /// Runs `effect` and the tool-result finish in one transaction; plugins
    /// compose their business effect through this skeleton (runtime_store's
    /// executing + finish_tool).
    pub(crate) fn tool_outcome(
        &self,
        run_id: &str,
        tool_id: &str,
        effect: impl FnOnce(&Connection) -> Result<Value, StoreError>,
    ) -> Result<(ToolCall, Envelope), StoreError> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        let run = run_row(&tx, run_id)?;
        if !matches!(run.status, RunStatus::Running) {
            return Err(StoreError::Internal);
        }
        let outcome = effect(&tx).and_then(|result| {
            finish_tool_tx(&tx, &run, tool_id, Some(result), None)
        });
        match outcome {
            Ok(done) => {
                tx.commit()?;
                Ok(done)
            }
            Err(error) => Err(error),
        }
    }

    /// Read/transaction-free domain access for plugins (direct operations).
    pub(crate) fn with_conn<R>(
        &self,
        f: impl FnOnce(&Connection) -> Result<R, StoreError>,
    ) -> Result<R, StoreError> {
        let conn = self.conn();
        f(&conn)
    }

    /// Records a business failure as the tool result in its own transaction
    /// (the business transaction has already rolled back).
    pub fn fail_tool(
        &self,
        run_id: &str,
        tool_id: &str,
        error: &str,
    ) -> Result<Option<(ToolCall, Envelope)>, StoreError> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        let run = run_row(&tx, run_id)?;
        if !matches!(run.status, RunStatus::Running) {
            return Ok(None);
        }
        let done = finish_tool_tx(&tx, &run, tool_id, None, Some(error.to_owned()))?;
        tx.commit()?;
        Ok(Some(done))
    }

    /// Terminal transition with pending-tool reconciliation (runtime_store.finish_run).
    /// Already-terminal runs yield no events (recovery owns the terminal state).
    pub fn finish_run(
        &self,
        run_id: &str,
        status: RunStatus,
        error: Option<&str>,
    ) -> Result<Vec<Envelope>, StoreError> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        let run = run_row(&tx, run_id)?;
        if !matches!(run.status, RunStatus::Queued | RunStatus::Running) {
            return Ok(Vec::new());
        }
        let envelopes = terminal_tx(&tx, &run, status, error)?;
        tx.commit()?;
        Ok(envelopes)
    }

    /// Restart/generation recovery (runtime_store.recover_expired): locally no
    /// worker survives, so queued and running runs become interrupted.
    pub fn recover_interrupted(&self) -> Result<(), StoreError> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        let mut statement =
            tx.prepare("SELECT * FROM agent_runs WHERE status IN ('queued', 'running') ORDER BY ordinal")?;
        let runs = statement
            .query_map([], RunRow::from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        for run in runs {
            terminal_tx(
                &tx,
                &run,
                RunStatus::Interrupted,
                Some("执行进程已中断，已保存的工具结果保留，未自动重试"),
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Same window as runtime_store.history: recent nonempty messages of earlier
    /// runs plus tool records of failed/interrupted runs (descending, like the server).
    pub fn history(&self, run_id: &str) -> Result<History, StoreError> {
        let conn = self.conn();
        let run = run_row(&conn, run_id)?;
        let mut statement = conn.prepare(
            "SELECT m.role, m.content FROM agent_messages m JOIN agent_runs r ON r.id = m.run_id \
             WHERE m.session_id = ?1 AND r.ordinal < ?2 AND m.content <> '' \
             ORDER BY m.ordinal DESC LIMIT ?3",
        )?;
        let mut messages = statement
            .query_map(
                params![run.session_id, run.ordinal, HISTORY_WINDOW],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        messages.reverse();
        // Failed model replies must not hide already committed effects.
        let mut statement = conn.prepare(
            "SELECT t.name, t.status, t.result FROM agent_tool_calls t JOIN agent_runs r ON r.id = t.run_id \
             WHERE r.session_id = ?1 AND r.ordinal < ?2 AND r.status IN ('failed', 'interrupted') \
             ORDER BY t.ordinal DESC LIMIT ?3",
        )?;
        let unresolved = statement
            .query_map(
                params![run.session_id, run.ordinal, UNRESOLVED_TOOL_WINDOW],
                |row| {
                    let result: Option<String> = row.get(2)?;
                    Ok(json!({
                        "name": row.get::<_, String>(0)?,
                        "status": row.get::<_, String>(1)?,
                        "result": result.and_then(|text| serde_json::from_str::<Value>(&text).ok()),
                    }))
                },
            )?
            .collect::<Result<Vec<_>, _>>()?;
        Ok((messages, unresolved))
    }
}

fn existing_json(conn: &Connection, tool_id: &str) -> Result<Value, StoreError> {
    let arguments: String = conn.query_row(
        "SELECT arguments FROM agent_tool_calls WHERE id = ?1",
        params![tool_id],
        |row| row.get(0),
    )?;
    Ok(serde_json::from_str(&arguments)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::TodoStatus;
    use crate::local_agent::plugins::todo::TodoStore;
    use chrono::Duration;

    /// Domain operations moved to the todo plugin; tests exercise them through
    /// the same plugin store handle used by command mounting.
    fn todos(store: &Store) -> TodoStore<'_> {
        TodoStore::new(store)
    }

    fn session(store: &Store) -> String {
        store.create_session().unwrap()
    }

    fn accepted_run(store: &Store, session: &str, request: &str, text: &str) -> (RunRow, Envelope) {
        let (envelope, duplicate) = store.submit(session, request, text).unwrap();
        assert!(!duplicate);
        let run_id = envelope.run_id.clone().unwrap();
        let claimed = store.claim(session).unwrap().unwrap();
        assert_eq!(claimed.run.id, run_id);
        (claimed.run, envelope)
    }

    fn future(hours: i64) -> DateTime<Utc> {
        Utc::now() + Duration::hours(hours)
    }

    #[test]
    fn submit_is_idempotent_by_request_id() {
        let store = Store::open_memory();
        let session = session(&store);
        let request = uuid::Uuid::new_v4().to_string();
        let (first, duplicate) = store.submit(&session, &request, "你好").unwrap();
        assert!(!duplicate);
        assert_eq!(first.seq, Some(1));
        let (again, duplicate) = store.submit(&session, &request, "你好").unwrap();
        assert!(duplicate);
        assert_eq!(again, first);
        let conflict = store.submit(&session, &request, "不同的消息").unwrap_err();
        assert_eq!(
            conflict,
            StoreError::Validation("该请求标识已用于不同的消息，请使用新的请求标识".into())
        );
        let snapshot = store.snapshot(&session).unwrap();
        assert_eq!(snapshot.runs.len(), 1);
        assert_eq!(snapshot.messages.len(), 2);
        assert_eq!(snapshot.seq, 1);
    }

    #[test]
    fn event_sequence_is_strictly_increasing_and_matches_snapshot() {
        let store = Store::open_memory();
        let session = session(&store);
        let request = uuid::Uuid::new_v4().to_string();
        let (accepted, duplicate) = store.submit(&session, &request, "记一下喝水").unwrap();
        assert!(!duplicate);
        let claimed = store.claim(&session).unwrap().unwrap();
        let run = claimed.run;
        let seqs = |events: &[Envelope]| events.iter().map(|e| e.seq.unwrap()).collect::<Vec<_>>();
        assert_eq!(accepted.seq, Some(1));
        let delta = store.append_delta(&run.id, "好的").unwrap().unwrap();
        assert_eq!(delta.seq, Some(3)); // 1=run.accepted, 2=run.started
        let finished = store.finish_run(&run.id, RunStatus::Completed, None).unwrap();
        assert_eq!(seqs(&finished), vec![4]);
        let snapshot = store.snapshot(&session).unwrap();
        assert_eq!(snapshot.seq, 4);
        assert_eq!(snapshot.runs[0].status, RunStatus::Completed);
        let assistant = snapshot.messages.iter().find(|m| m.role == Role::Assistant).unwrap();
        assert_eq!(assistant.content, "好的");
        // Applying the same envelopes to a fresh projection lands on the snapshot.
        let mut projection = Snapshot {
            session_id: session.clone(),
            ..Default::default()
        };
        for envelope in [accepted, claimed.envelope, delta].into_iter().chain(finished) {
            assert!(projection.apply(&envelope).unwrap());
        }
        assert_eq!(projection.seq, snapshot.seq);
        assert_eq!(projection.messages.len(), snapshot.messages.len());
        assert_eq!(projection.runs[0].status, RunStatus::Completed);
    }

    #[test]
    fn recovery_interrupts_queued_and_running_runs_and_flags_pending_tools() {
        let store = Store::open_memory();
        let session = session(&store);
        let (run, _) = accepted_run(&store, &session, &uuid::Uuid::new_v4().to_string(), "提醒我");
        let start = store
            .start_tool(&run.id, "call_1", "todo.create", &json!({"title": "喝水"}))
            .unwrap()
            .unwrap();
        let StartedTool::Fresh(tool, started) = start else { panic!("fresh tool expected") };
        assert_eq!(tool.status, ToolStatus::Running);
        assert_eq!(started.kind, "tool.started");
        // A second run stays queued behind the running one.
        store
            .submit(&session, &uuid::Uuid::new_v4().to_string(), "还有一件事")
            .unwrap();
        assert!(store.claim(&session).unwrap().is_none());
        store.recover_interrupted().unwrap();
        let snapshot = store.snapshot(&session).unwrap();
        assert!(snapshot
            .runs
            .iter()
            .all(|run| run.status == RunStatus::Interrupted));
        assert_eq!(snapshot.tool_calls[0].status, ToolStatus::NeedsReconciliation);
        assert_eq!(
            snapshot.tool_calls[0].error.as_deref(),
            Some("执行中断，结果需要核实，未自动重试")
        );
        // Terminal events are durable: accepted, started, tool.started,
        // tool.finished, run.interrupted, accepted2, run.interrupted2.
        assert_eq!(snapshot.seq, 7);
        // After recovery nothing is claimable and new submissions work again.
        assert!(store.claim(&session).unwrap().is_none());
        let (next, duplicate) = store
            .submit(&session, &uuid::Uuid::new_v4().to_string(), "重新开始")
            .unwrap();
        assert!(!duplicate);
        assert_eq!(next.seq, Some(8));
    }

    #[test]
    fn repeated_tool_call_returns_committed_outcome_without_rewriting() {
        let store = Store::open_memory();
        let session = session(&store);
        let (run, _) = accepted_run(&store, &session, &uuid::Uuid::new_v4().to_string(), "提醒我喝水");
        let arguments = json!({"title": "喝水"});
        let StartedTool::Fresh(tool, _) = store
            .start_tool(&run.id, "call_1", "todo.create", &arguments)
            .unwrap()
            .unwrap()
        else {
            panic!("fresh tool expected")
        };
        let (done, _) = todos(&store)
            .tool_create_todo(&run.id, &tool.id, "喝水", None)
            .unwrap();
        assert_eq!(done.status, ToolStatus::Completed);
        let Some(StartedTool::Existing(repeated)) = store
            .start_tool(&run.id, "call_1", "todo.create", &arguments)
            .unwrap()
        else {
            panic!("existing tool expected")
        };
        assert_eq!(repeated.status, ToolStatus::Completed);
        assert_eq!(todos(&store).list_todos().unwrap().len(), 1);
        let conflict = store
            .start_tool(&run.id, "call_1", "todo.create", &json!({"title": "别的"}))
            .unwrap_err();
        assert_eq!(
            conflict,
            StoreError::Validation("工具调用标识对应的参数发生冲突".into())
        );
    }

    #[test]
    fn reminder_rules_mirror_server_business_contract() {
        let store = Store::open_memory();
        let session = session(&store);
        let (run, _) = accepted_run(&store, &session, &uuid::Uuid::new_v4().to_string(), "创建");
        let StartedTool::Fresh(tool, _) = store
            .start_tool(&run.id, "call_1", "todo.create", &json!({"title": "喝水"}))
            .unwrap()
            .unwrap()
        else {
            panic!("fresh tool expected")
        };
        let target = future(3);
        let (done, _) = todos(&store)
            .tool_create_todo(&run.id, &tool.id, "喝水", Some(target))
            .unwrap();
        let item = &done.result.as_ref().unwrap()["item"];
        let todo_id = item["id"].as_str().unwrap().to_owned();
        assert!(item["remind_at"].is_string());

        // Idempotent retry with the same target succeeds even with a stale expected.
        let same = todos(&store).set_todo_reminder(&todo_id, Some(target), None).unwrap();
        assert!(same.remind_at.is_some());
        // Stale CAS is a conflict; completed todos reject reminders.
        let conflict = todos(&store)
            .set_todo_reminder(&todo_id, Some(future(4)), None)
            .unwrap_err();
        assert_eq!(conflict, StoreError::Conflict("提醒已被修改，请刷新后重试".into()));
        let current: DateTime<Utc> = DateTime::parse_from_rfc3339(&same.remind_at.clone().unwrap())
            .unwrap()
            .with_timezone(&Utc);
        // Past targets are rejected against the real clock.
        let past = todos(&store)
            .set_todo_reminder(
                &todo_id,
                Some(Utc::now() - Duration::minutes(1)),
                Some(current),
            )
            .unwrap_err();
        assert_eq!(past, StoreError::Validation("提醒时间必须晚于当前时间".into()));
        // Cancel is explicit and clearing again is a no-op retry.
        let cleared = todos(&store).set_todo_reminder(&todo_id, None, Some(current)).unwrap();
        assert!(cleared.remind_at.is_none());
        let cleared_again = todos(&store).set_todo_reminder(&todo_id, None, Some(current)).unwrap();
        assert!(cleared_again.remind_at.is_none());
        // Completion clears the reminder atomically and is idempotent.
        let completed = todos(&store).complete_todo(&todo_id).unwrap();
        assert_eq!(completed.status, TodoStatus::Completed);
        assert!(completed.remind_at.is_none());
        assert_eq!(todos(&store).complete_todo(&todo_id).unwrap().status, TodoStatus::Completed);
        let completed_target = todos(&store)
            .set_todo_reminder(&todo_id, Some(future(5)), None)
            .unwrap_err();
        assert_eq!(
            completed_target,
            StoreError::Conflict("待办已完成，请刷新核对".into())
        );
        // Reopen restores pending without restoring the cleared reminder.
        let reopened = todos(&store).reopen_todo(&todo_id).unwrap();
        assert_eq!(reopened.status, TodoStatus::Pending);
        assert!(reopened.remind_at.is_none());
        assert_eq!(
            todos(&store).complete_todo(&uuid::Uuid::new_v4().to_string()).unwrap_err(),
            StoreError::NotFound("未找到可完成的待办，请重新查询并确认事项".into())
        );
        assert_eq!(
            todos(&store).set_todo_reminder(&uuid::Uuid::new_v4().to_string(), None, None).unwrap_err(),
            StoreError::NotFound("未找到待办，请刷新核对".into())
        );
    }

    #[test]
    fn create_with_past_reminder_leaves_no_orphan_todo() {
        let store = Store::open_memory();
        let session = session(&store);
        let (run, _) = accepted_run(&store, &session, &uuid::Uuid::new_v4().to_string(), "提醒我");
        let StartedTool::Fresh(tool, _) = store
            .start_tool(&run.id, "call_1", "todo.create", &json!({"title": "喝水"}))
            .unwrap()
            .unwrap()
        else {
            panic!("fresh tool expected")
        };
        let error = todos(&store)
            .tool_create_todo(&run.id, &tool.id, "喝水", Some(Utc::now() - Duration::minutes(5)))
            .unwrap_err();
        assert_eq!(error, StoreError::Validation("提醒时间必须晚于当前时间".into()));
        assert!(todos(&store).list_todos().unwrap().is_empty());
        let (failed, _) = store.fail_tool(&run.id, &tool.id, &error.message()).unwrap().unwrap();
        assert_eq!(failed.status, ToolStatus::Failed);
        assert_eq!(failed.error.as_deref(), Some("提醒时间必须晚于当前时间"));
    }

    #[test]
    fn due_reminders_only_list_pending_rows_at_or_before_now() {
        let store = Store::open_memory();
        let session = session(&store);
        let (run, _) = accepted_run(&store, &session, &uuid::Uuid::new_v4().to_string(), "创建");
        for (call, title, offset) in [
            ("call_1", "一小时后", 1),
            ("call_2", "三小时后", 3),
            ("call_3", "半小时后", 0),
        ] {
            let StartedTool::Fresh(tool, _) = store
                .start_tool(&run.id, call, "todo.create", &json!({"title": title}))
                .unwrap()
                .unwrap()
            else {
                panic!("fresh tool expected")
            };
            todos(&store)
                .tool_create_todo(
                    &run.id,
                    &tool.id,
                    title,
                    Some(Utc::now() + Duration::minutes(30 + offset * 60)),
                )
                .unwrap();
        }
        // Two hours later the +0.5h and +1.5h rows are due, ordered by time.
        let later = Utc::now() + Duration::hours(2);
        let due = todos(&store).due_reminders(later).unwrap();
        assert_eq!(due.len(), 2);
        assert_eq!(due[0].title, "半小时后");
        assert_eq!(due[1].title, "一小时后");
        // Completing one removes it from the due list without consuming reads.
        todos(&store).complete_todo(&due[0].id).unwrap();
        let due = todos(&store).due_reminders(later).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].title, "一小时后");
        assert!(todos(&store).due_reminders(Utc::now()).unwrap().is_empty());
    }

    #[test]
    fn history_window_and_unresolved_tool_records_match_server_shape() {
        let store = Store::open_memory();
        let session = session(&store);
        for index in 0..30 {
            let (run, _) = accepted_run(
                &store,
                &session,
                &uuid::Uuid::new_v4().to_string(),
                &format!("问{index}"),
            );
            if index % 3 == 0 {
                store.append_delta(&run.id, &format!("答{index}")).unwrap();
            }
            let status = if index % 5 == 0 {
                RunStatus::Failed
            } else {
                RunStatus::Completed
            };
            store.finish_run(&run.id, status, None).unwrap();
        }
        // A failed run with a committed tool record contributes to the injection.
        let (run, _) = accepted_run(&store, &session, &uuid::Uuid::new_v4().to_string(), "创建待办");
        let StartedTool::Fresh(tool, _) = store
            .start_tool(&run.id, "call_9", "todo.create", &json!({"title": "已保存"}))
            .unwrap()
            .unwrap()
        else {
            panic!("fresh tool expected")
        };
        todos(&store).tool_create_todo(&run.id, &tool.id, "已保存", None).unwrap();
        store
            .finish_run(&run.id, RunStatus::Failed, Some("模型或任务执行失败"))
            .unwrap();
        let (current, _) = accepted_run(&store, &session, &uuid::Uuid::new_v4().to_string(), "现在呢");
        let (messages, unresolved) = store.history(&current.id).unwrap();
        assert_eq!(messages.len(), HISTORY_WINDOW as usize);
        assert!(messages.iter().all(|(_, content)| !content.is_empty()));
        assert!(unresolved.iter().all(|record| record["result"].is_object() || record["result"].is_null()));
        assert!(unresolved.iter().any(|record| record["name"] == "todo.create"
            && record["result"]["item"]["title"] == "已保存"));
    }

    #[test]
    fn direct_todo_writes_validate_and_scope_like_the_server() {
        let store = Store::open_memory();
        // Create validates and strips exactly like the tool/server rule.
        assert_eq!(
            todos(&store).create_todo("   ").unwrap_err(),
            StoreError::Validation("待办标题需为 1 到 2000 个字符".into())
        );
        assert_eq!(
            todos(&store).create_todo(&"长".repeat(2001)).unwrap_err(),
            StoreError::Validation("待办标题需为 1 到 2000 个字符".into())
        );
        let created = todos(&store).create_todo("  买牛奶  ").unwrap();
        assert_eq!(created.title, "买牛奶");
        assert_eq!(created.status, TodoStatus::Pending);
        assert!(created.remind_at.is_none());
        assert_eq!(todos(&store).create_todo(&"长".repeat(2000)).unwrap().title.chars().count(), 2000);
        // Title edits also apply to completed rows; missing/foreign ids share one message.
        let renamed = todos(&store).update_todo_title(&created.id, " 新标题 ").unwrap();
        assert_eq!(renamed.title, "新标题");
        todos(&store).complete_todo(&created.id).unwrap();
        assert_eq!(
            todos(&store).update_todo_title(&created.id, "完成后改名").unwrap().status,
            TodoStatus::Completed
        );
        let missing = uuid::Uuid::new_v4().to_string();
        assert_eq!(
            todos(&store).update_todo_title(&missing, "x").unwrap_err(),
            StoreError::NotFound("待办不存在或已删除".into())
        );
        assert_eq!(
            todos(&store).update_todo_title("../bad", "x").unwrap_err(),
            StoreError::Validation("标识必须为有效 UUID".into())
        );
        // Delete is hard: the row is gone and a repeat reports not-found.
        let deleted = todos(&store).delete_todo(&created.id).unwrap();
        assert_eq!(deleted.id, created.id);
        assert!(todos(&store).list_todos().unwrap().iter().all(|todo| todo.id != created.id));
        for target in [created.id.as_str(), missing.as_str()] {
            assert_eq!(
                todos(&store).delete_todo(target).unwrap_err(),
                StoreError::NotFound("待办不存在或已删除".into())
            );
        }
        assert_eq!(
            todos(&store).delete_todo("../bad").unwrap_err(),
            StoreError::Validation("标识必须为有效 UUID".into())
        );
    }

    #[test]
    fn reminder_time_parsing_requires_timezone_aware_iso() {
        assert!(parse_reminder_time(&Value::Null).unwrap().is_none());
        assert!(parse_reminder_time(&json!("2026-09-09T15:15:00+08:00")).unwrap().is_some());
        assert_eq!(
            parse_reminder_time(&json!("2026-09-09T15:15:00")).unwrap_err(),
            StoreError::Validation("提醒时间必须为有效的带时区 ISO 时间".into())
        );
        assert_eq!(
            parse_reminder_time(&json!(42)).unwrap_err(),
            StoreError::Validation("提醒时间必须为带时区的 ISO 时间或 null".into())
        );
        // Offset times normalize to a single UTC instant.
        let parsed = parse_reminder_time(&json!("2026-09-09T15:15:00+08:00")).unwrap().unwrap();
        assert_eq!(normalize_instant(parsed), "2026-09-09T07:15:00.000000Z");
    }
}
