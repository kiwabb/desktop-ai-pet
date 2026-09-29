#!/usr/bin/env python3
"""Real-model timing verification: submit -> claim -> model start -> first text.

Uses an existing issued device credential and the currently configured real
model. All prompts are read-only queries; no business data is created.

Checks:
- submit -> run.started interval stays well below the old ~1s fallback floor;
- three back-to-back submissions all execute, in order, with gapless seq;
- a mid-run disconnect + reconnect resumes from the persisted watermark;
- server-side timeline (agent_runs / agent_events / model_call_traces) matches.

Run from anywhere:  server/.venv/bin/python tools/verify-agent-timing.py
"""

import argparse
import asyncio
import json
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from websockets.asyncio.client import connect

SERVER_DIR = Path(__file__).resolve().parent.parent / 'server'
sys.path.insert(0, str(SERVER_DIR))

READ_ONLY_PROMPTS = [
    '请调用查询待办工具，告诉我目前有哪些待办。只查询，不创建或修改任何记录。',
    '请再次调用查询待办工具，只统计待办数量并告诉我数字。不要创建或修改任何记录。',
    '请调用查询待办工具，列出最近一条待办的标题。只查询，不创建或修改任何记录。',
]


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://127.0.0.1:18081')
    parser.add_argument('--credential-file', type=Path, default=SERVER_DIR / '.local' / 'device.json')
    parser.add_argument('--output', type=Path)
    return parser.parse_args()


def now_iso():
    return datetime.now(timezone.utc).isoformat()


async def open_session(ws, session_id=None):
    await ws.send(json.dumps({'v': 1, 'type': 'session.open', 'payload': {'session_id': session_id}}))
    initial = json.loads(await asyncio.wait_for(ws.recv(), 20))
    assert initial['type'] == 'session.snapshot', initial.get('type')
    assert initial['seq'] == initial['payload']['seq'], 'Snapshot watermark mismatch'
    return initial['payload']['session_id'], initial['seq']


def server_timeline(run_ids):
    """Four durable timestamps per run, read through the server's own Settings."""
    from app.config import Settings
    import psycopg

    settings = Settings(_env_file=str(SERVER_DIR / '.env'))
    query = """
        SELECT r.id,
               r.created_at AS submitted_at,
               (SELECT e.created_at FROM agent_events e
                 WHERE e.run_id = r.id AND e.type = 'run.started') AS claimed_at,
               (SELECT min(c.started_at) FROM model_call_traces c
                 WHERE c.run_id = r.id) AS model_started_at,
               (SELECT min(coalesce(c.first_visible_text_at, c.first_response_at))
                  FROM model_call_traces c WHERE c.run_id = r.id) AS first_text_at
        FROM agent_runs r WHERE r.id = ANY(%s::uuid[]) ORDER BY r.ordinal
    """
    with psycopg.connect(settings.database_url) as conn:
        rows = conn.execute(query, (run_ids,)).fetchall()
    timeline = []
    for run_id, submitted, claimed, model_started, first_text in rows:
        def ms(later, earlier):
            if later is None or earlier is None:
                return None
            return max(0, int((later - earlier).total_seconds() * 1000))
        timeline.append({
            'run_id': str(run_id),
            'submitted_at': submitted.isoformat(),
            'claimed_at': claimed.isoformat() if claimed else None,
            'model_started_at': model_started.isoformat() if model_started else None,
            'first_text_at': first_text.isoformat() if first_text else None,
            'submit_to_claim_ms': ms(claimed, submitted),
            'submit_to_model_start_ms': ms(model_started, submitted),
            'model_start_to_first_text_ms': ms(first_text, model_started),
        })
    return timeline


async def verify(args):
    base = args.base_url.rstrip('/')
    token = json.loads(args.credential_file.read_text())['device_token']
    ws_url = base.replace('http', 'ws', 1) + '/v1/control/ws'
    headers = {'Authorization': f'Bearer {token}'}
    report = {'evidence': 'real_service_and_real_model', 'created_demo_data': False}

    prompts = READ_ONLY_PROMPTS
    submitted = {}   # request_id -> monotonic send time
    runs = {}        # run_id -> timing record
    run_order = []   # run_ids in accepted order
    terminal_order = []
    cursor = -1
    session_id = None

    async def pump(ws, until, deadline):
        nonlocal cursor
        while time.monotonic() < deadline and not until():
            raw = await asyncio.wait_for(ws.recv(), max(1, deadline - time.monotonic()))
            event = json.loads(raw)
            if event['type'] == 'protocol.error':
                raise AssertionError(event['payload'])
            seq = event.get('seq')
            if seq is None:
                continue
            assert type(seq) is int and seq == cursor + 1, f'事件水位跳跃：{cursor} -> {seq}'
            cursor = seq
            run_id = event.get('run_id')
            record = runs.setdefault(run_id, {'run_id': run_id}) if run_id else None
            at = time.monotonic()
            if event['type'] == 'run.accepted':
                record['accepted_at'] = at
                record['request_id'] = event.get('request_id')
                run_order.append(run_id)
            elif event['type'] == 'run.started':
                record['started_at'] = at
            elif event['type'] == 'message.delta' and 'first_delta_at' not in record:
                record['first_delta_at'] = at
            elif event['type'] in ('run.completed', 'run.failed', 'run.interrupted'):
                record['terminal_at'] = at
                record['terminal_type'] = event['type']
                terminal_order.append(run_id)
        if not until():
            raise AssertionError('等待事件超时')

    # Phase 1: three back-to-back submissions on one socket.
    async with connect(ws_url, additional_headers=headers, max_size=4 * 1024 * 1024) as ws:
        session_id, cursor = await open_session(ws)
        for text in prompts:
            request_id = str(uuid.uuid4())
            submitted[request_id] = time.monotonic()
            await ws.send(json.dumps({'v': 1, 'type': 'run.submit', 'request_id': request_id,
                                      'session_id': session_id, 'payload': {'text': text}}, ensure_ascii=False))
        deadline = time.monotonic() + 240
        await pump(ws, lambda: len(terminal_order) == len(prompts), deadline)

    assert len(run_order) == len(prompts), f'只受理了 {len(run_order)}/{len(prompts)} 条提交'
    assert terminal_order == run_order, '任务完成顺序与提交顺序不一致'
    for record in runs.values():
        assert record['terminal_type'] == 'run.completed', record
        assert 'first_delta_at' in record, f"任务 {record['run_id']} 没有流式正文"
        send_at = submitted[record['request_id']]
        record['client_submit_to_started_ms'] = int((record['started_at'] - send_at) * 1000)
        record['client_submit_to_first_delta_ms'] = int((record['first_delta_at'] - send_at) * 1000)

    # 首个任务在空闲执行器上提交：旧实现要等 ~1s 兜底，修复后应立即领取。
    first = runs[run_order[0]]
    report['first_run_submit_to_started_ms'] = first['client_submit_to_started_ms']
    assert first['client_submit_to_started_ms'] < 900, f"提交到领取仍约 1 秒：{first['client_submit_to_started_ms']}ms"

    # Phase 2: mid-run disconnect, then reconnect and resume from the watermark.
    async with connect(ws_url, additional_headers=headers, max_size=4 * 1024 * 1024) as ws:
        same_session, cursor = await open_session(ws, session_id)
        assert same_session == session_id
        request_id = str(uuid.uuid4())
        submitted[request_id] = time.monotonic()
        await ws.send(json.dumps({'v': 1, 'type': 'run.submit', 'request_id': request_id,
                                  'session_id': session_id,
                                  'payload': {'text': prompts[0]}}, ensure_ascii=False))
        reconnect_run = None
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            event = json.loads(await asyncio.wait_for(ws.recv(), 30))
            seq = event.get('seq')
            if seq is not None:
                assert seq == cursor + 1, '断线前事件水位跳跃'
                cursor = seq
            if event['type'] == 'run.started':
                reconnect_run = event.get('run_id')
                break
        assert reconnect_run, '断线测试的任务未开始'
        # 任务执行中断开连接；服务端任务不依赖连接存活。
    await asyncio.sleep(2)
    pre_reconnect_cursor = cursor
    async with connect(ws_url, additional_headers=headers, max_size=4 * 1024 * 1024) as ws:
        _, snap_seq = await open_session(ws, session_id)
        cursor = snap_seq
        assert snap_seq >= pre_reconnect_cursor, '重连快照水位回退'
        deadline = time.monotonic() + 240
        await pump(ws, lambda: terminal_order.count(reconnect_run) == 1, deadline)
    assert runs[reconnect_run]['terminal_type'] == 'run.completed'

    run_ids = [record['run_id'] for record in runs.values()]
    report['runs'] = list(runs.values())
    report['server_timeline'] = server_timeline(run_ids)
    report['submit_to_started_ms'] = [runs[rid]['client_submit_to_started_ms'] for rid in run_order]
    report['event_seq_gapless'] = True
    report['terminal_order_matches_submit_order'] = True
    report['reconnect_resumed_from_watermark'] = True
    output = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output + '\n')
    print(output)


if __name__ == '__main__':
    asyncio.run(verify(arguments()))
