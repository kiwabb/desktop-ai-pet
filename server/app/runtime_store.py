"""PostgreSQL is the authority for tasks, tool effects and replayable UI state.

Every visible mutation locks the session and commits its event in the same
transaction. A snapshot takes the same lock, so its sequence is a true watermark.
Worker leases fence writes; crashed running tasks are never automatically replayed.
"""
from __future__ import annotations

import json
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4, uuid5

from psycopg.types.json import Jsonb

from .contracts import ReminderConflict


class LeaseLost(RuntimeError):
    """The worker must stop; it no longer owns the execution."""


def uuid_text(value: str) -> str:
    try:
        return str(UUID(value))
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError('标识必须为有效 UUID') from exc


def wire(value):
    if isinstance(value, (UUID, datetime)):
        return value.isoformat() if isinstance(value, datetime) else str(value)
    if isinstance(value, dict):
        return {key: wire(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [wire(item) for item in value]
    return value


def run_view(row):
    return wire({key: row[key] for key in ('id', 'request_id', 'status', 'error')})


def message_view(row):
    return wire({key: row[key] for key in ('id', 'role', 'content', 'created_at', 'run_id')})


def tool_view(row):
    return wire({key: row[key] for key in ('id', 'run_id', 'name', 'status', 'result', 'error')})


def todo_view(row):
    return wire({**{key: row[key] for key in ('id', 'title', 'status', 'created_at')},
                 'remind_at': row.get('remind_at')})


class RuntimeStore:
    LEASE_SECONDS = 30

    def __init__(self, db, model_configs=None, payload_retention_days=30):
        self.db, self.model_configs, self.payload_retention_days = db, model_configs, payload_retention_days

    async def _session(self, conn, session_id, account_id=None):
        row = await (await conn.execute(
            'SELECT * FROM agent_sessions WHERE id = %s FOR UPDATE',
            (uuid_text(session_id),),
        )).fetchone()
        if row is None:
            raise LookupError('会话不存在')
        if account_id is not None and str(row['account_id']) != str(account_id):
            raise PermissionError('无权访问该会话')
        return row

    async def _event(self, conn, run, kind, payload):
        row = await (await conn.execute(
            'UPDATE agent_sessions SET seq = seq + 1 WHERE id = %s RETURNING seq',
            (run['session_id'],),
        )).fetchone()
        envelope = wire(dict(v=1, type=kind, request_id=run['request_id'],
                             session_id=run['session_id'], run_id=run['id'],
                             seq=row['seq'], payload=payload))
        await conn.execute(
            'INSERT INTO agent_events(session_id,seq,run_id,type,envelope) VALUES (%s,%s,%s,%s,%s)',
            (run['session_id'], row['seq'], run['id'], kind, Jsonb(envelope)),
        )
        return envelope

    async def create_session(self, account_id):
        session_id = str(uuid4())
        async with self.db.pool.connection() as conn:
            await conn.execute('INSERT INTO agent_sessions(id,account_id) VALUES (%s,%s)',
                               (session_id, account_id))
        return {'session_id': session_id}

    async def snapshot(self, account_id, session_id):
        async with self.db.pool.connection() as conn, conn.transaction():
            session = await self._session(conn, session_id, account_id)
            messages = await (await conn.execute(
                'SELECT * FROM agent_messages WHERE session_id=%s ORDER BY ordinal',
                (session_id,),
            )).fetchall()
            runs = await (await conn.execute(
                'SELECT * FROM agent_runs WHERE session_id=%s ORDER BY ordinal',
                (session_id,),
            )).fetchall()
            calls = await (await conn.execute(
                'SELECT t.* FROM agent_tool_calls t JOIN agent_runs r ON r.id=t.run_id '
                'WHERE r.session_id=%s ORDER BY t.ordinal', (session_id,),
            )).fetchall()
            return dict(session_id=str(session['id']), seq=session['seq'],
                        messages=[message_view(m) for m in messages],
                        runs=[run_view(r) for r in runs], tool_calls=[tool_view(t) for t in calls])

    async def events_after(self, account_id, session_id, after_seq):
        if not isinstance(after_seq, int) or isinstance(after_seq, bool) or after_seq < 0:
            raise ValueError('事件水位必须为非负整数')
        async with self.db.pool.connection() as conn, conn.transaction():
            await self._session(conn, session_id, account_id)
            rows = await (await conn.execute(
                'SELECT envelope FROM agent_events WHERE session_id=%s AND seq>%s ORDER BY seq LIMIT 200',
                (session_id, after_seq),
            )).fetchall()
            return [row['envelope'] for row in rows]

    async def submit(self, account_id, request_id, session_id, text):
        request_id, session_id = uuid_text(request_id), uuid_text(session_id)
        if not isinstance(text, str) or not text.strip() or len(text) > 16000:
            raise ValueError('消息需为 1 到 16000 个字符')
        async with self.db.pool.connection() as conn, conn.transaction():
            # Serialise the account/request key even across different sessions.
            await conn.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))',
                               (f'{account_id}:{request_id}',))
            await self._session(conn, session_id, account_id)
            existing = await (await conn.execute(
                'SELECT * FROM agent_runs WHERE account_id=%s AND request_id=%s',
                (account_id, request_id),
            )).fetchone()
            if existing:
                if str(existing['session_id']) != session_id or existing['input_text'] != text:
                    raise ValueError('该请求标识已用于不同的消息，请使用新的请求标识')
                row = await (await conn.execute(
                    "SELECT envelope FROM agent_events WHERE run_id=%s AND type='run.accepted'",
                    (existing['id'],),
                )).fetchone()
                return row['envelope']
            config_version_id = await self.model_configs.bind_for_new_run(conn) if self.model_configs else None
            run = await (await conn.execute(
                "INSERT INTO agent_runs(id,account_id,session_id,request_id,input_text,status,model_config_version_id) "
                "VALUES (%s,%s,%s,%s,%s,'queued',%s) RETURNING *",
                (str(uuid4()), account_id, session_id, request_id, text, config_version_id),
            )).fetchone()
            await conn.execute(
                "INSERT INTO run_trace_states(run_id,session_id,account_id,integrity) VALUES (%s,%s,%s,'partial')",
                (run['id'], run['session_id'], run['account_id']),
            )
            messages = []
            for role, content in (('user', text), ('assistant', '')):
                row = await (await conn.execute(
                    'INSERT INTO agent_messages(id,session_id,run_id,role,content) '
                    'VALUES (%s,%s,%s,%s,%s) RETURNING *',
                    (str(uuid4()), session_id, run['id'], role, content),
                )).fetchone()
                messages.append(message_view(row))
            return await self._event(conn, run, 'run.accepted',
                                     dict(run=run_view(run), user_message=messages[0],
                                         assistant_message=messages[1]))

    @staticmethod
    def _trace_body(value, limit=256 * 1024):
        encoded = json.dumps(value, ensure_ascii=False, default=str)
        raw = encoded.encode()
        if len(raw) <= limit:
            return json.loads(encoded), False, len(raw)
        clipped = raw[:limit].decode('utf-8', errors='ignore')
        return {'truncated_text': clipped, 'truncated': True}, True, len(raw)

    async def start_model_trace(self, run, step_index, config, request_context):
        call_id = str(uuid4())
        body, truncated, original_bytes = self._trace_body(request_context)
        now = datetime.now(timezone.utc)
        async with self.db.pool.connection() as conn, conn.transaction():
            await conn.execute(
                "INSERT INTO model_call_traces(id,run_id,step_index,config_version_id,model_name,started_at,status) VALUES (%s,%s,%s,%s,%s,%s,'running')",
                (call_id, run['id'], step_index, config.get('id'), config.get('model_name'), now),
            )
            await conn.execute(
                "INSERT INTO trace_payloads(id,run_id,model_call_id,kind,body,truncated,original_bytes,expires_at) VALUES (%s,%s,%s,'application_request',%s,%s,%s,%s)",
                (str(uuid4()), run['id'], call_id, Jsonb(body), truncated, original_bytes, now + timedelta(days=self.payload_retention_days)),
            )
        return call_id, now, time.monotonic()

    async def finish_model_trace(self, run, call_id, started_at, *, started_clock=None, status, error_type=None,
                                 response=None, first_response_at=None, first_visible_text_at=None,
                                 usage=None, usage_source=None):
        ended = datetime.now(timezone.utc)
        body, truncated, original_bytes = self._trace_body(response if response is not None else {})
        duration = max(0, int((time.monotonic() - started_clock) * 1000)) if started_clock is not None else max(0, int((ended - started_at).total_seconds() * 1000))
        async with self.db.pool.connection() as conn, conn.transaction():
            await conn.execute(
                "UPDATE model_call_traces SET ended_at=%s,duration_ms=%s,first_response_at=%s,first_visible_text_at=%s,status=%s,error_type=%s,usage=%s,usage_source=%s WHERE id=%s AND run_id=%s",
                (ended, duration, first_response_at, first_visible_text_at, status, error_type,
                 Jsonb(usage) if usage is not None else None, usage_source, call_id, run['id']),
            )
            await conn.execute(
                "INSERT INTO trace_payloads(id,run_id,model_call_id,kind,body,truncated,original_bytes,expires_at) VALUES (%s,%s,%s,'model_response',%s,%s,%s,%s)",
                (str(uuid4()), run['id'], call_id, Jsonb(body), truncated, original_bytes, ended + timedelta(days=self.payload_retention_days)),
            )
            await conn.execute(
                "UPDATE run_trace_states SET collected_steps=(SELECT count(*) FROM model_call_traces WHERE run_id=%s),updated_at=now(),integrity=%s WHERE run_id=%s",
                (run['id'], 'complete' if status == 'succeeded' else 'incomplete', run['id']),
            )

    async def link_tool_trace(self, model_call_id, tool_call_id, step_index):
        async with self.db.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO tool_trace_links(model_call_id,tool_call_id,step_index) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING",
                (model_call_id, tool_call_id, step_index),
            )

    async def mark_trace_gap(self, run, reason):
        async with self.db.pool.connection() as conn:
            await conn.execute(
                "UPDATE run_trace_states SET integrity='incomplete',gap_reason=%s,updated_at=now() WHERE run_id=%s",
                (reason, run['id']),
            )

    async def cleanup_observability(self, payload_days=30, metadata_days=90):
        async with self.db.pool.connection() as conn, conn.transaction():
            await conn.execute(
                "WITH doomed AS (SELECT id FROM trace_payloads WHERE expires_at<=now() LIMIT 500) "
                "DELETE FROM trace_payloads WHERE id IN (SELECT id FROM doomed)"
            )
            await conn.execute(
                "WITH doomed AS (SELECT id FROM model_call_traces WHERE ended_at IS NOT NULL "
                "AND ended_at<=now()-make_interval(days => %s) LIMIT 500) "
                "DELETE FROM trace_payloads WHERE model_call_id IN (SELECT id FROM doomed)", (metadata_days,)
            )
            await conn.execute(
                "WITH doomed AS (SELECT id FROM model_call_traces WHERE ended_at IS NOT NULL "
                "AND ended_at<=now()-make_interval(days => %s) LIMIT 500) "
                "DELETE FROM tool_trace_links WHERE model_call_id IN (SELECT id FROM doomed)", (metadata_days,)
            )
            await conn.execute(
                "WITH doomed AS (SELECT id FROM model_call_traces WHERE ended_at IS NOT NULL "
                "AND ended_at<=now()-make_interval(days => %s) LIMIT 500) "
                "DELETE FROM model_call_traces WHERE id IN (SELECT id FROM doomed)", (metadata_days,)
            )
            await conn.execute(
                "DELETE FROM run_trace_states WHERE run_id NOT IN (SELECT id FROM agent_runs WHERE status IN ('queued','running')) "
                "AND updated_at<=now()-make_interval(days => %s)", (metadata_days,)
            )
            await conn.execute(
                "WITH doomed AS (SELECT id FROM admin_audit_events WHERE created_at<=now()-make_interval(days => %s) LIMIT 500) "
                "DELETE FROM admin_audit_events WHERE id IN (SELECT id FROM doomed)", (metadata_days,)
            )

    async def claim(self, owner):
        async with self.db.pool.connection() as conn, conn.transaction():
            # Lock a session, not merely a task, to prevent competing workers
            # claiming two queued tasks for the same conversation.
            session = await (await conn.execute(
                "SELECT s.id FROM agent_sessions s WHERE EXISTS "
                "(SELECT 1 FROM agent_runs q WHERE q.session_id=s.id AND q.status='queued') "
                "AND NOT EXISTS (SELECT 1 FROM agent_runs r WHERE r.session_id=s.id AND r.status='running') "
                "ORDER BY (SELECT min(q.ordinal) FROM agent_runs q WHERE q.session_id=s.id AND q.status='queued') "
                "LIMIT 1 FOR UPDATE OF s SKIP LOCKED",
            )).fetchone()
            if session is None:
                return None
            run = await (await conn.execute(
                "UPDATE agent_runs SET status='running', lease_owner=%s, "
                "lease_until=now()+make_interval(secs => %s) WHERE id=(SELECT id FROM agent_runs "
                "WHERE session_id=%s AND status='queued' ORDER BY ordinal LIMIT 1) RETURNING *",
                (owner, self.LEASE_SECONDS, session['id']),
            )).fetchone()
            await self._event(conn, run, 'run.started', {'run': run_view(run)})
            return wire(run)

    async def heartbeat(self, run_id, owner):
        async with self.db.pool.connection() as conn:
            cursor = await conn.execute(
                "UPDATE agent_runs SET lease_until=now()+make_interval(secs => %s) "
                "WHERE id=%s AND status='running' AND lease_owner=%s AND lease_until>now()",
                (self.LEASE_SECONDS, run_id, owner),
            )
            if cursor.rowcount != 1:
                raise LeaseLost('任务执行租约已失效')

    @asynccontextmanager
    async def executing(self, run, owner):
        async with self.db.pool.connection() as conn, conn.transaction():
            await self._session(conn, run['session_id'], run['account_id'])
            current = await (await conn.execute(
                "SELECT *, lease_until>now() AS lease_valid FROM agent_runs WHERE id=%s FOR UPDATE",
                (run['id'],),
            )).fetchone()
            if (current is None or current['status'] != 'running' or
                    str(current['lease_owner']) != str(owner) or not current['lease_valid']):
                raise LeaseLost('任务执行租约已失效')
            yield conn, current

    async def append_delta(self, run, owner, text):
        if not text:
            return
        async with self.executing(run, owner) as (conn, current):
            row = await (await conn.execute(
                "UPDATE agent_messages SET content=content || %s WHERE run_id=%s AND role='assistant' RETURNING id",
                (text, run['id']),
            )).fetchone()
            await self._event(conn, current, 'message.delta', dict(message_id=str(row['id']), text=text))

    async def start_tool(self, run, owner, call_id, name, arguments):
        if not isinstance(call_id, str) or not call_id or len(call_id) > 256:
            raise ValueError('模型工具调用标识无效')
        tool_id = str(uuid5(UUID(run['id']), call_id))
        async with self.executing(run, owner) as (conn, current):
            existing = await (await conn.execute(
                'SELECT * FROM agent_tool_calls WHERE id=%s', (tool_id,),
            )).fetchone()
            if existing:
                if existing['name'] != name or existing['arguments'] != arguments:
                    raise ValueError('工具调用标识对应的参数发生冲突')
                if existing['status'] in ('completed', 'failed'):
                    return tool_view(existing)
                raise LeaseLost('工具结果尚未确认，禁止重复执行')
            row = await (await conn.execute(
                'INSERT INTO agent_tool_calls(id,run_id,model_call_id,name,arguments,status) '
                "VALUES (%s,%s,%s,%s,%s,'running') RETURNING *",
                (tool_id, run['id'], call_id, name, Jsonb(arguments)),
            )).fetchone()
            view = tool_view(row)
            await self._event(conn, current, 'tool.started', {'tool_call': view})
            return view

    async def finish_tool(self, conn, run, tool_id, result=None, error=None):
        # Called inside the SAME transaction as the todo insertion/read.
        row = await (await conn.execute(
            'UPDATE agent_tool_calls SET status=%s,result=%s,error=%s '
            "WHERE id=%s AND run_id=%s AND status='running' RETURNING *",
            ('failed' if error else 'completed', Jsonb(result) if result is not None else None,
             error, tool_id, run['id']),
        )).fetchone()
        if row is None:
            raise LeaseLost('工具结果已变更，禁止覆盖')
        view = tool_view(row)
        await self._event(conn, run, 'tool.finished', {'tool_call': view})
        return view

    async def finish_run(self, run, owner, status, error=None):
        if status not in ('completed', 'failed', 'interrupted'):
            raise ValueError('任务终态无效')
        async with self.executing(run, owner) as (conn, current):
            await self._terminal(conn, current, status, error)

    async def _terminal(self, conn, run, status, error):
        # Any started tool with no committed result is explicitly unresolved.
        calls = await (await conn.execute(
            "UPDATE agent_tool_calls SET status='needs_reconciliation', error=%s "
            "WHERE run_id=%s AND status='running' RETURNING *",
            ('执行中断，结果需要核实，未自动重试', run['id']),
        )).fetchall()
        for call in calls:
            await self._event(conn, run, 'tool.finished', {'tool_call': tool_view(call)})
        row = await (await conn.execute(
            'UPDATE agent_runs SET status=%s,error=%s,lease_until=NULL,lease_owner=NULL WHERE id=%s RETURNING *',
            (status, error, run['id']),
        )).fetchone()
        await self._event(conn, row, f'run.{status}', {'run': run_view(row)})

    async def recover_expired(self):
        async with self.db.pool.connection() as conn, conn.transaction():
            sessions = await (await conn.execute(
                "SELECT s.id FROM agent_sessions s WHERE EXISTS (SELECT 1 FROM agent_runs r "
                "WHERE r.session_id=s.id AND r.status='running' AND r.lease_until<=now()) "
                'LIMIT 50 FOR UPDATE OF s SKIP LOCKED',
            )).fetchall()
            for session in sessions:
                rows = await (await conn.execute(
                    "SELECT * FROM agent_runs WHERE session_id=%s AND status='running' "
                    'AND lease_until<=now() FOR UPDATE', (session['id'],),
                )).fetchall()
                for run in rows:
                    await self._terminal(conn, run, 'interrupted', '执行进程已中断，已保存的工具结果保留，未自动重试')

    async def history(self, run):
        async with self.db.pool.connection() as conn:
            rows = await (await conn.execute(
                'SELECT m.role,m.content FROM agent_messages m JOIN agent_runs r ON r.id=m.run_id '
                'WHERE m.session_id=%s AND r.account_id=%s AND r.ordinal<%s '
                "AND m.content<>'' ORDER BY m.ordinal DESC LIMIT 40",
                (run['session_id'], run['account_id'], run['ordinal']),
            )).fetchall()
            # Failed model replies must not hide already committed effects.
            results = await (await conn.execute(
                'SELECT t.name,t.status,t.result FROM agent_tool_calls t JOIN agent_runs r ON r.id=t.run_id '
                'WHERE r.session_id=%s AND r.account_id=%s AND r.ordinal<%s '
                "AND r.status IN ('failed','interrupted') ORDER BY t.ordinal DESC LIMIT 20",
                (run['session_id'], run['account_id'], run['ordinal']),
            )).fetchall()
            return list(reversed(rows)), json.dumps(wire(results), ensure_ascii=False)

    async def list_todos(self, account_id):
        async with self.db.pool.connection() as conn:
            return await self.todos_in_transaction(conn, account_id)

    async def due_reminders(self, account_id):
        async with self.db.pool.connection() as conn:
            rows = await (await conn.execute(
                "SELECT * FROM todos WHERE account_id=%s AND status='pending' "
                "AND remind_at <= now() ORDER BY remind_at,id", (account_id,),
            )).fetchall()
            return [todo_view(row) for row in rows]

    async def set_todo_reminder(self, account_id, todo_id, target, expected):
        todo_id = uuid_text(todo_id)
        async with self.db.pool.connection() as conn, conn.transaction():
            return await self.set_todo_reminder_in_transaction(conn, account_id, todo_id, target, expected)

    @staticmethod
    async def set_todo_reminder_in_transaction(conn, account_id, todo_id, target, expected):
        todo_id = uuid_text(todo_id)
        row = await (await conn.execute(
            'SELECT * FROM todos WHERE id=%s AND account_id=%s FOR UPDATE',
            (todo_id, account_id),
        )).fetchone()
        if row is None:
            raise LookupError('未找到待办，请刷新核对')
        if row['status'] != 'pending':
            raise ReminderConflict('待办已完成，请刷新核对')
        current = row['remind_at']
        # A lost-response retry may arrive after its target time has passed.
        if current == target:
            return todo_view(row)
        if current != expected:
            raise ReminderConflict('提醒已被修改，请刷新后重试')
        if target is not None:
            clock = await (await conn.execute('SELECT clock_timestamp() AS db_now')).fetchone()
            if target <= clock['db_now']:
                raise ValueError('提醒时间必须晚于当前时间')
        row = await (await conn.execute(
            'UPDATE todos SET remind_at=%s WHERE id=%s AND account_id=%s RETURNING *',
            (target, todo_id, account_id),
        )).fetchone()
        return todo_view(row)

    async def complete_todo(self, account_id, todo_id):
        todo_id = uuid_text(todo_id)
        async with self.db.pool.connection() as conn, conn.transaction():
            return await self.complete_todo_in_transaction(conn, account_id, todo_id)

    @staticmethod
    async def complete_todo_in_transaction(conn, account_id, todo_id):
        row = await (await conn.execute(
            "UPDATE todos SET status='completed', remind_at=NULL WHERE id=%s AND account_id=%s RETURNING *",
            (uuid_text(todo_id), account_id),
        )).fetchone()
        if row is None:
            raise LookupError('未找到可完成的待办，请重新查询并确认事项')
        return todo_view(row)

    async def reopen_todo(self, account_id, todo_id):
        todo_id = uuid_text(todo_id)
        async with self.db.pool.connection() as conn, conn.transaction():
            row = await (await conn.execute(
                "UPDATE todos SET status='pending' WHERE id=%s AND account_id=%s RETURNING *",
                (todo_id, account_id),
            )).fetchone()
            if row is None:
                raise LookupError('未找到可恢复的待办，请重新查询并确认事项')
            return todo_view(row)

    async def todos_in_transaction(self, conn, account_id):
        rows = await (await conn.execute(
            'SELECT * FROM todos WHERE account_id=%s ORDER BY created_at,id', (account_id,),
        )).fetchall()
        return [todo_view(row) for row in rows]
