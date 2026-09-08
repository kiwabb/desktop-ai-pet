"""Isolated scripted models and store doubles, never real model/DB evidence."""
import asyncio
import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from langchain_core.messages import AIMessageChunk

from app.tracing import TraceWriter, message_snapshot, redact_trace, trace_body
import test_runtime_graph as runtime_graph
from test_runtime_graph import tool_chunk


class TracingRuntimeTests(unittest.IsolatedAsyncioTestCase):
    def service(self, turns):
        svc, run = runtime_graph.GraphTests().service(turns)
        for name in ('start_model_trace', 'update_model_trace', 'finish_model_trace',
                     'link_tool_trace', 'finalize_run_trace', 'mark_trace_gap'):
            setattr(svc.store, name, AsyncMock())
        svc.tools.execute.return_value['id'] = 'tool-row-id'
        return svc, run

    async def drain(self, svc):
        if svc._trace_writer and svc._trace_writer.task:
            await svc._trace_writer.task

    async def test_trace_lock_does_not_delay_model_or_business_completion(self):
        svc, run = self.service([[AIMessageChunk(content='真实路径的隔离测试')]])
        async def blocked(*args, **kwargs):
            await asyncio.Event().wait()
        svc.store.start_model_trace.side_effect = blocked
        svc._trace_writer = TraceWriter(svc.store, timeout=.1)
        started = time.monotonic()
        await svc._execute(run, 'owner')
        self.assertLess(time.monotonic() - started, .08)
        self.assertEqual(svc.store.finish_run.await_args.args[2], 'completed')
        await self.drain(svc)
        self.assertEqual(svc.store.finalize_run_trace.await_args.kwargs['gap_reason'], '观测队列或写入发生缺口')
        svc.store.mark_trace_gap.assert_awaited()

    async def test_timeout_preserves_partial_output_metrics_and_terminal_trace(self):
        svc, run = self.service([])
        svc.settings.model_timeout_seconds = .035
        class PendingModel:
            async def astream(self, messages):
                yield AIMessageChunk(content='已收到的正文')
                await asyncio.Event().wait()
        svc.model = PendingModel()
        await svc._execute(run, 'owner')
        await self.drain(svc)
        self.assertEqual(svc.store.finish_run.await_args.args[2], 'failed')
        kwargs = svc.store.finish_model_trace.await_args.kwargs
        self.assertEqual(kwargs['status'], 'interrupted')
        self.assertEqual(kwargs['response'][0]['visible_text'], '已收到的正文')
        self.assertFalse(kwargs['response'][0]['partial'])
        self.assertIsNotNone(kwargs['first_token_ms'])
        self.assertIsNotNone(kwargs['first_visible_text_ms'])
        self.assertGreaterEqual(kwargs['duration_ms'], kwargs['first_visible_text_ms'])
        self.assertEqual(svc.store.finalize_run_trace.await_args.args[1], 1)

    async def test_provider_failure_preserves_output_and_never_echoes_exception(self):
        svc, run = self.service([[AIMessageChunk(content='开始回复'), RuntimeError('Bearer secret-provider-body')]])
        await svc._execute(run, 'owner')
        await self.drain(svc)
        kwargs = svc.store.finish_model_trace.await_args.kwargs
        self.assertEqual(kwargs['status'], 'failed')
        self.assertEqual(kwargs['response'][0]['visible_text'], '开始回复')
        self.assertNotIn('secret-provider-body', str(kwargs))

    async def test_complete_tool_protocol_and_effective_config_are_captured(self):
        svc, run = self.service([[tool_chunk()], [AIMessageChunk(content='完成', usage_metadata={
            'input_tokens': 12, 'output_tokens': 3, 'total_tokens': 15})]])
        await svc._execute(run, 'owner')
        await self.drain(svc)
        request = svc.store.start_model_trace.await_args_list[1].args[3][0]
        ai, tool = request['messages'][-2:]
        self.assertEqual(ai['tool_calls'][0]['id'], 'call_unit_only')
        self.assertEqual(ai['tool_calls'][0]['args'], {})
        self.assertEqual(tool['tool_call_id'], ai['tool_calls'][0]['id'])
        self.assertEqual((tool['name'], tool['status']), ('todo_list', 'success'))
        self.assertTrue(request['effective_config']['stream_usage'])
        self.assertEqual(request['effective_config']['timeout_seconds'], svc.settings.model_timeout_seconds)
        self.assertNotIn(svc.settings.model_api_key, str(request))
        result = svc.store.finish_model_trace.await_args_list[0].kwargs['response'][0]
        self.assertEqual(result['tool_calls'][0]['id'], 'call_unit_only')
        self.assertIsNone(svc.store.finish_model_trace.await_args_list[0].kwargs['first_visible_text_ms'])
        self.assertEqual(svc.store.finish_model_trace.await_args.kwargs['usage']['total_tokens'], 15)
        svc.store.link_tool_trace.assert_awaited_once()

    async def test_visible_latency_excludes_initial_tool_or_hidden_content(self):
        svc, run = self.service([])
        class Model:
            async def astream(self, messages):
                yield AIMessageChunk(content=[{'type': 'reasoning', 'text': 'internal'}])
                await asyncio.sleep(.015)
                yield AIMessageChunk(content=[{'type': 'text', 'text': 'visible'}])
        svc.model = Model()
        await svc._execute(run, 'owner')
        await self.drain(svc)
        kwargs = svc.store.finish_model_trace.await_args.kwargs
        self.assertGreater(kwargs['first_visible_text_ms'], kwargs['first_token_ms'])

    async def test_repeated_cumulative_provider_usage_is_not_summed(self):
        svc, run = self.service([[
            AIMessageChunk(content='a', usage_metadata={'input_tokens': 5, 'output_tokens': 1, 'total_tokens': 6}),
            AIMessageChunk(content='b', usage_metadata={'input_tokens': 5, 'output_tokens': 2, 'total_tokens': 7}),
            AIMessageChunk(content=''),
        ]])
        await svc._execute(run, 'owner')
        await self.drain(svc)
        recorded = svc.store.finish_model_trace.await_args.kwargs
        self.assertEqual(recorded['usage'], {'input_tokens': 5, 'output_tokens': 2, 'total_tokens': 7})
        self.assertEqual(recorded['usage_source'], 'provider')

    async def test_bound_version_timeout_is_used_once_for_entire_graph(self):
        svc, run = self.service([])
        svc.settings.model_timeout_seconds = .01
        run['model_config_version_id'] = 'version'
        config = {'timeout_seconds': .1}
        svc.model_configs.resolved = AsyncMock(return_value=config)
        async def graph(run_arg, owner, effective):
            self.assertIs(effective, config)
            await asyncio.sleep(.03)
        svc._run_graph = graph
        await svc._execute(run, 'owner')
        await self.drain(svc)
        svc.model_configs.resolved.assert_awaited_once_with('version')
        self.assertEqual(svc.store.finish_run.await_args.args[2], 'completed')

    async def test_previews_are_throttled_and_terminal_supersedes_them(self):
        svc, run = self.service([[AIMessageChunk(content='a') for _ in range(50)]])
        await svc._execute(run, 'owner')
        await self.drain(svc)
        self.assertLessEqual(svc.store.update_model_trace.await_count, 2)
        self.assertTrue(svc.store.update_model_trace.await_args.kwargs['response'][0]['partial'])
        terminal = svc.store.finish_model_trace.await_args.kwargs['response'][0]
        self.assertFalse(terminal['partial'])
        self.assertEqual(terminal['visible_text'], 'a' * 50)

    async def test_shutdown_cancellation_seals_trace_and_bounded_writer_closes(self):
        svc, run = self.service([])
        entered = asyncio.Event()
        class Model:
            async def astream(self, messages):
                yield AIMessageChunk(content='partial')
                entered.set()
                await asyncio.Event().wait()
        svc.model = Model()
        task = asyncio.create_task(svc._execute(run, 'owner'))
        await entered.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        await svc._trace_writer.close()
        self.assertTrue(svc._trace_writer.task.done())
        self.assertEqual(svc.store.finish_model_trace.await_args.kwargs['status'], 'interrupted')
        self.assertEqual(svc.store.finish_run.await_args.args[2], 'interrupted')


class WriterTests(unittest.IsolatedAsyncioTestCase):
    async def test_queue_overflow_and_failed_gap_write_cannot_finalize_complete(self):
        store = SimpleNamespace(start_model_trace=AsyncMock(), finalize_run_trace=AsyncMock(),
                                mark_trace_gap=AsyncMock(side_effect=RuntimeError('offline')))
        run = {'id': 'run'}
        writer = TraceWriter(store, capacity=1)
        writer.submit(run, 'start_model_trace', run)
        writer.submit(run, 'finalize_run_trace', run, 1)
        await writer.task
        store.start_model_trace.assert_not_awaited()
        self.assertIsNotNone(store.finalize_run_trace.await_args.kwargs['gap_reason'])
        self.assertTrue(writer.queue.empty())

    async def test_hanging_write_shutdown_has_no_unowned_background_task(self):
        async def hang(*args):
            await asyncio.Event().wait()
        store = SimpleNamespace(start_model_trace=hang, mark_trace_gap=AsyncMock())
        writer = TraceWriter(store, timeout=20)
        writer.submit({'id': 'run'}, 'start_model_trace')
        started = time.monotonic()
        await writer.close()
        self.assertLess(time.monotonic()-started, 1.2)
        self.assertTrue(writer.task.done())


class RedactionTests(unittest.TestCase):
    def test_nested_and_text_credentials_are_redacted_without_mutating_input(self):
        source = {'authorization': 'Bearer abc', 'nested': {'device_token': 'device-raw'},
                  'tool': '{"api_key":"abc","title":"保持原文"}',
                  'text': 'Authorization: Bearer raw-token api_key=secret-value sk-abcdefghijkl actual-key'}
        result = redact_trace(source, ('actual-key',))
        self.assertEqual(source['authorization'], 'Bearer abc')
        for credential in ('abc', 'device-raw', 'raw-token', 'secret-value', 'sk-abcdefghijkl', 'actual-key'):
            self.assertNotIn(credential, str(result))
        self.assertIn('保持原文', result['tool'])

    def test_payload_cap_preserves_unicode_and_reports_redacted_byte_count(self):
        body, truncated, original = trace_body({'content': '中' * 100, 'api_key': 'abcdef'}, limit=100)
        self.assertTrue(truncated)
        self.assertGreater(original, 100)
        self.assertNotIn('abcdef', str(body))
        self.assertNotIn('\ufffd', body['truncated_text'])


class TraceStoreTests(unittest.IsolatedAsyncioTestCase):
    async def test_retention_preserves_expiry_and_uses_one_terminal_metadata_batch(self):
        # SQL/adapter contract, not a live retention or PostgreSQL test.
        from contextlib import asynccontextmanager
        from uuid import uuid4
        from app.runtime_store import RuntimeStore
        store = RuntimeStore(SimpleNamespace())
        store.reconcile_traces = AsyncMock()
        ids = [uuid4(), uuid4()]
        cursor = SimpleNamespace(fetchall=AsyncMock(return_value=[{'id': value} for value in ids]))
        conn = SimpleNamespace(execute=AsyncMock(return_value=cursor))
        @asynccontextmanager
        async def connection():
            yield conn
        store._trace_connection = connection
        await store.cleanup_observability(metadata_days=90)
        queries = conn.execute.await_args_list
        expire_sql = queries[0].args[0]
        self.assertIn("SET body='{}'::jsonb", expire_sql)
        self.assertNotIn('DELETE', expire_sql)
        self.assertIn("r.status NOT IN ('queued','running')", expire_sql)
        select_sql, select_values = queries[1].args
        self.assertIn('FOR UPDATE OF c SKIP LOCKED', select_sql)
        self.assertIn("r.status NOT IN ('queued','running')", select_sql)
        self.assertEqual(select_values, (90,))
        deletes = [call for call in queries if 'ANY(%s::uuid[])' in call.args[0]]
        self.assertEqual(len(deletes), 3)
        self.assertTrue(all(call.args[1] == (ids,) for call in deletes))
        self.assertTrue(all('DELETE FROM agent_' not in call.args[0] for call in queries))
        for call in queries:
            self.assertEqual(call.args[0].count('%s'), len(call.args[1]) if len(call.args) > 1 else 0)

    async def test_late_preview_and_finish_do_not_replace_a_recovered_terminal(self):
        from contextlib import asynccontextmanager
        from datetime import datetime, timezone
        from app.runtime_store import RuntimeStore
        store = RuntimeStore(SimpleNamespace())
        conn = SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(rowcount=0)))
        @asynccontextmanager
        async def connection():
            yield conn
        store._trace_connection = connection
        store._response_payload = AsyncMock()
        await store.update_model_trace({'id': 'run'}, 'call', response={'partial': True})
        await store.finish_model_trace({'id': 'run'}, 'call', datetime.now(timezone.utc),
                                       status='succeeded', response={'partial': False})
        store._response_payload.assert_not_awaited()
        # Both writes are fenced by the stored model-call terminal state.
        updates = [call.args[0] for call in conn.execute.await_args_list if 'UPDATE model_call_traces' in call.args[0]]
        self.assertTrue(all("AND status='running'" in sql for sql in updates))

    async def test_partial_payload_update_has_stable_id_and_fenced_metadata(self):
        # SQL contract check only; root's PostgreSQL review is separate evidence.
        from contextlib import asynccontextmanager
        from app.runtime_store import RuntimeStore
        store = RuntimeStore(SimpleNamespace())
        conn = SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(rowcount=1)))
        @asynccontextmanager
        async def connection():
            yield conn
        store._trace_connection = connection
        await store.update_model_trace({'id': 'run'}, 'call', response={'partial': True, 'visible_text': 'a'})
        await store.update_model_trace({'id': 'run'}, 'call', response={'partial': True, 'visible_text': 'ab'})
        inserts = [call.args[0] for call in conn.execute.await_args_list if 'INSERT INTO trace_payloads' in call.args[0]]
        self.assertEqual(len(inserts), 2)
        self.assertTrue(all('ON CONFLICT (model_call_id,kind) DO UPDATE SET body=' in sql for sql in inserts))
