"""Core plugin seam.

The agent loop, gateway and registry depend only on the Plugin protocol and
PluginRegistry — never on a concrete capability domain. A plugin declares its
tools/prompt fragments/messages (from a shared plugin.json manifest) and
implements validate/execute_in_tx; the core owns the execute skeleton:
idempotent start, business effect and tool result in one transaction, and
sanitized error reporting.
"""
from __future__ import annotations

from typing import Protocol

from app.contracts import ReminderConflict
from app.runtime_store import LeaseLost

# Raised when the model names a tool no registered plugin provides. Matches
# each plugin manifest's validation_messages['unsupported_tool'].
UNSUPPORTED_TOOL_MESSAGE = '不支持该工具'


class Plugin(Protocol):
    """Capability plugin contract (mirrors the Rust ToolPlugin trait)."""

    id: str
    definitions: list[dict]  # manifest tool definitions (name/version/description/input_schema/permission/execution_location/handler_key)
    model_tools: list[dict]  # OpenAI function format exposed to the model
    validation_messages: dict[str, str]

    def prompt_fragments(self) -> list[str]:
        """Prompt fragments in the plugin's declared order."""
        ...

    def validate(self, handler, arguments) -> dict:
        """Validate model arguments for one handler; returns typed params."""
        ...

    async def execute_in_tx(self, conn, current, tool, handler, params) -> dict:
        """Business effects inside the core's transaction; the returned dict
        becomes the tool result committed by the core skeleton."""
        ...


def builtin_plugins(db=None) -> list:
    """Built-in plugins in explicit registration order (no filesystem scan)."""
    from app.plugins.todo import TodoPlugin
    return [TodoPlugin(db)]


def aggregate_prompt_fragments(plugins) -> list:
    """Prompt fragments in plugin registration order; each plugin's internal
    order comes from its manifest declaration order."""
    return [fragment for plugin in plugins for fragment in plugin.prompt_fragments()]


class PluginRegistry:
    """Ordered plugins; aggregates declarations and routes tool execution."""

    def __init__(self, store, registry, plugins):
        self.store, self.registry = store, registry
        self.plugins = list(plugins)
        self.definitions = [definition for plugin in self.plugins for definition in plugin.definitions]
        self.model_tools = [tool for plugin in self.plugins for tool in plugin.model_tools]
        self.handlers = {}
        self._business_by_model = {}
        self._plugin_by_model = {}
        for plugin in self.plugins:
            for definition in plugin.definitions:
                model_name = definition['handler_key']
                self._business_by_model[model_name] = definition['name']
                self.handlers[definition['name']] = model_name
                self._plugin_by_model[model_name] = plugin

    def store_for(self, plugin_id):
        """The plugin's domain store, for core-mounted direct endpoints."""
        for plugin in self.plugins:
            if plugin.id == plugin_id:
                return getattr(plugin, 'store', None)
        return None

    async def execute(self, run, owner, call):
        """Start is idempotent, business and result commit together, and a
        repeated call returns its committed outcome without rewriting."""
        model_name = call.get('name', '')
        business_name = self._business_by_model.get(model_name, model_name)
        arguments = call.get('args', {})
        tool = await self.store.start_tool(run, owner, call.get('id'), business_name, arguments)
        if tool['status'] in ('completed', 'failed'):
            return tool  # A repeated graph/tool call must not repeat a write.
        try:
            plugin = self._plugin_by_model.get(model_name)
            if plugin is None:
                raise ValueError(UNSUPPORTED_TOOL_MESSAGE)
            # The database registry must actually resolve to a supported local
            # implementation on every invocation, not just advertise a catalog.
            handler = await self.registry.resolve_server(business_name, self.handlers)
            if handler != self.handlers[business_name]:
                raise ValueError('工具注册与可执行实现不匹配')
            params = plugin.validate(handler, arguments)
            async with self.store.executing(run, owner) as (conn, current):
                result = await plugin.execute_in_tx(conn, current, tool, handler, params)
                return await self.store.finish_tool(conn, current, tool['id'], result=result)
        except LeaseLost:
            raise
        except Exception as exc:
            # Never surface provider/DB exception strings (they can contain
            # credentials or SQL). Validation errors are our own fixed messages.
            error = str(exc) if isinstance(exc, (ValueError, LookupError, ReminderConflict)) else '工具执行失败，未确认保存成功'
            async with self.store.executing(run, owner) as (conn, current):
                return await self.store.finish_tool(conn, current, tool['id'], error=error)
