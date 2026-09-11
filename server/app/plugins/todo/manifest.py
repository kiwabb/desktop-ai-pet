"""Shared manifest loader for the todo plugin.

plugins/todo/plugin.json is the single source of truth for tool definitions,
name mapping, prompt fragments and validation messages; the Rust local mode
embeds the same file at compile time
(src-tauri/src/local_agent/plugins/todo/manifest.rs).
"""
import json
from pathlib import Path

PLUGIN_PATH = Path(__file__).resolve().parents[4] / 'plugins' / 'todo' / 'plugin.json'
PLUGIN_MANIFEST = json.loads(PLUGIN_PATH.read_text(encoding='utf-8'))

TOOL_DEFINITIONS = PLUGIN_MANIFEST['tools']
MODEL_TO_BUSINESS = dict(PLUGIN_MANIFEST['name_mapping'])
TOOL_HANDLERS = {business: model for model, business in MODEL_TO_BUSINESS.items()}
# Ordered prompt fragments; the declaration order in the manifest is the order
# the core layout fills its fragment slots.
TODO_PROMPT_FRAGMENTS = [fragment['text'] for fragment in PLUGIN_MANIFEST['prompt_fragments']]
VALIDATION_MESSAGES = PLUGIN_MANIFEST['validation_messages']
MODEL_TOOLS = [
    {'type': 'function', 'function': {'name': definition['handler_key'],
                                    'description': definition['description'],
                                    'parameters': definition['input_schema']}}
    for definition in TOOL_DEFINITIONS
]
