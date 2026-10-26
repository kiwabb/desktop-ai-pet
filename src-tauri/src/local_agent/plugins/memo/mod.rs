//! The memo capability plugin (mirrors `server/app/plugins/memo/`):
//! manifest-backed declarations plus validation and execution. The core
//! (`local_agent::plugin_runtime`) owns the execute skeleton; this module only
//! knows the memo business branches.
pub mod manifest;
mod store;

pub use store::MemoStore;

use crate::agent_protocol::{Envelope, ToolCall};
use crate::backend::MemoKind;
use crate::local_agent::plugin_runtime::ToolPlugin;
use crate::local_agent::store::{parse_reminder_time, Store, StoreError};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use std::any::Any;

enum Params {
    Create {
        title: String,
        kind: MemoKind,
        content: Option<String>,
        review_at: Option<DateTime<Utc>>,
    },
    List {
        kind: Option<MemoKind>,
        include_archived: bool,
    },
    Update {
        memo_id: String,
        title: Option<String>,
        kind: Option<MemoKind>,
        /// `Some(None)` clears the body; `None` leaves it untouched.
        content: Option<Option<String>>,
    },
    Archive {
        memo_id: String,
        archived: bool,
    },
    ReviewSet {
        memo_id: String,
        review_at: Option<DateTime<Utc>>,
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

fn validated_title(value: &Value) -> Result<String, String> {
    let title = value.as_str().unwrap_or_default();
    if title.trim().is_empty() || title.chars().count() > 2000 {
        return Err(manifest::validation_message("title_length").into());
    }
    Ok(title.trim().to_owned())
}

/// Absent or null -> None; a present value must be text of at most 20000 chars.
fn validated_content(value: Option<&Value>) -> Result<Option<String>, String> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) if text.chars().count() <= 20000 => Ok(Some(text.clone())),
        _ => Err(manifest::validation_message("content_length").into()),
    }
}

fn validated_kind(value: &Value) -> Result<MemoKind, String> {
    match value.as_str() {
        Some("note") => Ok(MemoKind::Note),
        Some("goal") => Ok(MemoKind::Goal),
        _ => Err(manifest::validation_message("kind_values").into()),
    }
}

/// Port of `validated_arguments` (plugins/memo/tools.py), messages from the manifest.
fn validated_arguments(business_name: &str, arguments: &Value) -> Result<Params, String> {
    let object = arguments
        .as_object()
        .ok_or_else(|| manifest::validation_message("arguments_not_object").to_owned())?;
    match business_name {
        "memo.create" => {
            if !object.contains_key("title")
                || extra_keys(object, &["title", "kind", "content", "review_at"])
            {
                return Err(manifest::validation_message("create_requires_title").into());
            }
            let title = validated_title(&object["title"])?;
            let kind = match object.get("kind") {
                // An explicit null kind is invalid (the server rejects it too).
                Some(value) => validated_kind(value)?,
                None => MemoKind::Note,
            };
            let content = validated_content(object.get("content"))?;
            let review_at = parse_reminder_time(object.get("review_at").unwrap_or(&Value::Null))
                .map_err(|error| error.message())?;
            Ok(Params::Create {
                title,
                kind,
                content,
                review_at,
            })
        }
        "memo.list" => {
            if extra_keys(object, &["kind", "include_archived"]) {
                return Err(manifest::validation_message("list_filters").into());
            }
            let include_archived = match object.get("include_archived") {
                None => false,
                Some(Value::Bool(flag)) => *flag,
                _ => return Err(manifest::validation_message("list_filters").into()),
            };
            let kind = match object.get("kind") {
                None | Some(Value::Null) => None,
                Some(value) => Some(validated_kind(value)?),
            };
            Ok(Params::List {
                kind,
                include_archived,
            })
        }
        "memo.update" => {
            if !object.contains_key("memo_id")
                || object.len() == 1
                || extra_keys(object, &["memo_id", "title", "kind", "content"])
            {
                return Err(manifest::validation_message("update_keys").into());
            }
            let memo_id =
                uuid_argument(&object["memo_id"], manifest::validation_message("memo_id"))?;
            let title = match object.get("title") {
                None => None,
                Some(value) => Some(validated_title(value)?),
            };
            // Presence distinguishes "clear" (null) from "unchanged" (absent).
            let content = if object.contains_key("content") {
                Some(validated_content(object.get("content"))?)
            } else {
                None
            };
            let kind = match object.get("kind") {
                None => None,
                Some(value) => Some(validated_kind(value)?),
            };
            Ok(Params::Update {
                memo_id,
                title,
                kind,
                content,
            })
        }
        "memo.archive" => {
            if object.len() != 2
                || !object.contains_key("memo_id")
                || !object["archived"].is_boolean()
            {
                return Err(manifest::validation_message("archive_keys").into());
            }
            Ok(Params::Archive {
                memo_id: uuid_argument(
                    &object["memo_id"],
                    manifest::validation_message("memo_id"),
                )?,
                archived: object["archived"].as_bool().unwrap_or_default(),
            })
        }
        "memo.review.set" => {
            if object.len() != 3
                || extra_keys(object, &["memo_id", "review_at", "expected_review_at"])
            {
                return Err(manifest::validation_message("review_set_keys").into());
            }
            let memo_id =
                uuid_argument(&object["memo_id"], manifest::validation_message("memo_id"))?;
            let review_at =
                parse_reminder_time(&object["review_at"]).map_err(|error| error.message())?;
            let expected = parse_reminder_time(&object["expected_review_at"])
                .map_err(|error| error.message())?;
            Ok(Params::ReviewSet {
                memo_id,
                review_at,
                expected,
            })
        }
        _ => Err(manifest::validation_message("unsupported_tool").into()),
    }
}

/// The memo capability plugin (records and review reminders).
pub struct MemoPlugin;

impl MemoPlugin {
    pub fn new() -> Self {
        Self
    }
}

impl ToolPlugin for MemoPlugin {
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
        // review/time rules reference the tool names they introduce).
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
        let params = params
            .downcast::<Params>()
            .map_err(|_| StoreError::Internal)?;
        let memos = MemoStore::new(store);
        match *params {
            Params::Create {
                title,
                kind,
                content,
                review_at,
            } => memos.tool_create_memo(
                run_id,
                &tool.id,
                &title,
                kind,
                content.as_deref(),
                review_at,
            ),
            Params::List {
                kind,
                include_archived,
            } => memos.tool_list_memos(run_id, &tool.id, kind, include_archived),
            Params::Update {
                memo_id,
                title,
                kind,
                content,
            } => {
                memos.tool_update_memo(run_id, &tool.id, &memo_id, title.as_deref(), kind, content)
            }
            Params::Archive { memo_id, archived } => {
                memos.tool_archive_memo(run_id, &tool.id, &memo_id, archived)
            }
            Params::ReviewSet {
                memo_id,
                review_at,
                expected,
            } => memos.tool_set_review(run_id, &tool.id, &memo_id, review_at, expected),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 双端同源等价性：plugin.json 是唯一事实源，本测试钉住从它生成的
    /// MODEL_TOOLS（独立转写）；Python 对称测试在
    /// server/tests/test_memo_manifest.py 钉住同一份字面量。
    #[test]
    fn tool_schemas_match_plugin_manifest() {
        let expected: Value = serde_json::from_str(r#"[
            {"type":"function","function":{"name":"memo_create",
             "description":"创建一条真实备忘或长期目标；需要回顾时同时提供 review_at，原子保存记录与回顾时间。仅在用户要求记录时使用。",
             "parameters":{"type":"object","properties":{
                "title":{"type":"string","minLength":1,"maxLength":2000,"description":"用户要求记录的备忘标题（摘要）"},
                "kind":{"type":"string","enum":["note","goal"],"description":"note 为普通备忘（默认），goal 为长期目标"},
                "content":{"type":["string","null"],"maxLength":20000,"description":"可选正文细节；省略或 null 表示只有标题"},
                "review_at":{"type":["string","null"],"format":"date-time","description":"未来的带时区 ISO 回顾时间；省略或 null 表示不设置回顾。不能仅将时间写入标题充当回顾提醒。"}},
                "required":["title"],"additionalProperties":false}}},
            {"type":"function","function":{"name":"memo_list",
             "description":"查询当前账号的真实备忘与长期目标；默认不含已归档，可按 kind 过滤；没有记录时返回空列表。",
             "parameters":{"type":"object","properties":{
                "kind":{"type":"string","enum":["note","goal"],"description":"可选，按类型过滤：note 备忘或 goal 长期目标"},
                "include_archived":{"type":"boolean","description":"可选，为 true 时同时返回已归档记录；默认只返回未归档"}},
                "additionalProperties":false}}},
            {"type":"function","function":{"name":"memo_update",
             "description":"更新用户明确指定的一条已有备忘的标题、正文或类型；目标缺失或有歧义时先询问，不得猜测 ID。",
             "parameters":{"type":"object","properties":{
                "memo_id":{"type":"string","format":"uuid","description":"从真实备忘查询结果取得的记录 ID"},
                "title":{"type":"string","minLength":1,"maxLength":2000,"description":"新标题；不修改则省略"},
                "kind":{"type":"string","enum":["note","goal"],"description":"新类型；不修改则省略"},
                "content":{"type":["string","null"],"maxLength":20000,"description":"新正文；null 清空；不修改则省略"}},
                "required":["memo_id"],"additionalProperties":false}}},
            {"type":"function","function":{"name":"memo_archive",
             "description":"归档或取消归档用户明确指定的一条已有备忘；归档会同时清除其回顾时间。目标缺失或有歧义时先询问，不得猜测 ID。",
             "parameters":{"type":"object","properties":{
                "memo_id":{"type":"string","format":"uuid","description":"从真实备忘查询结果取得的记录 ID"},
                "archived":{"type":"boolean","description":"true 归档（同时清除回顾时间），false 取消归档"}},
                "required":["memo_id","archived"],"additionalProperties":false}}},
            {"type":"function","function":{"name":"memo_review_set",
             "description":"设置、修改或取消已有备忘的回顾时间。先查询真实 ID 和当前 review_at；取消传 null，目标不明确先询问。",
             "parameters":{"type":"object","properties":{
                "memo_id":{"type":"string","format":"uuid","description":"从真实查询结果取得的已有备忘 ID"},
                "review_at":{"type":["string","null"],"format":"date-time","description":"未来的带时区 ISO 时间；null 取消回顾"},
                "expected_review_at":{"type":["string","null"],"format":"date-time","description":"真实查询结果中的当前 review_at，未设置为 null；不得猜测"}},
                "required":["memo_id","review_at","expected_review_at"],"additionalProperties":false}}}
        ]"#).unwrap();
        assert_eq!(json!(MemoPlugin::new().model_tools()), expected);
    }

    /// Every manifest tool's handler_key maps back to its business name, so
    /// the model-facing schema and the execution routing cannot drift apart.
    #[test]
    fn name_mapping_round_trips_every_manifest_tool() {
        let plugin = MemoPlugin::new();
        for tool in plugin.definitions() {
            let handler = tool["handler_key"].as_str().unwrap();
            let business = tool["name"].as_str().unwrap();
            assert_eq!(plugin.business_name(handler), Some(business));
        }
        assert_eq!(plugin.business_name("unknown_tool"), None);
    }
}
