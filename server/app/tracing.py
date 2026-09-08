"""Bounded, best-effort observation; never part of the business event sequence."""
from __future__ import annotations

import asyncio
from collections import OrderedDict
import json
import logging
import re

logger = logging.getLogger(__name__)
_SECRET_FIELD = re.compile(r'(?:api[_-]?key|authorization|proxy[_-]?authorization|(?:access[_-]?|refresh[_-]?|device[_-]?|session[_-]?)token|password|secret|cookie|credential)', re.I)
_CREDENTIAL_TEXT = re.compile(
    r'(?i)(\b(?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|device[_-]?token|token|password|secret|credential)\b[\s\"\x27]*[:=][\s\"\x27]*)(?:bearer\s+)?[^\s,;\"\x27}\]]+'
)
_BEARER = re.compile(r'(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+')
_KEY = re.compile(r'\bsk-[A-Za-z0-9_-]{8,}')


def redact_trace(value, secrets=()):
    """Redact a copy; only explicitly supplied effective credentials, never env."""
    if isinstance(value, dict):
        return {str(key): '[REDACTED]' if _SECRET_FIELD.fullmatch(str(key)) else redact_trace(item, secrets)
                for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact_trace(item, secrets) for item in value]
    if isinstance(value, str):
        # JSON encoded tool bodies need the same field-level treatment.
        if value.lstrip().startswith(('{', '[')):
            try:
                decoded = json.loads(value)
            except (ValueError, RecursionError):
                pass
            else:
                return json.dumps(redact_trace(decoded, secrets), ensure_ascii=False)
        for secret in secrets:
            if isinstance(secret, str) and secret:
                value = value.replace(secret, '[REDACTED]')
        value = re.sub(r'(https?://)[^/\s:@]+:[^/\s@]+@', r'\1[REDACTED]@', value)
        value = _CREDENTIAL_TEXT.sub(r'\1[REDACTED]', value)
        value = _BEARER.sub('Bearer [REDACTED]', value)
        return _KEY.sub('[REDACTED]', value)
    return value


def trace_body(value, limit=256 * 1024, secrets=()):
    encoded = json.dumps(redact_trace(value, secrets), ensure_ascii=False, default=str)
    raw = encoded.encode()
    if len(raw) <= limit:
        return json.loads(encoded), False, len(raw)
    return {'truncated_text': raw[:limit].decode('utf-8', errors='ignore'), 'truncated': True}, True, len(raw)


def message_snapshot(message):
    """Allowlisted application protocol, including causal tool identifiers."""
    result = {'role': getattr(message, 'type', 'unknown'), 'content': getattr(message, 'content', '')}
    for key in ('tool_calls', 'invalid_tool_calls', 'tool_call_chunks', 'tool_call_id', 'name', 'status'):
        value = getattr(message, key, None)
        if value is not None:
            result[key] = value
    return result


class TraceWriter:
    """Single ordered writer with a bounded queue and independently timed writes.

    Full terminal/request writes evict the oldest queued item, recording a gap.
    Partial previews may be skipped: the terminal snapshot supersedes them.
    If the database remains unavailable, reconciliation leaves terminal partial
    traces incomplete; a failed telemetry write never cancels business work.
    """
    def __init__(self, store, *, capacity=128, timeout=.25):
        self.store, self.timeout = store, timeout
        self.queue = asyncio.Queue(maxsize=capacity)
        self.gaps = OrderedDict()
        self.failed = OrderedDict()
        self.task = None
        self.closed = False

    def gap(self, run, reason):
        key = str(run['id'])
        previous = self.gaps.get(key)
        reasons = set(previous[1]) if previous else set()
        reasons.add(reason)
        self.gaps[key] = (run, reasons)
        self.failed[key] = True
        if len(self.failed) > self.queue.maxsize * 2:
            self.failed.popitem(last=False)
        # No unbounded in-memory retry buffer during an outage.
        if len(self.gaps) > self.queue.maxsize:
            self.gaps.popitem(last=False)

    def submit(self, run, method, *args, preview=False, **kwargs):
        if self.closed:
            return
        if not hasattr(self.store, method):
            return  # Small isolated runtime doubles intentionally omit tracing.
        if self.queue.full():
            if preview:
                return
            dropped = self.queue.get_nowait()
            self.queue.task_done()
            self.gap(dropped[0], '观测队列已满，记录未写入')
        self.queue.put_nowait((run, method, args, kwargs))
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self._drain(), name='agent-trace-writer')

    async def _bounded(self, method, *args, **kwargs):
        async with asyncio.timeout(self.timeout):
            await getattr(self.store, method)(*args, **kwargs)

    async def _drain(self):
        while not self.queue.empty() or self.gaps:
            if self.gaps:
                _, (run, reasons) = self.gaps.popitem(last=False)
                try:
                    await self._bounded('mark_trace_gap', run, '；'.join(sorted(reasons)))
                except Exception:
                    # Reconcile terminal partial records once storage recovers.
                    logger.warning('观测缺口暂未持久化，终态扫描将核对完整性')
            if self.queue.empty():
                continue
            run, method, args, kwargs = self.queue.get_nowait()
            try:
                if method == 'finalize_run_trace' and str(run['id']) in self.failed:
                    kwargs['gap_reason'] = '观测队列或写入发生缺口'
                await self._bounded(method, *args, **kwargs)
                if method == 'finalize_run_trace':
                    self.failed.pop(str(run['id']), None)
            except asyncio.CancelledError:
                raise
            except Exception:
                self.gap(run, f'{method} 写入失败或超时')
                logger.warning('追踪写入失败或超时；业务继续执行')
            finally:
                self.queue.task_done()

    async def close(self):
        self.closed = True
        if self.task:
            try:
                async with asyncio.timeout(1):
                    await asyncio.shield(self.task)
            except TimeoutError:
                self.task.cancel()
                await asyncio.gather(self.task, return_exceptions=True)
