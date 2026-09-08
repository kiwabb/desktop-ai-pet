//! Model-visible todo tools, mirroring `server/app/todo_tools.py`.
//!
//! TOOL_DEFINITIONS (including description text — it is prompt engineering) are
//! copied verbatim; executors commit the business effect and the tool result in
//! one transaction through the store helpers.
use super::store::{parse_reminder_time, StartedTool, Store, StoreError};
use crate::agent_protocol::ToolCall;
use crate::llm::ModelToolCall;
use chrono::{DateTime, Utc};
use serde_json::{json, Value};

/// Underscore (model) name -> dotted business name; inverse of TOOL_HANDLERS.
pub fn model_to_business(model_name: &str) -> Option<&'static str> {
    match model_name {
        "todo_create" => Some("todo.create"),
        "todo_list" => Some("todo.list"),
        "todo_complete" => Some("todo.complete"),
        "todo_reminder_set" => Some("todo.reminder.set"),
        _ => None,
    }
}

/// MODEL_TOOLS: OpenAI function format of TOOL_DEFINITIONS (todo_tools.py L40-45).
pub fn model_tools() -> Vec<Value> {
    vec![
        json!({"type": "function", "function": {
            "name": "todo_create",
            "description": "创建一项真实待办；新事项需要提醒时同时提供 remind_at，原子保存事项与提醒。仅在用户要求记录或提醒时使用。",
            "parameters": {"type": "object", "properties": {
                "title": {"type": "string", "minLength": 1, "maxLength": 2000,
                          "description": "用户要求记录的待办标题"},
                "remind_at": {"type": ["string", "null"], "format": "date-time",
                              "description": "未来的带时区 ISO 时间；省略或 null 表示普通待办。不能仅将时间写入标题充当提醒。"}},
                "required": ["title"], "additionalProperties": false},
        }}),
        json!({"type": "function", "function": {
            "name": "todo_list",
            "description": "查询当前账号的真实待办；没有记录时返回空列表。",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": false},
        }}),
        json!({"type": "function", "function": {
            "name": "todo_complete",
            "description": "完成用户明确指定的一项已有待办；目标缺失或有歧义时先询问，不得猜测。",
            "parameters": {"type": "object", "properties": {
                "todo_id": {"type": "string", "format": "uuid",
                            "description": "从真实待办查询结果取得的记录 ID"}},
                "required": ["todo_id"], "additionalProperties": false},
        }}),
        json!({"type": "function", "function": {
            "name": "todo_reminder_set",
            "description": "设置、修改或取消已有待办的提醒。先查询真实 ID 和当前 remind_at；取消传 null，目标不明确先询问。",
            "parameters": {"type": "object", "properties": {
                "todo_id": {"type": "string", "format": "uuid",
                            "description": "从真实查询结果取得的已有待办 ID"},
                "remind_at": {"type": ["string", "null"], "format": "date-time",
                              "description": "未来的带时区 ISO 时间；null 取消提醒"},
                "expected_remind_at": {"type": ["string", "null"], "format": "date-time",
                                       "description": "真实查询结果中的当前 remind_at，未设置为 null；不得猜测"}},
                "required": ["todo_id", "remind_at", "expected_remind_at"], "additionalProperties": false},
        }}),
    ]
}

enum Params {
    Create {
        title: String,
        remind_at: Option<DateTime<Utc>>,
    },
    List,
    Complete {
        todo_id: String,
    },
    ReminderSet {
        todo_id: String,
        remind_at: Option<DateTime<Utc>>,
        expected: Option<DateTime<Utc>>,
    },
}

fn extra_keys(arguments: &serde_json::Map<String, Value>, allowed: &[&str]) -> bool {
    arguments.keys().any(|key| !allowed.contains(&key.as_str()))
}

fn uuid_argument(value: &Value, message: &str) -> Result<String, String> {
    value
        .as_str()
        .and_then(|text| uuid::Uuid::parse_str(text).ok())
        .map(|id| id.to_string())
        .ok_or_else(|| message.to_owned())
}

/// Port of `validated_arguments` (todo_tools.py L48-75), messages verbatim.
fn validated_arguments(business_name: &str, arguments: &Value) -> Result<Params, String> {
    let object = arguments
        .as_object()
        .ok_or_else(|| "工具参数必须为对象".to_owned())?;
    match business_name {
        "todo.create" => {
            if !object.contains_key("title") || extra_keys(object, &["title", "remind_at"]) {
                return Err("创建待办必须提供 title，仅可附加 remind_at 参数".into());
            }
            let title = object["title"].as_str().unwrap_or_default();
            if title.trim().is_empty() || title.chars().count() > 2000 {
                return Err("待办标题需为 1 到 2000 个字符".into());
            }
            let remind_at = parse_reminder_time(object.get("remind_at").unwrap_or(&Value::Null))
                .map_err(|error| error.message())?;
            Ok(Params::Create {
                title: title.trim().to_owned(),
                remind_at,
            })
        }
        "todo.reminder.set" => {
            if object.len() != 3 || extra_keys(object, &["todo_id", "remind_at", "expected_remind_at"]) {
                return Err("设置提醒必须且只能提供 todo_id、remind_at 和 expected_remind_at".into());
            }
            let todo_id = uuid_argument(&object["todo_id"], "todo_id 必须为 UUID")?;
            let remind_at = parse_reminder_time(&object["remind_at"]).map_err(|error| error.message())?;
            let expected = parse_reminder_time(&object["expected_remind_at"])
                .map_err(|error| error.message())?;
            Ok(Params::ReminderSet {
                todo_id,
                remind_at,
                expected,
            })
        }
        "todo.list" => {
            if !object.is_empty() {
                return Err("查询待办不接受额外参数".into());
            }
            Ok(Params::List)
        }
        "todo.complete" => {
            if object.len() != 1 || !object.contains_key("todo_id") {
                return Err("完成待办只接受有效的 todo_id 参数".into());
            }
            Ok(Params::Complete {
                todo_id: uuid_argument(&object["todo_id"], "完成待办只接受有效的 todo_id 参数")?,
            })
        }
        _ => Err("不支持该工具".into()),
    }
}

/// Business failures surface their fixed message; anything else is sanitized
/// (todo_tools.py L120-127: never leak provider/DB exception strings).
fn tool_error_message(error: &StoreError) -> String {
    match error {
        StoreError::Validation(_) | StoreError::NotFound(_) | StoreError::Conflict(_) => {
            error.message()
        }
        StoreError::Internal => "工具执行失败，未确认保存成功".into(),
    }
}

pub struct ExecutedTool {
    pub view: ToolCall,
    /// Ordered durable events (tool.started, then tool.finished) for projection.
    pub envelopes: Vec<crate::agent_protocol::Envelope>,
}

/// TodoTools.execute: start is idempotent, business and result commit together,
/// and a repeated call returns its committed outcome without rewriting.
pub fn execute(
    store: &Store,
    run_id: &str,
    call: &ModelToolCall,
) -> Result<Option<ExecutedTool>, StoreError> {
    let business_name = model_to_business(&call.name).unwrap_or(&call.name);
    let arguments = call
        .parsed_arguments()
        .ok_or_else(|| StoreError::Validation("模型返回了无效的工具参数".into()))?;
    let started = match store.start_tool(run_id, &call.id, business_name, &arguments)? {
        None => return Ok(None),
        Some(StartedTool::Existing(view)) => {
            return Ok(Some(ExecutedTool {
                view,
                envelopes: Vec::new(),
            }))
        }
        Some(StartedTool::Fresh(view, envelope)) => (view, envelope),
    };
    let (tool, started_envelope) = started;
    let mut envelopes = vec![started_envelope];
    let outcome = validated_arguments(business_name, &arguments).map_err(StoreError::Validation);
    let outcome = outcome.and_then(|params| match params {
        Params::Create { title, remind_at } => {
            store.tool_create_todo(run_id, &tool.id, &title, remind_at)
        }
        Params::List => store.tool_list_todos(run_id, &tool.id),
        Params::Complete { todo_id } => store.tool_complete_todo(run_id, &tool.id, &todo_id),
        Params::ReminderSet {
            todo_id,
            remind_at,
            expected,
        } => store.tool_set_reminder(run_id, &tool.id, &todo_id, remind_at, expected),
    });
    let (view, finished) = match outcome {
        Ok(done) => done,
        Err(error) => store
            .fail_tool(run_id, &tool.id, &tool_error_message(&error))?
            .ok_or(StoreError::Internal)?,
    };
    envelopes.push(finished);
    Ok(Some(ExecutedTool { view, envelopes }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_protocol::{RunStatus, ToolStatus};
    use crate::local_agent::store::Store;

    /// The expected schema text is pinned as an independent transcription of
    /// todo_tools.py L11-38 so accidental edits to model_tools() fail loudly.
    #[test]
    fn tool_schemas_match_server_verbatim() {
        let expected: Value = serde_json::from_str(r#"[
            {"type":"function","function":{"name":"todo_create",
             "description":"创建一项真实待办；新事项需要提醒时同时提供 remind_at，原子保存事项与提醒。仅在用户要求记录或提醒时使用。",
             "parameters":{"type":"object","properties":{
                "title":{"type":"string","minLength":1,"maxLength":2000,"description":"用户要求记录的待办标题"},
                "remind_at":{"type":["string","null"],"format":"date-time","description":"未来的带时区 ISO 时间；省略或 null 表示普通待办。不能仅将时间写入标题充当提醒。"}},
                "required":["title"],"additionalProperties":false}}},
            {"type":"function","function":{"name":"todo_list",
             "description":"查询当前账号的真实待办；没有记录时返回空列表。",
             "parameters":{"type":"object","properties":{},"additionalProperties":false}}},
            {"type":"function","function":{"name":"todo_complete",
             "description":"完成用户明确指定的一项已有待办；目标缺失或有歧义时先询问，不得猜测。",
             "parameters":{"type":"object","properties":{
                "todo_id":{"type":"string","format":"uuid","description":"从真实待办查询结果取得的记录 ID"}},
                "required":["todo_id"],"additionalProperties":false}}},
            {"type":"function","function":{"name":"todo_reminder_set",
             "description":"设置、修改或取消已有待办的提醒。先查询真实 ID 和当前 remind_at；取消传 null，目标不明确先询问。",
             "parameters":{"type":"object","properties":{
                "todo_id":{"type":"string","format":"uuid","description":"从真实查询结果取得的已有待办 ID"},
                "remind_at":{"type":["string","null"],"format":"date-time","description":"未来的带时区 ISO 时间；null 取消提醒"},
                "expected_remind_at":{"type":["string","null"],"format":"date-time","description":"真实查询结果中的当前 remind_at，未设置为 null；不得猜测"}},
                "required":["todo_id","remind_at","expected_remind_at"],"additionalProperties":false}}}
        ]"#).unwrap();
        assert_eq!(json!(model_tools()), expected);
    }

    fn call(name: &str, arguments: &str) -> ModelToolCall {
        ModelToolCall {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.into(),
            arguments: arguments.into(),
        }
    }

    fn call_with_id(id: &str, name: &str, arguments: &str) -> ModelToolCall {
        ModelToolCall {
            id: id.into(),
            name: name.into(),
            arguments: arguments.into(),
        }
    }

    fn running_run(store: &Store) -> (String, String) {
        let session = store.create_session().unwrap();
        store
            .submit(&session, &uuid::Uuid::new_v4().to_string(), "开始")
            .unwrap();
        let claimed = store.claim(&session).unwrap().unwrap();
        (session, claimed.run.id)
    }

    #[test]
    fn execute_create_list_complete_and_reminder_roundtrip() {
        let store = Store::open_memory();
        let (_session, run) = running_run(&store);
        let created = execute(&store, &run, &call("todo_create", r#"{"title":" 喝水 "}"#))
            .unwrap()
            .unwrap();
        assert_eq!(created.view.status, ToolStatus::Completed);
        assert_eq!(created.view.name, "todo.create");
        assert_eq!(created.envelopes.len(), 2);
        assert_eq!(created.envelopes[0].kind, "tool.started");
        assert_eq!(created.envelopes[1].kind, "tool.finished");
        let item = &created.view.result.as_ref().unwrap()["item"];
        assert_eq!(item["title"], "喝水");
        let todo_id = item["id"].as_str().unwrap().to_owned();

        let listed = execute(&store, &run, &call("todo_list", "{}")).unwrap().unwrap();
        assert_eq!(listed.view.result.as_ref().unwrap()["items"].as_array().unwrap().len(), 1);

        let reminder = format!(
            r#"{{"todo_id":"{todo_id}","remind_at":"{}","expected_remind_at":null}}"#,
            "2036-09-09T15:15:00+08:00"
        );
        let set = execute(&store, &run, &call("todo_reminder_set", &reminder))
            .unwrap()
            .unwrap();
        assert_eq!(set.view.status, ToolStatus::Completed);
        assert_eq!(
            set.view.result.as_ref().unwrap()["item"]["remind_at"],
            json!("2036-09-09T07:15:00.000000Z")
        );

        let completed = execute(
            &store,
            &run,
            &call("todo_complete", &format!(r#"{{"todo_id":"{todo_id}"}}"#)),
        )
        .unwrap()
        .unwrap();
        let done = &completed.view.result.as_ref().unwrap()["item"];
        assert_eq!(done["status"], json!("completed"));
        assert_eq!(done["remind_at"], Value::Null);
        let snapshot = store.snapshot(&_session).unwrap();
        let stored = snapshot
            .tool_calls
            .iter()
            .find(|tool| tool.id == completed.view.id)
            .unwrap();
        assert_eq!(stored.status, ToolStatus::Completed);
    }

    #[test]
    fn invalid_arguments_fail_the_tool_not_the_run() {
        let store = Store::open_memory();
        let (_session, run) = running_run(&store);
        for (name, arguments, message) in [
            ("todo_create", r#"{"title":""}"#, "待办标题需为 1 到 2000 个字符"),
            ("todo_create", r#"{"title":"x","extra":1}"#, "创建待办必须提供 title，仅可附加 remind_at 参数"),
            ("todo_create", "[]", "工具参数必须为对象"),
            ("todo_list", r#"{"x":1}"#, "查询待办不接受额外参数"),
            ("todo_complete", r#"{"todo_id":"nope"}"#, "完成待办只接受有效的 todo_id 参数"),
            ("todo_reminder_set", r#"{"todo_id":"00000000-0000-0000-0000-000000000001"}"#, "设置提醒必须且只能提供 todo_id、remind_at 和 expected_remind_at"),
            ("unknown_tool", "{}", "不支持该工具"),
        ] {
            let executed = execute(&store, &run, &call(name, arguments)).unwrap().unwrap();
            assert_eq!(executed.view.status, ToolStatus::Failed, "{name}");
            assert_eq!(executed.view.error.as_deref(), Some(message), "{name}");
        }
        assert!(store.list_todos().unwrap().is_empty());
        let snapshot = store.snapshot(&_session).unwrap();
        assert!(snapshot
            .runs
            .iter()
            .all(|run| run.status == RunStatus::Running));
    }

    #[test]
    fn business_conflicts_become_failed_tool_results() {
        let store = Store::open_memory();
        let (_session, run) = running_run(&store);
        let missing = format!(
            r#"{{"todo_id":"{}","remind_at":null,"expected_remind_at":null}}"#,
            uuid::Uuid::new_v4()
        );
        let executed = execute(&store, &run, &call("todo_reminder_set", &missing))
            .unwrap()
            .unwrap();
        assert_eq!(executed.view.status, ToolStatus::Failed);
        assert_eq!(executed.view.error.as_deref(), Some("未找到待办，请刷新核对"));
        let created = execute(&store, &run, &call("todo_create", r#"{"title":"吃药"}"#))
            .unwrap()
            .unwrap();
        let todo_id = created.view.result.as_ref().unwrap()["item"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let stale = format!(
            r#"{{"todo_id":"{todo_id}","remind_at":"2036-09-09T15:15:00+08:00","expected_remind_at":"2036-01-01T00:00:00+08:00"}}"#
        );
        let executed = execute(&store, &run, &call("todo_reminder_set", &stale))
            .unwrap()
            .unwrap();
        assert_eq!(executed.view.error.as_deref(), Some("提醒已被修改，请刷新后重试"));
        let past = format!(
            r#"{{"todo_id":"{todo_id}","remind_at":"2020-01-01T00:00:00+08:00","expected_remind_at":null}}"#
        );
        let executed = execute(&store, &run, &call("todo_reminder_set", &past))
            .unwrap()
            .unwrap();
        assert_eq!(executed.view.error.as_deref(), Some("提醒时间必须晚于当前时间"));
        // A repeated call id returns the committed outcome without rewriting.
        let first = execute(
            &store,
            &run,
            &call_with_id("call_repeat", "todo_create", r#"{"title":"吃药"}"#),
        )
        .unwrap()
        .unwrap();
        let repeated = execute(
            &store,
            &run,
            &call_with_id("call_repeat", "todo_create", r#"{"title":"吃药"}"#),
        )
        .unwrap()
        .unwrap();
        assert!(repeated.envelopes.is_empty());
        assert_eq!(repeated.view.id, first.view.id);
        assert_eq!(store.list_todos().unwrap().len(), 2);
    }
}
