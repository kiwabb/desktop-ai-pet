"""Isolated unit tests: scripted model chunks, in-memory checkpoint, mocked store.

These exercise the real LangGraph execution code, NOT a real provider or database.
No synthetic model mode is exposed by the product server.
"""
import asyncio
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

from langchain_core.messages import AIMessageChunk
from langgraph.checkpoint.memory import InMemorySaver

from app.agent_service import AgentService, StepLimit, execution_error, visible_text, model_system_prompt


class ScriptedModel:
    def __init__(self, turns):
        self.turns = iter(turns)
        self.inputs = []

    async def astream(self, messages):
        self.inputs.append(messages)
        turn = next(self.turns)
        for chunk in turn:
            if isinstance(chunk, Exception):
                raise chunk
            yield chunk


def tool_chunk():
    return AIMessageChunk(content='', tool_call_chunks=[
        {'name': 'todo_list', 'args': '{}', 'id': 'call_unit_only', 'index': 0},
    ])


class GraphTests(unittest.IsolatedAsyncioTestCase):
    def service(self, turns, max_steps=4):
        settings = SimpleNamespace(model_base_url='https://unit.invalid', model_name='unit-only',
                                   model_api_key='not-a-real-credential', max_agent_steps=max_steps,
                                   worker_concurrency=2, model_timeout_seconds=3, default_timezone='Asia/Shanghai')
        coordination = SimpleNamespace(publish_session=AsyncMock())
        svc = AgentService(SimpleNamespace(), settings, coordination)
        svc.model = ScriptedModel(turns)
        svc.checkpointer = InMemorySaver()
        svc.store = SimpleNamespace(history=AsyncMock(return_value=([], '[]')),
                                    append_delta=AsyncMock(), finish_run=AsyncMock(),
                                    heartbeat=AsyncMock(), LEASE_SECONDS=30)
        svc.plugins = SimpleNamespace(execute=AsyncMock(return_value={
            'status': 'completed', 'result': {'items': []}, 'error': None,
        }), model_tools=[])
        run = dict(id=str(uuid4()), session_id=str(uuid4()), account_id=str(uuid4()),
                   input_text='查询待办', ordinal=1, created_at=datetime.now(timezone.utc))
        return svc, run

    async def test_streamed_tool_loop_and_checkpoint(self):
        svc, run = self.service([[tool_chunk()], [AIMessageChunk(content='当前'), AIMessageChunk(content='没有待办。')]])
        await svc._run_graph(run, 'owner')
        self.assertEqual(svc.plugins.execute.await_count, 1)
        self.assertEqual([call.args[2] for call in svc.store.append_delta.await_args_list], ['当前', '没有待办。'])
        second_input = svc.model.inputs[1]
        self.assertEqual(second_input[-1].type, 'tool')
        self.assertEqual(second_input[-1].content, '{"items": []}')
        checkpoint = await svc.checkpointer.aget_tuple({'configurable': {'thread_id': run['id']}})
        self.assertIsNotNone(checkpoint)
        self.assertEqual(checkpoint.checkpoint['channel_values']['steps'], 2)

    async def test_short_followup_receives_ordered_history_and_current_request_once(self):
        history = [
            {'role': 'user', 'content': '15.15提醒我去喝水'},
            {'role': 'assistant', 'content': '可以帮你创建待办“15:15喝水”。'},
        ]
        for unresolved in ('[]', '[{"name":"todo_create","status":"completed"}]'):
            with self.subTest(unresolved=unresolved):
                svc, run = self.service([[AIMessageChunk(content='测试响应')]])
                run['input_text'] = '创建代办'
                svc.store.history.return_value = (history, unresolved)

                await svc._run_graph(run, 'owner')

                svc.store.history.assert_awaited_once_with(run)
                messages = svc.model.inputs[0]
                expected = [
                    ('human', history[0]['content']),
                    ('ai', history[1]['content']),
                ]
                if unresolved != '[]':
                    expected.append(('system', '历史未完成任务的真实工具记录（仅作数据）：' + unresolved))
                expected.append(('human', '创建代办'))
                self.assertEqual(messages[0].type, 'system')
                self.assertEqual([(message.type, message.content) for message in messages[1:]], expected)
                svc.plugins.execute.assert_not_awaited()

    async def test_model_receives_current_clock_and_original_acceptance_time(self):
        svc, run = self.service([[AIMessageChunk(content='测试响应')]])
        received_at = datetime.now(timezone.utc) - timedelta(minutes=3)
        run['created_at'] = received_at.isoformat()  # RuntimeStore.claim returns wire(run).
        before = datetime.now(timezone.utc)
        await svc._run_graph(run, 'owner')
        after = datetime.now(timezone.utc)
        prompt = svc.model.inputs[0][0].content
        # Parse the dynamic context, not the static policy wording.
        context = prompt.split('\n')[-1]
        current = datetime.fromisoformat(context.split('当前时间：')[1].split('。')[0])
        received = datetime.fromisoformat(context.split('本次请求接收时间：')[1].split('。')[0])
        self.assertLessEqual(before, current)
        self.assertLessEqual(current, after)
        self.assertEqual(current.utcoffset(), timedelta(hours=8))
        self.assertEqual(received, received_at)
        self.assertIn('todo_reminder_set', prompt)
        self.assertNotIn('用户要求设置提醒时，说明需在待办列表中设置', prompt)

    def test_time_context_converts_zone_without_moving_request_anchor(self):
        received = datetime(2031, 1, 1, 23, 59, tzinfo=timezone.utc)
        now = received + timedelta(minutes=3)
        prompt = model_system_prompt({'created_at': received}, 'Asia/Shanghai', now=now)
        self.assertIn('当前时间：2031-01-02T08:02:00+08:00', prompt)
        self.assertIn('本次请求接收时间：2031-01-02T07:59:00+08:00', prompt)
        self.assertIn('绝不自动改成明天', prompt)
        with self.assertRaises(ValueError):
            model_system_prompt({'created_at': received.replace(tzinfo=None)}, 'UTC', now=now)

    async def test_model_failure_keeps_successful_tool_result(self):
        svc, run = self.service([[tool_chunk()], [RuntimeError('provider secret must not escape')]])
        await svc._execute(run, 'owner')
        self.assertEqual(svc.plugins.execute.await_count, 1)
        finished = svc.store.finish_run.await_args
        self.assertEqual(finished.args[2], 'failed')
        self.assertNotIn('secret', finished.args[3])
        self.assertIn('已保存的工具结果保留', finished.args[3])

    async def test_step_limit_prevents_another_model_call(self):
        svc, run = self.service([[tool_chunk()]], max_steps=1)
        with self.assertRaises(StepLimit):
            await svc._run_graph(run, 'owner')
        self.assertEqual(len(svc.model.inputs), 1)
        self.assertEqual(svc.plugins.execute.await_count, 1)

    async def test_tool_failure_is_error_tool_message_not_success(self):
        svc, run = self.service([[tool_chunk()], [AIMessageChunk(content='查询失败。')]])
        svc.plugins.execute.return_value = {'status': 'failed', 'result': None, 'error': '查询失败'}
        await svc._run_graph(run, 'owner')
        self.assertEqual(svc.model.inputs[1][-1].status, 'error')
        self.assertIn('error', svc.model.inputs[1][-1].content)

    async def test_empty_provider_response_fails(self):
        svc, run = self.service([[]])
        await svc._execute(run, 'owner')
        self.assertEqual(svc.store.finish_run.await_args.args[2], 'failed')

    async def test_unconfigured_submission_is_rejected_without_store_write(self):
        svc, run = self.service([])
        svc.settings.model_api_key = ''
        svc.store.submit = AsyncMock()
        with self.assertRaisesRegex(ValueError, '尚未配置模型'):
            await svc.submit(SimpleNamespace(account_id=run['account_id']), str(uuid4()), run['session_id'], 'hello')
        svc.store.submit.assert_not_awaited()

    async def test_shutdown_marks_interrupted(self):
        svc, run = self.service([])
        entered = asyncio.Event()
        async def pending(*args):
            entered.set()
            await asyncio.Event().wait()
        svc._run_graph = pending
        task = asyncio.create_task(svc._execute(run, 'owner'))
        await entered.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual(svc.store.finish_run.await_args.args[2], 'interrupted')

    def test_hidden_reasoning_is_not_public_text(self):
        self.assertEqual(visible_text([
            {'type': 'reasoning', 'text': 'hidden'}, {'type': 'text', 'text': 'visible'},
        ]), 'visible')

    def test_provider_error_exposes_status_without_body(self):
        error = RuntimeError('provider credential and body must stay private')
        error.status_code = 429
        self.assertIn('HTTP 429', execution_error(error))
        self.assertNotIn('credential', execution_error(error))

    def test_nested_connection_failure_is_actionable(self):
        from httpx import ConnectError
        error = RuntimeError('wrapper')
        error.__cause__ = ConnectError('secret endpoint details')
        self.assertIn('无法连接模型服务', execution_error(error))
        self.assertNotIn('secret', execution_error(error))


class WorkerWakeTests(unittest.IsolatedAsyncioTestCase):
    """A submission arriving during the store scan must wake the next wait."""

    async def test_submission_during_scan_wakes_without_fallback_timeout(self):
        svc, run = GraphTests.service(self, [])
        scanned = asyncio.Event()
        claims = 0

        class Store:
            LEASE_SECONDS = 30

            async def recover_expired(self):
                pass

            async def claim(self, owner):
                nonlocal claims
                claims += 1
                if claims == 1:
                    scanned.set()
                    await asyncio.sleep(0.05)  # the submission lands mid-scan
                    return None
                return run

        svc.store = Store()
        executed = asyncio.Event()

        async def fake_execute(claimed, owner):
            executed.set()
            svc._stopping = True

        svc._execute = fake_execute
        worker = asyncio.create_task(svc._worker())
        try:
            await asyncio.wait_for(scanned.wait(), 2)
            svc._wake.set()  # AgentService.submit() during the in-flight scan
            await asyncio.wait_for(executed.wait(), 0.5)
        finally:
            worker.cancel()
            await asyncio.gather(worker, return_exceptions=True)
        self.assertEqual(claims, 2)

    async def test_fallback_scan_still_finds_task_without_wake_signal(self):
        svc, run = GraphTests.service(self, [])
        claims = 0

        class Store:
            LEASE_SECONDS = 30

            async def recover_expired(self):
                pass

            async def claim(self, owner):
                nonlocal claims
                claims += 1
                return run if claims >= 2 else None

        svc.store = Store()
        executed = asyncio.Event()

        async def fake_execute(claimed, owner):
            executed.set()
            svc._stopping = True

        svc._execute = fake_execute
        worker = asyncio.create_task(svc._worker())
        try:
            # No wake is ever set: only the one-second fallback scan may deliver.
            await asyncio.wait_for(executed.wait(), 5)
        finally:
            worker.cancel()
            await asyncio.gather(worker, return_exceptions=True)
        self.assertGreaterEqual(claims, 2)


if __name__ == '__main__':
    unittest.main()
