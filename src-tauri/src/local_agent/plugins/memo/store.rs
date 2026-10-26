//! Memo domain storage for local mode (mirrors `server/app/plugins/memo/store.py`).
//!
//! The domain-agnostic skeleton (start_tool / tool_outcome / fail_tool) stays
//! in `local_agent::store`; everything that knows the memos table lives in the
//! plugin. Direct Tauri commands mount these operations from the core.
use crate::agent_protocol::{Envelope, ToolCall};
use crate::backend::{Memo, MemoKind, MemoStatus};
use crate::local_agent::store::{normalize_instant, uuid_text, Store, StoreError};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::json;

fn memo_from_row(row: &Row) -> rusqlite::Result<Memo> {
    Ok(Memo {
        id: row.get("id")?,
        kind: if row.get::<_, String>("kind")? == "goal" {
            MemoKind::Goal
        } else {
            MemoKind::Note
        },
        title: row.get("title")?,
        content: row.get("content")?,
        status: if row.get::<_, String>("status")? == "archived" {
            MemoStatus::Archived
        } else {
            MemoStatus::Active
        },
        created_at: row.get("created_at")?,
        review_at: row.get("review_at")?,
    })
}

fn kind_name(kind: MemoKind) -> &'static str {
    match kind {
        MemoKind::Note => "note",
        MemoKind::Goal => "goal",
    }
}

/// Same rule and message as the server's `validated_title` / memo.create tool.
fn validated_title(title: &str) -> Result<String, StoreError> {
    if title.trim().is_empty() || title.chars().count() > 2000 {
        return Err(StoreError::Validation(
            "备忘标题需为 1 到 2000 个字符".into(),
        ));
    }
    Ok(title.trim().to_owned())
}

/// Same rule and message as the server's `validated_content`; None is absent
/// (and clears the body on update).
fn validated_content(content: Option<&str>) -> Result<Option<String>, StoreError> {
    match content {
        None => Ok(None),
        Some(text) if text.chars().count() > 20000 => Err(StoreError::Validation(
            "备忘正文需为不超过 20000 个字符的文本".into(),
        )),
        Some(text) => Ok(Some(text.to_owned())),
    }
}

fn create_memo_tx(
    conn: &Connection,
    title: &str,
    kind: MemoKind,
    content: Option<&str>,
    source_tool_call_id: Option<&str>,
) -> Result<Memo, StoreError> {
    Ok(conn.query_row(
        "INSERT INTO memos(id, kind, title, content, source_tool_call_id, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING *",
        params![
            uuid::Uuid::new_v4().to_string(),
            kind_name(kind),
            title,
            content,
            source_tool_call_id,
            normalize_instant(Utc::now())
        ],
        memo_from_row,
    )?)
}

/// Shared setter/CAS (plugins/memo/store.py set_memo_review_in_transaction).
fn set_review_tx(
    conn: &Connection,
    memo_id: &str,
    target: Option<DateTime<Utc>>,
    expected: Option<DateTime<Utc>>,
) -> Result<Memo, StoreError> {
    let memo = conn
        .query_row(
            "SELECT * FROM memos WHERE id = ?1",
            params![memo_id],
            memo_from_row,
        )
        .optional()?
        .ok_or_else(|| StoreError::NotFound("未找到备忘，请刷新核对".into()))?;
    if memo.status != MemoStatus::Active {
        return Err(StoreError::Conflict("备忘已归档，请刷新核对".into()));
    }
    let target = target.map(normalize_instant);
    // A lost-response retry may arrive after its target time has passed.
    if memo.review_at == target {
        return Ok(memo);
    }
    if memo.review_at != expected.map(normalize_instant) {
        return Err(StoreError::Conflict(
            "回顾时间已被修改，请刷新后重试".into(),
        ));
    }
    if let Some(target) = &target {
        // The real clock is authoritative, matching the server's database clock.
        if target.as_str() <= normalize_instant(Utc::now()).as_str() {
            return Err(StoreError::Validation("回顾时间必须晚于当前时间".into()));
        }
    }
    Ok(conn.query_row(
        "UPDATE memos SET review_at = ?1 WHERE id = ?2 RETURNING *",
        params![target, memo_id],
        memo_from_row,
    )?)
}

/// Archiving clears the review time, mirroring todo completion clearing reminders.
fn set_archived_tx(conn: &Connection, memo_id: &str, archived: bool) -> Result<Memo, StoreError> {
    let sql = if archived {
        "UPDATE memos SET status = 'archived', review_at = NULL WHERE id = ?1 RETURNING *"
    } else {
        "UPDATE memos SET status = 'active' WHERE id = ?1 RETURNING *"
    };
    conn.query_row(sql, params![memo_id], memo_from_row)
        .optional()?
        .ok_or_else(|| StoreError::NotFound("未找到备忘，请刷新核对".into()))
}

/// Field whitelist mirrors update_memo_in_transaction; `content: Some(None)`
/// clears the body, `None` leaves it untouched.
fn update_memo_tx(
    conn: &Connection,
    memo_id: &str,
    title: Option<&str>,
    kind: Option<MemoKind>,
    content: Option<Option<String>>,
) -> Result<Memo, StoreError> {
    if title.is_none() && kind.is_none() && content.is_none() {
        return Err(StoreError::Validation(
            "必须且只能提供 title、kind 或 content 中的至少一项".into(),
        ));
    }
    let mut assignments = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    if let Some(title) = title {
        assignments.push("title = ?");
        values.push(Box::new(title.to_owned()));
    }
    if let Some(kind) = kind {
        assignments.push("kind = ?");
        values.push(Box::new(kind_name(kind).to_owned()));
    }
    if let Some(content) = content {
        assignments.push("content = ?");
        values.push(Box::new(content));
    }
    values.push(Box::new(memo_id.to_owned()));
    let sql = format!(
        "UPDATE memos SET {} WHERE id = ? RETURNING *",
        assignments.join(", ")
    );
    let refs: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();
    conn.query_row(&sql, refs.as_slice(), memo_from_row)
        .optional()?
        .ok_or_else(|| StoreError::NotFound("备忘不存在或已删除".into()))
}

fn memos_tx(
    conn: &Connection,
    kind: Option<MemoKind>,
    include_archived: bool,
) -> Result<Vec<Memo>, StoreError> {
    let mut statement = conn.prepare(
        "SELECT * FROM memos WHERE (?1 IS NULL OR kind = ?1) AND (?2 OR status = 'active') \
         ORDER BY created_at, id",
    )?;
    let memos = statement
        .query_map(
            params![kind.map(kind_name), include_archived],
            memo_from_row,
        )?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(memos)
}

/// Memo domain operations against the core store; direct commands and the
/// plugin's tool effects both go through this handle.
pub struct MemoStore<'a> {
    store: &'a Store,
}

impl<'a> MemoStore<'a> {
    pub fn new(store: &'a Store) -> Self {
        Self { store }
    }

    /// memo.create: the memo, its optional review time and the tool result
    /// commit atomically; a failed schedule leaves no orphan memo.
    pub fn tool_create_memo(
        &self,
        run_id: &str,
        tool_id: &str,
        title: &str,
        kind: MemoKind,
        content: Option<&str>,
        review_at: Option<DateTime<Utc>>,
    ) -> Result<(ToolCall, Envelope), StoreError> {
        self.store.tool_outcome(run_id, tool_id, |tx| {
            let memo = create_memo_tx(tx, title, kind, content, Some(tool_id))?;
            let item = match review_at {
                Some(target) => set_review_tx(tx, &memo.id, Some(target), None)?,
                None => memo,
            };
            Ok(json!({"item": item}))
        })
    }

    pub fn tool_list_memos(
        &self,
        run_id: &str,
        tool_id: &str,
        kind: Option<MemoKind>,
        include_archived: bool,
    ) -> Result<(ToolCall, Envelope), StoreError> {
        self.store.tool_outcome(run_id, tool_id, |tx| {
            Ok(json!({"items": memos_tx(tx, kind, include_archived)?}))
        })
    }

    pub fn tool_update_memo(
        &self,
        run_id: &str,
        tool_id: &str,
        memo_id: &str,
        title: Option<&str>,
        kind: Option<MemoKind>,
        content: Option<Option<String>>,
    ) -> Result<(ToolCall, Envelope), StoreError> {
        self.store.tool_outcome(run_id, tool_id, |tx| {
            Ok(json!({"item": update_memo_tx(tx, memo_id, title, kind, content)?}))
        })
    }

    pub fn tool_archive_memo(
        &self,
        run_id: &str,
        tool_id: &str,
        memo_id: &str,
        archived: bool,
    ) -> Result<(ToolCall, Envelope), StoreError> {
        self.store.tool_outcome(run_id, tool_id, |tx| {
            Ok(json!({"item": set_archived_tx(tx, memo_id, archived)?}))
        })
    }

    pub fn tool_set_review(
        &self,
        run_id: &str,
        tool_id: &str,
        memo_id: &str,
        target: Option<DateTime<Utc>>,
        expected: Option<DateTime<Utc>>,
    ) -> Result<(ToolCall, Envelope), StoreError> {
        self.store.tool_outcome(run_id, tool_id, |tx| {
            Ok(json!({"item": set_review_tx(tx, memo_id, target, expected)?}))
        })
    }

    pub fn list_memos(
        &self,
        kind: Option<MemoKind>,
        include_archived: bool,
    ) -> Result<Vec<Memo>, StoreError> {
        self.store
            .with_conn(|conn| memos_tx(conn, kind, include_archived))
    }

    /// Active rows due at or before `now`; reading never consumes (due GET analog).
    pub fn due_reviews(&self, now: DateTime<Utc>) -> Result<Vec<Memo>, StoreError> {
        self.store.with_conn(|conn| {
            let mut statement = conn.prepare(
                "SELECT * FROM memos WHERE status = 'active' AND review_at IS NOT NULL \
                 AND review_at <= ?1 ORDER BY review_at, id",
            )?;
            let memos = statement
                .query_map(params![normalize_instant(now)], memo_from_row)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(memos)
        })
    }

    pub fn set_memo_review(
        &self,
        memo_id: &str,
        target: Option<DateTime<Utc>>,
        expected: Option<DateTime<Utc>>,
    ) -> Result<Memo, StoreError> {
        let memo_id = uuid_text(memo_id)?;
        self.store
            .with_conn(|conn| set_review_tx(conn, &memo_id, target, expected))
    }

    pub fn set_memo_archived(&self, memo_id: &str, archived: bool) -> Result<Memo, StoreError> {
        let memo_id = uuid_text(memo_id)?;
        self.store
            .with_conn(|conn| set_archived_tx(conn, &memo_id, archived))
    }

    /// Direct create (plugins/memo/store.py create_memo): no tool call, no run.
    /// An optional review time applies the same CAS/future-time rule as
    /// memo.review.set, atomically with the insert.
    pub fn create_memo(
        &self,
        title: &str,
        kind: MemoKind,
        content: Option<&str>,
        review_at: Option<DateTime<Utc>>,
    ) -> Result<Memo, StoreError> {
        let title = validated_title(title)?;
        let content = validated_content(content)?;
        self.store.with_transaction(|conn| {
            let memo = create_memo_tx(conn, &title, kind, content.as_deref(), None)?;
            match review_at {
                Some(target) => set_review_tx(conn, &memo.id, Some(target), None),
                None => Ok(memo),
            }
        })
    }

    /// Direct edit (plugins/memo/store.py update_memo); archived rows too.
    pub fn update_memo(
        &self,
        memo_id: &str,
        title: Option<&str>,
        kind: Option<MemoKind>,
        content: Option<Option<&str>>,
    ) -> Result<Memo, StoreError> {
        let memo_id = uuid_text(memo_id)?;
        let title = title.map(validated_title).transpose()?;
        let content = content.map(|value| validated_content(value)).transpose()?;
        self.store
            .with_conn(|conn| update_memo_tx(conn, &memo_id, title.as_deref(), kind, content))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_agent::store::StartedTool;
    use chrono::Duration;

    fn memos(store: &Store) -> MemoStore<'_> {
        MemoStore::new(store)
    }

    fn future(hours: i64) -> DateTime<Utc> {
        Utc::now() + Duration::hours(hours)
    }

    fn running_run(store: &Store) -> (String, String) {
        let session = store.create_session().unwrap();
        store
            .submit(&session, &uuid::Uuid::new_v4().to_string(), "记录")
            .unwrap();
        let claimed = store.claim(&session).unwrap().unwrap();
        (session, claimed.run.id)
    }

    #[test]
    fn review_rules_mirror_server_business_contract() {
        let store = Store::open_memory();
        let memo = memos(&store)
            .create_memo("目标", MemoKind::Goal, Some("细节"), None)
            .unwrap();
        assert_eq!(memo.kind, MemoKind::Goal);
        assert_eq!(memo.content.as_deref(), Some("细节"));
        assert_eq!(memo.status, MemoStatus::Active);
        assert!(memo.review_at.is_none());

        // Set, then a lost-response retry with the same target stays idempotent.
        let target = future(3);
        let set = memos(&store)
            .set_memo_review(&memo.id, Some(target), None)
            .unwrap();
        assert!(set.review_at.is_some());
        let same = memos(&store)
            .set_memo_review(&memo.id, Some(target), None)
            .unwrap();
        assert_eq!(same.review_at, set.review_at);
        // Stale CAS is a conflict; past targets are rejected against the real clock.
        let conflict = memos(&store)
            .set_memo_review(&memo.id, Some(future(4)), None)
            .unwrap_err();
        assert_eq!(
            conflict,
            StoreError::Conflict("回顾时间已被修改，请刷新后重试".into())
        );
        let current: DateTime<Utc> = DateTime::parse_from_rfc3339(&set.review_at.clone().unwrap())
            .unwrap()
            .with_timezone(&Utc);
        let past = memos(&store)
            .set_memo_review(
                &memo.id,
                Some(Utc::now() - Duration::minutes(1)),
                Some(current),
            )
            .unwrap_err();
        assert_eq!(
            past,
            StoreError::Validation("回顾时间必须晚于当前时间".into())
        );
        // Cancel is explicit and clearing again is a no-op retry.
        let cleared = memos(&store)
            .set_memo_review(&memo.id, None, Some(current))
            .unwrap();
        assert!(cleared.review_at.is_none());
        assert!(memos(&store)
            .set_memo_review(&memo.id, None, Some(current))
            .unwrap()
            .review_at
            .is_none());
        // Archived memos reject reviews; missing ids share the server message.
        memos(&store).set_memo_archived(&memo.id, true).unwrap();
        assert_eq!(
            memos(&store)
                .set_memo_review(&memo.id, Some(future(5)), None)
                .unwrap_err(),
            StoreError::Conflict("备忘已归档，请刷新核对".into())
        );
        assert_eq!(
            memos(&store)
                .set_memo_review(&uuid::Uuid::new_v4().to_string(), None, None)
                .unwrap_err(),
            StoreError::NotFound("未找到备忘，请刷新核对".into())
        );
        assert_eq!(
            memos(&store)
                .set_memo_review("../bad", None, None)
                .unwrap_err(),
            StoreError::Validation("标识必须为有效 UUID".into())
        );
    }

    #[test]
    fn archive_clears_review_and_unarchive_restores_active() {
        let store = Store::open_memory();
        let memo = memos(&store)
            .create_memo("备忘", MemoKind::Note, None, None)
            .unwrap();
        memos(&store)
            .set_memo_review(&memo.id, Some(future(2)), None)
            .unwrap();
        let archived = memos(&store).set_memo_archived(&memo.id, true).unwrap();
        assert_eq!(archived.status, MemoStatus::Archived);
        assert!(archived.review_at.is_none());
        // Unarchiving never resurrects the cleared review time.
        let active = memos(&store).set_memo_archived(&memo.id, false).unwrap();
        assert_eq!(active.status, MemoStatus::Active);
        assert!(active.review_at.is_none());
        assert_eq!(
            memos(&store)
                .set_memo_archived(&uuid::Uuid::new_v4().to_string(), true)
                .unwrap_err(),
            StoreError::NotFound("未找到备忘，请刷新核对".into())
        );
    }

    #[test]
    fn direct_create_and_update_validate_and_scope_like_the_server() {
        let store = Store::open_memory();
        assert_eq!(
            memos(&store)
                .create_memo("   ", MemoKind::Note, None, None)
                .unwrap_err(),
            StoreError::Validation("备忘标题需为 1 到 2000 个字符".into())
        );
        assert_eq!(
            memos(&store)
                .create_memo(&"长".repeat(2001), MemoKind::Note, None, None)
                .unwrap_err(),
            StoreError::Validation("备忘标题需为 1 到 2000 个字符".into())
        );
        assert_eq!(
            memos(&store)
                .create_memo("备忘", MemoKind::Note, Some(&"长".repeat(20001)), None)
                .unwrap_err(),
            StoreError::Validation("备忘正文需为不超过 20000 个字符的文本".into())
        );
        let memo = memos(&store)
            .create_memo("  买牛奶  ", MemoKind::Note, Some("低脂"), None)
            .unwrap();
        assert_eq!(memo.title, "买牛奶");

        let renamed = memos(&store)
            .update_memo(&memo.id, Some(" 新标题 "), None, None)
            .unwrap();
        assert_eq!(renamed.title, "新标题");
        assert_eq!(renamed.content.as_deref(), Some("低脂"));
        let cleared = memos(&store)
            .update_memo(&memo.id, None, None, Some(None))
            .unwrap();
        assert!(cleared.content.is_none());
        let promoted = memos(&store)
            .update_memo(&memo.id, None, Some(MemoKind::Goal), None)
            .unwrap();
        assert_eq!(promoted.kind, MemoKind::Goal);
        assert_eq!(
            memos(&store)
                .update_memo(&memo.id, None, None, None)
                .unwrap_err(),
            StoreError::Validation("必须且只能提供 title、kind 或 content 中的至少一项".into())
        );
        let missing = uuid::Uuid::new_v4().to_string();
        assert_eq!(
            memos(&store)
                .update_memo(&missing, Some("x"), None, None)
                .unwrap_err(),
            StoreError::NotFound("备忘不存在或已删除".into())
        );
        assert_eq!(
            memos(&store)
                .update_memo("../bad", Some("x"), None, None)
                .unwrap_err(),
            StoreError::Validation("标识必须为有效 UUID".into())
        );
    }

    #[test]
    fn direct_create_with_review_applies_atomically_and_rejects_past_times() {
        let store = Store::open_memory();
        let target = future(2);
        let memo = memos(&store)
            .create_memo("带回顾", MemoKind::Note, None, Some(target))
            .unwrap();
        assert_eq!(
            memo.review_at.as_deref(),
            Some(normalize_instant(target).as_str())
        );
        // A past review time fails and leaves no orphan memo behind.
        let error = memos(&store)
            .create_memo(
                "过期回顾",
                MemoKind::Note,
                None,
                Some(Utc::now() - Duration::minutes(1)),
            )
            .unwrap_err();
        assert_eq!(
            error,
            StoreError::Validation("回顾时间必须晚于当前时间".into())
        );
        let all = memos(&store).list_memos(None, true).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, memo.id);
    }

    #[test]
    fn list_filters_by_kind_and_archived_flag() {
        let store = Store::open_memory();
        let note = memos(&store)
            .create_memo("便签", MemoKind::Note, None, None)
            .unwrap();
        memos(&store)
            .create_memo("目标", MemoKind::Goal, None, None)
            .unwrap();
        memos(&store).set_memo_archived(&note.id, true).unwrap();
        let active = memos(&store).list_memos(None, false).unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].kind, MemoKind::Goal);
        let all = memos(&store).list_memos(None, true).unwrap();
        assert_eq!(all.len(), 2);
        let goals = memos(&store)
            .list_memos(Some(MemoKind::Goal), true)
            .unwrap();
        assert_eq!(goals.len(), 1);
        assert!(memos(&store)
            .list_memos(Some(MemoKind::Note), false)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn due_reviews_only_list_active_rows_at_or_before_now() {
        let store = Store::open_memory();
        let (_session, run) = running_run(&store);
        for (call, title, offset) in [
            ("call_1", "一小时后", 1),
            ("call_2", "三小时后", 3),
            ("call_3", "半小时后", 0),
        ] {
            let StartedTool::Fresh(tool, _) = store
                .start_tool(&run, call, "memo.create", &json!({"title": title}))
                .unwrap()
                .unwrap()
            else {
                panic!("fresh tool expected")
            };
            memos(&store)
                .tool_create_memo(
                    &run,
                    &tool.id,
                    title,
                    MemoKind::Note,
                    None,
                    Some(Utc::now() + Duration::minutes(30 + offset * 60)),
                )
                .unwrap();
        }
        // Two hours later the +0.5h and +1.5h rows are due, ordered by time.
        let later = Utc::now() + Duration::hours(2);
        let due = memos(&store).due_reviews(later).unwrap();
        assert_eq!(due.len(), 2);
        assert_eq!(due[0].title, "半小时后");
        assert_eq!(due[1].title, "一小时后");
        // Archiving one removes it from the due list without consuming reads.
        memos(&store).set_memo_archived(&due[0].id, true).unwrap();
        let due = memos(&store).due_reviews(later).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].title, "一小时后");
        assert!(memos(&store).due_reviews(Utc::now()).unwrap().is_empty());
    }

    #[test]
    fn create_with_past_review_leaves_no_orphan_memo() {
        let store = Store::open_memory();
        let (_session, run) = running_run(&store);
        let StartedTool::Fresh(tool, _) = store
            .start_tool(&run, "call_1", "memo.create", &json!({"title": "回顾"}))
            .unwrap()
            .unwrap()
        else {
            panic!("fresh tool expected")
        };
        let error = memos(&store)
            .tool_create_memo(
                &run,
                &tool.id,
                "回顾",
                MemoKind::Note,
                None,
                Some(Utc::now() - Duration::minutes(5)),
            )
            .unwrap_err();
        assert_eq!(
            error,
            StoreError::Validation("回顾时间必须晚于当前时间".into())
        );
        assert!(memos(&store).list_memos(None, true).unwrap().is_empty());
    }

    #[test]
    fn tool_update_and_archive_flow_through_the_shared_transaction() {
        let store = Store::open_memory();
        let (_session, run) = running_run(&store);
        let memo = memos(&store)
            .create_memo("旧标题", MemoKind::Note, Some("旧正文"), None)
            .unwrap();
        let StartedTool::Fresh(tool, _) = store
            .start_tool(&run, "call_1", "memo.update", &json!({"memo_id": memo.id}))
            .unwrap()
            .unwrap()
        else {
            panic!("fresh tool expected")
        };
        let (done, _) = memos(&store)
            .tool_update_memo(
                &run,
                &tool.id,
                &memo.id,
                Some("新标题"),
                Some(MemoKind::Goal),
                Some(None),
            )
            .unwrap();
        let item = &done.result.as_ref().unwrap()["item"];
        assert_eq!(item["title"], "新标题");
        assert_eq!(item["kind"], "goal");
        assert!(item["content"].is_null());
        let StartedTool::Fresh(tool, _) = store
            .start_tool(
                &run,
                "call_2",
                "memo.archive",
                &json!({"memo_id": memo.id, "archived": true}),
            )
            .unwrap()
            .unwrap()
        else {
            panic!("fresh tool expected")
        };
        let (done, _) = memos(&store)
            .tool_archive_memo(&run, &tool.id, &memo.id, true)
            .unwrap();
        assert_eq!(done.result.as_ref().unwrap()["item"]["status"], "archived");
    }
}
