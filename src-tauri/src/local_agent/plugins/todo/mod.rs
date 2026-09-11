//! The todo capability plugin (mirrors `server/app/plugins/todo/`):
//! manifest-backed declarations plus validation and execution. The core
//! (`local_agent::plugin_runtime`) owns the execute skeleton; this module only
//! knows the todo business branches.
pub mod manifest;
mod store;

pub use store::TodoStore;

use crate::local_agent::plugin_runtime::ToolPlugin;
use crate::local_agent::store::{parse_reminder_time, Store, StoreError};
use crate::agent_protocol::{Envelope, ToolCall};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use std::any::Any;

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

/// Port of `validated_arguments` (plugins/todo/tools.py), messages from the manifest.
fn validated_arguments(business_name: &str, arguments: &Value) -> Result<Params, String> {
    let object = arguments
        .as_object()
        .ok_or_else(|| manifest::validation_message("arguments_not_object").to_owned())?;
    match business_name {
        "todo.create" => {
            if !object.contains_key("title") || extra_keys(object, &["title", "remind_at"]) {
                return Err(manifest::validation_message("create_requires_title").into());
            }
            let title = object["title"].as_str().unwrap_or_default();
            if title.trim().is_empty() || title.chars().count() > 2000 {
                return Err(manifest::validation_message("title_length").into());
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
                return Err(manifest::validation_message("reminder_set_keys").into());
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
                return Err(manifest::validation_message("list_no_arguments").into());
            }
            Ok(Params::List)
        }
        "todo.complete" => {
            if object.len() != 1 || !object.contains_key("todo_id") {
                return Err(manifest::validation_message("complete_todo_id").into());
            }
            Ok(Params::Complete {
                todo_id: uuid_argument(
                    &object["todo_id"],
                    manifest::validation_message("complete_todo_id"),
                )?,
            })
        }
        _ => Err(manifest::validation_message("unsupported_tool").into()),
    }
}

/// The todo capability plugin (first consumer of the core plugin seam).
pub struct TodoPlugin;

impl TodoPlugin {
    pub fn new() -> Self {
        Self
    }
}

impl ToolPlugin for TodoPlugin {
    fn definitions(&self) -> &'static [Value] {
        manifest::manifest()["tools"]
            .as_array()
            .expect("plugin.json tools 必须为数组")
    }

    fn model_tools(&self) -> Vec<Value> {
        self.definitions()
            .iter()
            .map(|tool| {
                json!({"type": "function", "function": {
                    "name": tool["handler_key"],
                    "description": tool["description"],
                    "parameters": tool["input_schema"],
                }})
            })
            .collect()
    }

    fn prompt_fragments(&self) -> Vec<&'static str> {
        // Manifest declaration order is the slot order (tool rules first; the
        // reminder/time rules reference the tool names they introduce).
        manifest::prompt_fragments()
    }

    fn business_name(&self, model_name: &str) -> Option<&'static str> {
        manifest::model_to_business(model_name)
    }

    fn validate(&self, business_name: &str, arguments: &Value) -> Result<Box<dyn Any>, String> {
        validated_arguments(business_name, arguments).map(|params| Box::new(params) as Box<dyn Any>)
    }

    fn execute(
        &self,
        store: &Store,
        run_id: &str,
        tool: &ToolCall,
        params: Box<dyn Any>,
    ) -> Result<(ToolCall, Envelope), StoreError> {
        let params = params.downcast::<Params>().map_err(|_| StoreError::Internal)?;
        let todos = TodoStore::new(store);
        match *params {
            Params::Create { title, remind_at } => {
                todos.tool_create_todo(run_id, &tool.id, &title, remind_at)
            }
            Params::List => todos.tool_list_todos(run_id, &tool.id),
            Params::Complete { todo_id } => todos.tool_complete_todo(run_id, &tool.id, &todo_id),
            Params::ReminderSet {
                todo_id,
                remind_at,
                expected,
            } => todos.tool_set_reminder(run_id, &tool.id, &todo_id, remind_at, expected),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 双端同源等价性：plugin.json 是唯一事实源，本测试钉住从它生成的
    /// MODEL_TOOLS（独立转写）；Python 对称测试在
    /// server/tests/test_plugin_manifest.py 钉住同一份字面量。
    #[test]
    fn tool_schemas_match_plugin_manifest() {
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
        assert_eq!(json!(TodoPlugin::new().model_tools()), expected);
    }

    /// Every manifest tool's handler_key maps back to its business name, so
    /// the model-facing schema and the execution routing cannot drift apart.
    #[test]
    fn name_mapping_round_trips_every_manifest_tool() {
        let plugin = TodoPlugin::new();
        for tool in plugin.definitions() {
            let handler = tool["handler_key"].as_str().unwrap();
            let business = tool["name"].as_str().unwrap();
            assert_eq!(plugin.business_name(handler), Some(business));
        }
        assert_eq!(plugin.business_name("unknown_tool"), None);
    }
}
