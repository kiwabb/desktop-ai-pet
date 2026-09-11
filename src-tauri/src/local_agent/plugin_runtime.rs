//! Core plugin seam for local mode (mirrors `server/app/plugin_runtime.py`).
//!
//! The tool loop depends only on `ToolPlugin` / `PluginRegistry` — never on a
//! concrete capability domain. A plugin declares its tools/prompt fragments
//! (from its shared plugin.json manifest) and implements validate/execute;
//! the core owns the execute skeleton: idempotent start, business effect and
//! tool result in one transaction, and sanitized error reporting.
use super::store::{StartedTool, Store, StoreError};
use crate::agent_protocol::{Envelope, ToolCall};
use crate::llm::ModelToolCall;
use serde_json::Value;
use std::any::Any;
use std::collections::HashMap;

/// Raised when the model names a tool no registered plugin provides. Matches
/// each plugin manifest's validation_messages['unsupported_tool'].
pub const UNSUPPORTED_TOOL_MESSAGE: &str = "不支持该工具";

/// Capability plugin contract (mirrors the server `Plugin` protocol).
/// `validate` and `execute` are paired per plugin: the opaque validated
/// params flow only into the same plugin's `execute`.
pub trait ToolPlugin: Send + Sync {
    /// Manifest tool definitions (raw JSON array entries).
    fn definitions(&self) -> &'static [Value];
    /// OpenAI function format exposed to the model.
    fn model_tools(&self) -> Vec<Value>;
    /// Prompt fragments in the plugin's declared order.
    fn prompt_fragments(&self) -> Vec<&'static str>;
    /// Model (underscore) name -> business (dotted) name when this plugin owns it.
    fn business_name(&self, model_name: &str) -> Option<&'static str>;
    /// Validate model arguments for one business name; returns opaque params.
    fn validate(&self, business_name: &str, arguments: &Value) -> Result<Box<dyn Any>, String>;
    /// Business effect and tool result commit in one store transaction.
    fn execute(
        &self,
        store: &Store,
        run_id: &str,
        tool: &ToolCall,
        params: Box<dyn Any>,
    ) -> Result<(ToolCall, Envelope), StoreError>;
}

pub struct ExecutedTool {
    pub view: ToolCall,
    /// Ordered durable events (tool.started, then tool.finished) for projection.
    pub envelopes: Vec<Envelope>,
}

/// Business failures surface their fixed message; anything else is sanitized
/// (never leak provider/DB exception strings).
fn tool_error_message(error: &StoreError) -> String {
    match error {
        StoreError::Validation(_) | StoreError::NotFound(_) | StoreError::Conflict(_) => {
            error.message()
        }
        StoreError::Internal => "工具执行失败，未确认保存成功".into(),
    }
}

/// Ordered plugins; aggregates declarations and owns the execute skeleton.
pub struct PluginRegistry {
    plugins: Vec<Box<dyn ToolPlugin>>,
    model_tools: Vec<Value>,
    plugin_by_model: HashMap<String, usize>,
    business_by_model: HashMap<String, &'static str>,
}

impl PluginRegistry {
    pub fn new(plugins: Vec<Box<dyn ToolPlugin>>) -> Self {
        let mut model_tools = Vec::new();
        let mut plugin_by_model = HashMap::new();
        let mut business_by_model = HashMap::new();
        for (index, plugin) in plugins.iter().enumerate() {
            model_tools.extend(plugin.model_tools());
            for definition in plugin.definitions() {
                let model_name = definition["handler_key"]
                    .as_str()
                    .expect("plugin.json 工具缺少 handler_key")
                    .to_owned();
                let business = plugin
                    .business_name(&model_name)
                    .expect("插件名映射缺少 handler_key 对应项");
                business_by_model.insert(model_name.clone(), business);
                plugin_by_model.insert(model_name, index);
            }
        }
        Self {
            plugins,
            model_tools,
            plugin_by_model,
            business_by_model,
        }
    }

    /// Aggregated model tools in explicit registration order.
    pub fn model_tools(&self) -> &[Value] {
        &self.model_tools
    }

    /// Aggregated prompt fragments in explicit registration order.
    pub fn prompt_fragments(&self) -> Vec<&'static str> {
        self.plugins
            .iter()
            .flat_map(|plugin| plugin.prompt_fragments())
            .collect()
    }

    /// Start is idempotent, business and result commit together, and a
    /// repeated call returns its committed outcome without rewriting.
    pub fn execute(
        &self,
        store: &Store,
        run_id: &str,
        call: &ModelToolCall,
    ) -> Result<Option<ExecutedTool>, StoreError> {
        let business_name: &str = match self.business_by_model.get(call.name.as_str()) {
            Some(&business) => business,
            None => call.name.as_str(),
        };
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
        let outcome = match self.plugin_by_model.get(call.name.as_str()) {
            None => Err(StoreError::Validation(UNSUPPORTED_TOOL_MESSAGE.into())),
            Some(&index) => {
                let plugin = &self.plugins[index];
                plugin
                    .validate(business_name, &arguments)
                    .map_err(StoreError::Validation)
                    .and_then(|params| plugin.execute(store, run_id, &tool, params))
            }
        };
        let (view, finished) = match outcome {
            Ok(done) => done,
            Err(error) => store
                .fail_tool(run_id, &tool.id, &tool_error_message(&error))?
                .ok_or(StoreError::Internal)?,
        };
        envelopes.push(finished);
        Ok(Some(ExecutedTool { view, envelopes }))
    }
}

/// Built-in plugins in explicit registration order (no filesystem scan).
pub fn builtin_plugins() -> PluginRegistry {
    PluginRegistry::new(vec![Box::new(super::plugins::todo::TodoPlugin::new())])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_protocol::{RunStatus, ToolStatus};
    use crate::local_agent::store::Store;
    use serde_json::json;
    use std::sync::OnceLock;

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
        let plugins = builtin_plugins();
        let (_session, run) = running_run(&store);
        let created = plugins
            .execute(&store, &run, &call("todo_create", r#"{"title":" 喝水 "}"#))
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

        let listed = plugins
            .execute(&store, &run, &call("todo_list", "{}"))
            .unwrap()
            .unwrap();
        assert_eq!(listed.view.result.as_ref().unwrap()["items"].as_array().unwrap().len(), 1);

        let reminder = format!(
            r#"{{"todo_id":"{todo_id}","remind_at":"{}","expected_remind_at":null}}"#,
            "2036-09-09T15:15:00+08:00"
        );
        let set = plugins
            .execute(&store, &run, &call("todo_reminder_set", &reminder))
            .unwrap()
            .unwrap();
        assert_eq!(set.view.status, ToolStatus::Completed);
        assert_eq!(
            set.view.result.as_ref().unwrap()["item"]["remind_at"],
            json!("2036-09-09T07:15:00.000000Z")
        );

        let completed = plugins
            .execute(
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
        let plugins = builtin_plugins();
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
            let executed = plugins.execute(&store, &run, &call(name, arguments)).unwrap().unwrap();
            assert_eq!(executed.view.status, ToolStatus::Failed, "{name}");
            assert_eq!(executed.view.error.as_deref(), Some(message), "{name}");
        }
        let todos = super::super::plugins::todo::TodoStore::new(&store);
        assert!(todos.list_todos().unwrap().is_empty());
        let snapshot = store.snapshot(&_session).unwrap();
        assert!(snapshot
            .runs
            .iter()
            .all(|run| run.status == RunStatus::Running));
    }

    #[test]
    fn business_conflicts_become_failed_tool_results() {
        let store = Store::open_memory();
        let plugins = builtin_plugins();
        let (_session, run) = running_run(&store);
        let missing = format!(
            r#"{{"todo_id":"{}","remind_at":null,"expected_remind_at":null}}"#,
            uuid::Uuid::new_v4()
        );
        let executed = plugins
            .execute(&store, &run, &call("todo_reminder_set", &missing))
            .unwrap()
            .unwrap();
        assert_eq!(executed.view.status, ToolStatus::Failed);
        assert_eq!(executed.view.error.as_deref(), Some("未找到待办，请刷新核对"));
        let created = plugins
            .execute(&store, &run, &call("todo_create", r#"{"title":"吃药"}"#))
            .unwrap()
            .unwrap();
        let todo_id = created.view.result.as_ref().unwrap()["item"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let stale = format!(
            r#"{{"todo_id":"{todo_id}","remind_at":"2036-09-09T15:15:00+08:00","expected_remind_at":"2036-01-01T00:00:00+08:00"}}"#
        );
        let executed = plugins
            .execute(&store, &run, &call("todo_reminder_set", &stale))
            .unwrap()
            .unwrap();
        assert_eq!(executed.view.error.as_deref(), Some("提醒已被修改，请刷新后重试"));
        let past = format!(
            r#"{{"todo_id":"{todo_id}","remind_at":"2020-01-01T00:00:00+08:00","expected_remind_at":null}}"#
        );
        let executed = plugins
            .execute(&store, &run, &call("todo_reminder_set", &past))
            .unwrap()
            .unwrap();
        assert_eq!(executed.view.error.as_deref(), Some("提醒时间必须晚于当前时间"));
        // A repeated call id returns the committed outcome without rewriting.
        let first = plugins
            .execute(
                &store,
                &run,
                &call_with_id("call_repeat", "todo_create", r#"{"title":"吃药"}"#),
            )
            .unwrap()
            .unwrap();
        let repeated = plugins
            .execute(
                &store,
                &run,
                &call_with_id("call_repeat", "todo_create", r#"{"title":"吃药"}"#),
            )
            .unwrap()
            .unwrap();
        assert!(repeated.envelopes.is_empty());
        assert_eq!(repeated.view.id, first.view.id);
        let todos = super::super::plugins::todo::TodoStore::new(&store);
        assert_eq!(todos.list_todos().unwrap().len(), 2);
    }

    /// AC1: a declaration-only plugin with a trivial handler loads and
    /// executes through the skeleton without any core change.
    struct DummyPlugin;

    impl ToolPlugin for DummyPlugin {
        fn definitions(&self) -> &'static [Value] {
            static DEFINITIONS: OnceLock<Vec<Value>> = OnceLock::new();
            DEFINITIONS.get_or_init(|| {
                vec![json!({"name": "dummy.ping", "version": "1", "description": "回显一条消息。",
                            "input_schema": {"type": "object", "properties": {}, "additionalProperties": false},
                            "permission": "dummy.read", "execution_location": "server",
                            "handler_key": "dummy_ping"})]
            })
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
            vec![]
        }

        fn business_name(&self, model_name: &str) -> Option<&'static str> {
            (model_name == "dummy_ping").then_some("dummy.ping")
        }

        fn validate(&self, _business_name: &str, arguments: &Value) -> Result<Box<dyn Any>, String> {
            Ok(Box::new(arguments.clone()))
        }

        fn execute(
            &self,
            store: &Store,
            run_id: &str,
            tool: &ToolCall,
            _params: Box<dyn Any>,
        ) -> Result<(ToolCall, Envelope), StoreError> {
            store.tool_outcome(run_id, &tool.id, |_tx| Ok(json!({"pong": true})))
        }
    }

    #[test]
    fn dummy_plugin_loads_and_executes_without_core_changes() {
        let store = Store::open_memory();
        let plugins = PluginRegistry::new(vec![
            Box::new(super::super::plugins::todo::TodoPlugin::new()),
            Box::new(DummyPlugin),
        ]);
        let names: Vec<&str> = plugins
            .model_tools()
            .iter()
            .map(|tool| tool["function"]["name"].as_str().unwrap())
            .collect();
        assert_eq!(
            names,
            ["todo_create", "todo_list", "todo_complete", "todo_reminder_set", "dummy_ping"]
        );

        let (_session, run) = running_run(&store);
        let executed = plugins
            .execute(&store, &run, &call_with_id("call_ping", "dummy_ping", "{}"))
            .unwrap()
            .unwrap();
        assert_eq!(executed.view.status, ToolStatus::Completed);
        assert_eq!(executed.view.name, "dummy.ping");
        assert_eq!(executed.view.result.as_ref().unwrap(), &json!({"pong": true}));
        // The skeleton stays idempotent for any plugin's calls.
        let repeated = plugins
            .execute(&store, &run, &call_with_id("call_ping", "dummy_ping", "{}"))
            .unwrap()
            .unwrap();
        assert_eq!(repeated.view.id, executed.view.id);
        assert!(repeated.envelopes.is_empty());
    }

    #[test]
    fn prompt_fragments_follow_registration_order() {
        struct FragmentPlugin(Vec<&'static str>);

        impl ToolPlugin for FragmentPlugin {
            fn definitions(&self) -> &'static [Value] {
                &[]
            }
            fn model_tools(&self) -> Vec<Value> {
                vec![]
            }
            fn prompt_fragments(&self) -> Vec<&'static str> {
                self.0.clone()
            }
            fn business_name(&self, _model_name: &str) -> Option<&'static str> {
                None
            }
            fn validate(&self, _business_name: &str, _arguments: &Value) -> Result<Box<dyn Any>, String> {
                Ok(Box::new(()))
            }
            fn execute(
                &self,
                _store: &Store,
                _run_id: &str,
                _tool: &ToolCall,
                _params: Box<dyn Any>,
            ) -> Result<(ToolCall, Envelope), StoreError> {
                unreachable!()
            }
        }

        let plugins = PluginRegistry::new(vec![
            Box::new(FragmentPlugin(vec!["a1", "a2"])),
            Box::new(FragmentPlugin(vec!["b1"])),
        ]);
        assert_eq!(plugins.prompt_fragments(), ["a1", "a2", "b1"]);
        // Registration order drives aggregation, not coincidence.
        let reversed = PluginRegistry::new(vec![
            Box::new(FragmentPlugin(vec!["b1"])),
            Box::new(FragmentPlugin(vec!["a1", "a2"])),
        ]);
        assert_eq!(reversed.prompt_fragments(), ["b1", "a1", "a2"]);
    }
}
