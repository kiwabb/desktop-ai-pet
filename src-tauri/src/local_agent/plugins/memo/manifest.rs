//! Shared memo plugin manifest: `plugins/memo/plugin.json` is the single
//! source of truth for tool definitions, the model↔business name mapping,
//! prompt fragments and validation messages, mirrored by
//! `server/app/plugins/memo/manifest.py`. Embedded at compile time so local
//! mode has no runtime file dependency; an invalid manifest fails fast at
//! first use.
use serde_json::Value;
use std::sync::OnceLock;

pub const PLUGIN_JSON: &str = include_str!("../../../../../plugins/memo/plugin.json");

/// Parsed manifest; the same file the Python server loads at runtime.
pub fn manifest() -> &'static Value {
    static MANIFEST: OnceLock<Value> = OnceLock::new();
    MANIFEST.get_or_init(|| {
        serde_json::from_str(PLUGIN_JSON).expect("plugins/memo/plugin.json 必须为有效 JSON")
    })
}

/// Model (underscore) name -> business (dotted) name, from the manifest
/// `name_mapping` (inverse of each tool's handler_key).
pub fn model_to_business(model_name: &str) -> Option<&'static str> {
    manifest()["name_mapping"].get(model_name)?.as_str()
}

/// Memo prompt fragments in manifest declaration order; the core layout fills
/// its fragment slots in this order (tool rules before review/time rules).
pub fn prompt_fragments() -> Vec<&'static str> {
    manifest()["prompt_fragments"]
        .as_array()
        .expect("plugin.json prompt_fragments 必须为数组")
        .iter()
        .map(|fragment| {
            fragment["text"]
                .as_str()
                .expect("plugin.json 提示词片段缺少 text")
        })
        .collect()
}

/// Validation error message by key; the same text the Python validator raises.
pub fn validation_message(key: &str) -> &'static str {
    manifest()["validation_messages"][key]
        .as_str()
        .expect("plugin.json 缺少参数校验错误文案")
}
