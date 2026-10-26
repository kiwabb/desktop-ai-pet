"""Memo domain storage: direct operations and in-transaction primitives.

The domain-agnostic skeleton (start_tool / finish_tool / executing) stays in
app.runtime_store; everything that knows the memos table lives in the plugin.
"""
from __future__ import annotations

from uuid import uuid4

from app.contracts import ReminderConflict
from app.runtime_store import uuid_text, wire

MEMO_KINDS = ('note', 'goal')


def memo_view(row):
    return wire({**{key: row[key] for key in ('id', 'kind', 'title', 'content', 'status', 'created_at')},
                 'review_at': row.get('review_at')})


def validated_title(title):
    """Same rule and message as the memo.create tool: stripped 1..2000 chars."""
    if not isinstance(title, str) or not title.strip() or len(title) > 2000:
        raise ValueError('备忘标题需为 1 到 2000 个字符')
    return title.strip()


def validated_content(content):
    """Optional free-text body; None means absent (and clears on update)."""
    if content is None:
        return None
    if not isinstance(content, str) or len(content) > 20000:
        raise ValueError('备忘正文需为不超过 20000 个字符的文本')
    return content


def validated_kind(kind):
    if kind not in MEMO_KINDS:
        raise ValueError('kind 仅支持 note 或 goal')
    return kind


class MemoStore:
    def __init__(self, db):
        self.db = db

    async def list_memos(self, account_id, kind=None, include_archived=False):
        kind = validated_kind(kind) if kind is not None else None
        async with self.db.pool.connection() as conn:
            return await self.memos_in_transaction(conn, account_id, kind, include_archived)

    async def due_reviews(self, account_id):
        async with self.db.pool.connection() as conn:
            rows = await (await conn.execute(
                "SELECT * FROM memos WHERE account_id=%s AND status='active' "
                "AND review_at <= now() ORDER BY review_at,id", (account_id,),
            )).fetchall()
            return [memo_view(row) for row in rows]

    async def set_memo_review(self, account_id, memo_id, target, expected):
        memo_id = uuid_text(memo_id)
        async with self.db.pool.connection() as conn, conn.transaction():
            return await self.set_memo_review_in_transaction(conn, account_id, memo_id, target, expected)

    @staticmethod
    async def set_memo_review_in_transaction(conn, account_id, memo_id, target, expected):
        memo_id = uuid_text(memo_id)
        row = await (await conn.execute(
            'SELECT * FROM memos WHERE id=%s AND account_id=%s FOR UPDATE',
            (memo_id, account_id),
        )).fetchone()
        if row is None:
            raise LookupError('未找到备忘，请刷新核对')
        if row['status'] != 'active':
            raise ReminderConflict('备忘已归档，请刷新核对')
        current = row['review_at']
        # A lost-response retry may arrive after its target time has passed.
        if current == target:
            return memo_view(row)
        if current != expected:
            raise ReminderConflict('回顾时间已被修改，请刷新后重试')
        if target is not None:
            clock = await (await conn.execute('SELECT clock_timestamp() AS db_now')).fetchone()
            if target <= clock['db_now']:
                raise ValueError('回顾时间必须晚于当前时间')
        row = await (await conn.execute(
            'UPDATE memos SET review_at=%s WHERE id=%s AND account_id=%s RETURNING *',
            (target, memo_id, account_id),
        )).fetchone()
        return memo_view(row)

    async def set_memo_archived(self, account_id, memo_id, archived):
        memo_id = uuid_text(memo_id)
        async with self.db.pool.connection() as conn, conn.transaction():
            return await self.set_memo_archived_in_transaction(conn, account_id, memo_id, archived)

    @staticmethod
    async def set_memo_archived_in_transaction(conn, account_id, memo_id, archived):
        # Archiving clears the review time, mirroring todo completion clearing reminders.
        sql = ("UPDATE memos SET status='archived', review_at=NULL WHERE id=%s AND account_id=%s RETURNING *"
               if archived else
               "UPDATE memos SET status='active' WHERE id=%s AND account_id=%s RETURNING *")
        row = await (await conn.execute(sql, (uuid_text(memo_id), account_id))).fetchone()
        if row is None:
            raise LookupError('未找到备忘，请刷新核对')
        return memo_view(row)

    async def create_memo(self, account_id, title, kind='note', content=None, review_at=None):
        async with self.db.pool.connection() as conn, conn.transaction():
            memo = await self.create_memo_in_transaction(conn, account_id, title, kind, content)
            if review_at is not None:
                # Same CAS/future-time rule as memo.review.set, in one transaction.
                memo = await self.set_memo_review_in_transaction(
                    conn, account_id, memo['id'], review_at, None)
            return memo

    @staticmethod
    async def create_memo_in_transaction(conn, account_id, title, kind='note', content=None):
        row = await (await conn.execute(
            'INSERT INTO memos(id,account_id,kind,title,content) VALUES (%s,%s,%s,%s,%s) RETURNING *',
            (str(uuid4()), account_id, validated_kind(kind), validated_title(title),
             validated_content(content)),
        )).fetchone()
        return memo_view(row)

    async def update_memo(self, account_id, memo_id, changes):
        memo_id = uuid_text(memo_id)
        async with self.db.pool.connection() as conn, conn.transaction():
            return await self.update_memo_in_transaction(conn, account_id, memo_id, changes)

    @staticmethod
    async def update_memo_in_transaction(conn, account_id, memo_id, changes):
        if not isinstance(changes, dict) or set(changes) - {'title', 'content', 'kind'}:
            raise ValueError('必须且只能提供 title、kind 或 content 中的至少一项')
        fields = {}
        if 'title' in changes:
            fields['title'] = validated_title(changes['title'])
        if 'content' in changes:
            fields['content'] = validated_content(changes['content'])
        if 'kind' in changes:
            fields['kind'] = validated_kind(changes['kind'])
        if not fields:
            raise ValueError('必须且只能提供 title、kind 或 content 中的至少一项')
        # Field names come from the fixed whitelist above, never from input.
        assignments = ', '.join(f'{field}=%s' for field in fields)
        row = await (await conn.execute(
            f'UPDATE memos SET {assignments} WHERE id=%s AND account_id=%s RETURNING *',
            (*fields.values(), uuid_text(memo_id), account_id),
        )).fetchone()
        if row is None:
            raise LookupError('备忘不存在或已删除')
        return memo_view(row)

    async def memos_in_transaction(self, conn, account_id, kind=None, include_archived=False):
        rows = await (await conn.execute(
            'SELECT * FROM memos WHERE account_id=%s '
            'AND (%s::text IS NULL OR kind=%s) '
            "AND (%s OR status='active') "
            'ORDER BY created_at,id', (account_id, kind, kind, include_archived),
        )).fetchall()
        return [memo_view(row) for row in rows]
