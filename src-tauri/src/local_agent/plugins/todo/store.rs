//! Todo domain storage for local mode (mirrors `server/app/plugins/todo/store.py`).
//!
//! The domain-agnostic skeleton (start_tool / tool_outcome / fail_tool) stays
//! in `local_agent::store`; everything that knows the todos table lives in the
//! plugin. Direct Tauri commands mount these operations from the core.
use crate::local_agent::store::{normalize_instant, uuid_text, Store, StoreError};
use crate::agent_protocol::{Envelope, ToolCall};
use crate::backend::{Todo, TodoStatus};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::json;

fn todo_from_row(row: &Row) -> rusqlite::Result<Todo> {
    Ok(Todo {
        id: row.get("id")?,
        title: row.get("title")?,
        status: if row.get::<_, String>("status")? == "completed" {
            TodoStatus::Completed
        } else {
            TodoStatus::Pending
        },
        created_at: row.get("created_at")?,
        remind_at: row.get("remind_at")?,
    })
}

/// Same rule and message as the server's `validated_title` / todo.create tool.
fn validated_title(title: &str) -> Result<String, StoreError> {
    if title.trim().is_empty() || title.chars().count() > 2000 {
        return Err(StoreError::Validation("待办标题需为 1 到 2000 个字符".into()));
    }
    Ok(title.trim().to_owned())
}

fn create_todo_tx(conn: &Connection, title: &str, source_tool_call_id: Option<&str>) -> Result<Todo, StoreError> {
    Ok(conn.query_row(
        "INSERT INTO todos(id, title, source_tool_call_id, created_at) VALUES (?1, ?2, ?3, ?4) RETURNING *",
        params![uuid::Uuid::new_v4().to_string(), title, source_tool_call_id, normalize_instant(Utc::now())],
        todo_from_row,
    )?)
}

/// Shared setter/CAS (plugins/todo/store.py set_todo_reminder_in_transaction).
fn set_reminder_tx(
    conn: &Connection,
    todo_id: &str,
    target: Option<DateTime<Utc>>,
    expected: Option<DateTime<Utc>>,
) -> Result<Todo, StoreError> {
    let todo = conn
        .query_row("SELECT * FROM todos WHERE id = ?1", params![todo_id], todo_from_row)
        .optional()?
        .ok_or_else(|| StoreError::NotFound("未找到待办，请刷新核对".into()))?;
    if todo.status != TodoStatus::Pending {
        return Err(StoreError::Conflict("待办已完成，请刷新核对".into()));
    }
    let target = target.map(normalize_instant);
    // A lost-response retry may arrive after its target time has passed.
    if todo.remind_at == target {
        return Ok(todo);
    }
    if todo.remind_at != expected.map(normalize_instant) {
        return Err(StoreError::Conflict("提醒已被修改，请刷新后重试".into()));
    }
    if let Some(target) = &target {
        // The real clock is authoritative, matching the server's database clock.
        if target.as_str() <= normalize_instant(Utc::now()).as_str() {
            return Err(StoreError::Validation("提醒时间必须晚于当前时间".into()));
        }
    }
    Ok(conn.query_row(
        "UPDATE todos SET remind_at = ?1 WHERE id = ?2 RETURNING *",
        params![target, todo_id],
        todo_from_row,
    )?)
}

fn complete_todo_tx(conn: &Connection, todo_id: &str) -> Result<Todo, StoreError> {
    conn.query_row(
        "UPDATE todos SET status = 'completed', remind_at = NULL WHERE id = ?1 RETURNING *",
        params![todo_id],
        todo_from_row,
    )
    .optional()?
    .ok_or_else(|| StoreError::NotFound("未找到可完成的待办，请重新查询并确认事项".into()))
}

fn todos_tx(conn: &Connection) -> Result<Vec<Todo>, StoreError> {
    let mut statement = conn.prepare("SELECT * FROM todos ORDER BY created_at, id")?;
    let todos = statement
        .query_map([], todo_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(todos)
}

/// Todo domain operations against the core store; direct commands and the
/// plugin's tool effects both go through this handle.
pub struct TodoStore<'a> {
    store: &'a Store,
}

impl<'a> TodoStore<'a> {
    pub fn new(store: &'a Store) -> Self {
        Self { store }
    }

    /// todo.create: the todo, its optional reminder and the tool result commit
    /// atomically; a failed schedule leaves no orphan todo.
    pub fn tool_create_todo(
        &self,
        run_id: &str,
        tool_id: &str,
        title: &str,
        remind_at: Option<DateTime<Utc>>,
    ) -> Result<(ToolCall, Envelope), StoreError> {
        self.store.tool_outcome(run_id, tool_id, |tx| {
            let todo = create_todo_tx(tx, title, Some(tool_id))?;
            let item = match remind_at {
                Some(target) => set_reminder_tx(tx, &todo.id, Some(target), None)?,
                None => todo,
            };
            Ok(json!({"item": item}))
        })
    }

    pub fn tool_set_reminder(
        &self,
        run_id: &str,
        tool_id: &str,
        todo_id: &str,
        target: Option<DateTime<Utc>>,
        expected: Option<DateTime<Utc>>,
    ) -> Result<(ToolCall, Envelope), StoreError> {
        self.store.tool_outcome(run_id, tool_id, |tx| {
            Ok(json!({"item": set_reminder_tx(tx, todo_id, target, expected)?}))
        })
    }

    pub fn tool_complete_todo(
        &self,
        run_id: &str,
        tool_id: &str,
        todo_id: &str,
    ) -> Result<(ToolCall, Envelope), StoreError> {
        self.store.tool_outcome(run_id, tool_id, |tx| {
            Ok(json!({"item": complete_todo_tx(tx, todo_id)?}))
        })
    }

    pub fn tool_list_todos(
        &self,
        run_id: &str,
        tool_id: &str,
    ) -> Result<(ToolCall, Envelope), StoreError> {
        self.store.tool_outcome(run_id, tool_id, |tx| Ok(json!({"items": todos_tx(tx)?})))
    }

    pub fn list_todos(&self) -> Result<Vec<Todo>, StoreError> {
        self.store.with_conn(todos_tx)
    }

    /// Pending rows due at or before `now`; reading never consumes (due GET analog).
    pub fn due_reminders(&self, now: DateTime<Utc>) -> Result<Vec<Todo>, StoreError> {
        self.store.with_conn(|conn| {
            let mut statement = conn.prepare(
                "SELECT * FROM todos WHERE status = 'pending' AND remind_at IS NOT NULL \
                 AND remind_at <= ?1 ORDER BY remind_at, id",
            )?;
            let todos = statement
                .query_map(params![normalize_instant(now)], todo_from_row)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(todos)
        })
    }

    pub fn set_todo_reminder(
        &self,
        todo_id: &str,
        target: Option<DateTime<Utc>>,
        expected: Option<DateTime<Utc>>,
    ) -> Result<Todo, StoreError> {
        let todo_id = uuid_text(todo_id)?;
        self.store.with_conn(|conn| set_reminder_tx(conn, &todo_id, target, expected))
    }

    pub fn complete_todo(&self, todo_id: &str) -> Result<Todo, StoreError> {
        let todo_id = uuid_text(todo_id)?;
        self.store.with_conn(|conn| complete_todo_tx(conn, &todo_id))
    }

    pub fn reopen_todo(&self, todo_id: &str) -> Result<Todo, StoreError> {
        let todo_id = uuid_text(todo_id)?;
        self.store.with_conn(|conn| {
            conn.query_row(
                "UPDATE todos SET status = 'pending' WHERE id = ?1 RETURNING *",
                params![todo_id],
                todo_from_row,
            )
            .optional()?
            .ok_or_else(|| StoreError::NotFound("未找到可恢复的待办，请重新查询并确认事项".into()))
        })
    }

    /// Direct create (plugins/todo/store.py create_todo): no tool call, no run.
    pub fn create_todo(&self, title: &str) -> Result<Todo, StoreError> {
        let title = validated_title(title)?;
        self.store.with_conn(|conn| create_todo_tx(conn, &title, None))
    }

    /// Direct title edit (plugins/todo/store.py update_todo_title); completed rows too.
    pub fn update_todo_title(&self, todo_id: &str, title: &str) -> Result<Todo, StoreError> {
        let todo_id = uuid_text(todo_id)?;
        let title = validated_title(title)?;
        self.store.with_conn(|conn| {
            conn.query_row(
                "UPDATE todos SET title = ?1 WHERE id = ?2 RETURNING *",
                params![title, todo_id],
                todo_from_row,
            )
            .optional()?
            .ok_or_else(|| StoreError::NotFound("待办不存在或已删除".into()))
        })
    }

    /// Hard delete (plugins/todo/store.py delete_todo); nothing references todos.
    pub fn delete_todo(&self, todo_id: &str) -> Result<Todo, StoreError> {
        let todo_id = uuid_text(todo_id)?;
        self.store.with_conn(|conn| {
            conn.query_row("DELETE FROM todos WHERE id = ?1 RETURNING *", params![todo_id], todo_from_row)
                .optional()?
                .ok_or_else(|| StoreError::NotFound("待办不存在或已删除".into()))
        })
    }
}
