"""Plugin seam tests (PRD AC1): a new plugin with only declarations plus a
trivial handler loads into the server loop without any core change."""
import unittest
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

from app.plugin_runtime import UNSUPPORTED_TOOL_MESSAGE, PluginRegistry, aggregate_prompt_fragments
from app.plugins.todo import TodoPlugin
from app.plugins.todo.manifest import VALIDATION_MESSAGES
from app.registry import Registry


class DummyPlugin:
    """Declaration-only plugin: no core file knows it exists."""

    id = 'dummy'
    definitions = [dict(name='dummy.ping', version='1', description='回显一条消息。',
                        input_schema={'type': 'object', 'properties': {}, 'additionalProperties': False},
                        permission='dummy.read', execution_location='server', handler_key='dummy_ping')]
    model_tools = [{'type': 'function', 'function': {'name': 'dummy_ping', 'description': '回显一条消息。',
                                                      'parameters': {'type': 'object', 'properties': {},
                                                                     'additionalProperties': False}}}]
    validation_messages = {'unsupported_tool': '不支持该工具'}

    def prompt_fragments(self):
        return []

    def validate(self, handler, arguments):
        return dict(arguments)

    async def execute_in_tx(self, conn, current, tool, handler, params):
        return {'pong': True}


class SkeletonStoreDouble:
    """Minimal core skeleton surface: idempotent start + transactional finish."""

    def __init__(self):
        self.tool = None
        self.finishes = []

    async def start_tool(self, run, owner, call_id, name, arguments):
        if self.tool is None:
            self.tool = dict(id=str(uuid4()), name=name, run_id=run['id'], status='running',
                             result=None, error=None)
        return dict(self.tool)

    @asynccontextmanager
    async def executing(self, run, owner):
        yield SimpleNamespace(), run

    async def finish_tool(self, conn, run, tool_id, result=None, error=None):
        self.tool.update(status='failed' if error else 'completed', result=result, error=error)
        self.finishes.append(dict(self.tool))
        return dict(self.tool)


class PluginSeamTests(unittest.IsolatedAsyncioTestCase):
    def registry(self, plugins):
        store = SkeletonStoreDouble()
        db_registry = SimpleNamespace(resolve_server=AsyncMock(side_effect=lambda name, handlers: handlers[name]))
        return store, db_registry, PluginRegistry(store, db_registry, plugins)

    async def test_dummy_plugin_loads_and_executes_without_core_changes(self):
        store, db_registry, plugins = self.registry([TodoPlugin(), DummyPlugin()])
        names = [tool['function']['name'] for tool in plugins.model_tools]
        self.assertEqual(names, ['todo_create', 'todo_list', 'todo_complete', 'todo_reminder_set', 'dummy_ping'])
        self.assertEqual(plugins.handlers['dummy.ping'], 'dummy_ping')

        run = dict(id=str(uuid4()), session_id=str(uuid4()), account_id=str(uuid4()))
        result = await plugins.execute(run, 'owner', {'id': 'call', 'name': 'dummy_ping', 'args': {}})
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['result'], {'pong': True})
        db_registry.resolve_server.assert_awaited_once_with('dummy.ping', plugins.handlers)
        # The skeleton stays idempotent for any plugin's calls.
        repeat = await plugins.execute(run, 'owner', {'id': 'call', 'name': 'dummy_ping', 'args': {}})
        self.assertEqual(repeat, result)
        self.assertEqual(len(store.finishes), 1)

    async def test_unknown_tool_fails_with_the_shared_message(self):
        store, db_registry, plugins = self.registry([TodoPlugin()])
        run = dict(id=str(uuid4()), session_id=str(uuid4()), account_id=str(uuid4()))
        result = await plugins.execute(run, 'owner', {'id': 'call', 'name': 'unknown_tool', 'args': {}})
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['error'], '不支持该工具')
        # The core message and the plugin manifest's copy must not drift.
        self.assertEqual(UNSUPPORTED_TOOL_MESSAGE, VALIDATION_MESSAGES['unsupported_tool'])

    async def test_register_aggregates_all_plugin_definitions(self):
        conn = SimpleNamespace(execute=AsyncMock())

        @asynccontextmanager
        async def transaction():
            yield

        @asynccontextmanager
        async def connection():
            yield conn

        conn.transaction = transaction
        db = SimpleNamespace(pool=SimpleNamespace(connection=connection))
        await Registry(db).register_server_tools([TodoPlugin(), DummyPlugin()])
        instances = [call.args[1] for call in conn.execute.await_args_list
                     if 'INSERT INTO tool_instances' in call.args[0]]
        self.assertIn(('server:dummy.ping', 'dummy.ping', '1', 'dummy_ping'), instances)
        self.assertEqual(len(instances), 5)

    def test_prompt_fragments_follow_registration_and_declaration_order(self):
        class Fragments:
            definitions = []
            model_tools = []
            validation_messages = {}

            def __init__(self, fragments):
                self._fragments = fragments

            def prompt_fragments(self):
                return list(self._fragments)

        plugins = [Fragments(['a1', 'a2']), Fragments(['b1'])]
        self.assertEqual(aggregate_prompt_fragments(plugins), ['a1', 'a2', 'b1'])
        # Registration order drives aggregation, not coincidence.
        self.assertEqual(aggregate_prompt_fragments(list(reversed(plugins))), ['b1', 'a1', 'a2'])


if __name__ == '__main__':
    unittest.main()
