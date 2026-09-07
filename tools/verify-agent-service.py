#!/usr/bin/env python3
"""Verify the real assistant service; default is a real read-only model query.

Uses an existing issued device credential. Creates an ordinary conversation,
but never seeds todos. --todo-title explicitly opts into keeping a real todo.
Run with server/.venv/bin/python after installing the actual service.
"""

import argparse
import asyncio
import json
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from urllib.parse import urlsplit

from websockets.asyncio.client import connect


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://127.0.0.1:18081')
    parser.add_argument('--credential-file', type=Path, required=True)
    parser.add_argument('--todo-title', help='Actual user-requested todo to keep; omitted means read-only')
    parser.add_argument('--output', type=Path)
    return parser.parse_args()


async def verify(args):
    base = args.base_url.rstrip('/')
    url = urlsplit(base)
    if url.username or url.password or url.query or url.fragment:
        raise ValueError('Service address must not contain credentials, query or fragment')
    if url.scheme != 'https' and not (url.scheme == 'http' and url.hostname in ('localhost', '127.0.0.1', '::1')):
        raise ValueError('Use HTTPS, except for loopback development')
    credentials = json.loads(args.credential_file.read_text())
    token = credentials['device_token']
    opener = urllib.request.build_opener(NoRedirect)

    def get(path, authenticated=True):
        headers = {'Authorization': f'Bearer {token}'} if authenticated else {}
        request = urllib.request.Request(base + path, headers=headers)
        with opener.open(request, timeout=15) as response:
            return json.load(response)

    report = {'evidence': 'real_service_and_real_model', 'created_demo_data': False}
    report['health'] = get('/health', False)
    report['status'] = get('/v1/status')
    assert report['status']['model_configured'], 'Actual model must be configured'
    try:
        get('/v1/todos', False)
    except urllib.error.HTTPError as error:
        assert error.code in (401, 403), error.code
        report['unauthenticated_rejected'] = True
    else:
        raise AssertionError('Unauthenticated todo access was accepted')
    before = get('/v1/todos')['items']
    report['initial_todo_count'] = len(before)
    prompt = ('请记录待办：' + args.todo_title) if args.todo_title else '请调用查询待办工具，告诉我目前有哪些待办。只查询，不创建或修改任何记录。'
    ws_url = ('wss' if url.scheme == 'https' else 'ws') + '://' + url.netloc + url.path.rstrip('/') + '/v1/control/ws'
    request_id = str(uuid.uuid4())
    events = []
    seen = set()
    async with connect(ws_url, additional_headers={'Authorization': f'Bearer {token}'}, max_size=4 * 1024 * 1024) as socket:
        await socket.send(json.dumps({'v': 1, 'type': 'session.open', 'payload': {'session_id': None}}))
        initial = json.loads(await asyncio.wait_for(socket.recv(), 20))
        assert initial['type'] == 'session.snapshot', initial.get('type')
        session_id = initial['payload']['session_id']
        cursor = initial['payload']['seq']
        assert initial['seq'] == cursor, 'Initial snapshot watermark mismatch'
        submission = {'v': 1, 'type': 'run.submit', 'request_id': request_id, 'session_id': session_id, 'payload': {'text': prompt}}
        await socket.send(json.dumps(submission, ensure_ascii=False))
        deadline = time.monotonic() + 150
        run_id = None
        while time.monotonic() < deadline:
            event = json.loads(await asyncio.wait_for(socket.recv(), max(1, deadline - time.monotonic())))
            if event['type'] == 'protocol.error':
                raise AssertionError(event['payload'])
            if event.get('request_id') != request_id:
                continue
            run_id = event.get('run_id') or run_id
            seq = event.get('seq')
            if seq in seen:
                continue
            assert type(seq) is int and seq == cursor + 1, 'Persisted event sequence gap or reordering'
            cursor = seq
            seen.add(seq)
            events.append(event)
            if event['type'] in ('run.completed', 'run.failed', 'run.interrupted'):
                assert event['type'] == 'run.completed', event['payload']
                break
        else:
            raise AssertionError('No persisted terminal event before deadline')
        expected_tool = 'todo.create' if args.todo_title else 'todo.list'
        assert any(
            e['type'] == 'tool.finished'
            and e['payload']['tool_call']['name'] == expected_tool
            and e['payload']['tool_call']['status'] == 'completed'
            for e in events
        ), 'No successful completion of the requested actual tool'
        assert any(e['type'] == 'message.delta' for e in events), 'No actual streamed model text'
        await socket.send(json.dumps(submission, ensure_ascii=False))
        while True:
            repeated = json.loads(await asyncio.wait_for(socket.recv(), 20))
            if repeated['type'] == 'protocol.error':
                raise AssertionError(repeated['payload'])
            if repeated['type'] == 'run.accepted' and repeated.get('request_id') == request_id:
                assert repeated['run_id'] == run_id, 'Duplicate request created a different run'
                break
    snapshot = get('/v1/sessions/' + session_id)
    after = get('/v1/todos')['items']
    if args.todo_title:
        before_ids = {row['id'] for row in before}
        added = [row for row in after if row['id'] not in before_ids]
        assert len(added) == 1, f'Expected exactly one new todo; got {len(added)}'
        assert added[0]['title'] == args.todo_title
        report['created_todo_id'] = added[0]['id']
    else:
        assert {row['id'] for row in before} == {row['id'] for row in after}, 'Read-only model query changed todo rows'
    async with connect(ws_url, additional_headers={'Authorization': f'Bearer {token}'}) as socket:
        await socket.send(json.dumps({'v': 1, 'type': 'session.open', 'payload': {'session_id': session_id}}))
        recovered = json.loads(await asyncio.wait_for(socket.recv(), 20))
        assert recovered['type'] == 'session.snapshot'
        assert recovered['seq'] == recovered['payload']['seq'], 'Recovered snapshot watermark mismatch'
        assert recovered['payload'] == snapshot, 'Reconnect changed persisted snapshot'
    report.update({'session_id': session_id, 'run_id': run_id, 'request_id': request_id,
                   'event_types': [e['type'] for e in events], 'stream_delta_count': sum(e['type'] == 'message.delta' for e in events),
                   'tool_calls': snapshot['tool_calls'], 'final_todo_count': len(after),
                   'duplicate_submission_reused_run': True, 'reconnect_snapshot_matches': True,
                   'ordered_events_verified': True, 'completed_expected_tool': expected_tool,
                   'desktop_ui_verified': False, 'create_todo_verified': bool(args.todo_title)})
    output = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output + '\n')
    print(output)


if __name__ == '__main__':
    asyncio.run(verify(arguments()))
