"""Todo domain storage: direct operations and in-transaction primitives.

The domain-agnostic skeleton (start_tool / finish_tool / executing) stays in
app.runtime_store; everything that knows the todos table lives in the plugin.
"""
from __future__ import annotations

from uuid import uuid4

from app.contracts import ReminderConflict
from app.runtime_store import uuid_text, wire


def todo_view(row):
    return wire({**{key: row[key] for key in ('id', 'title', 'status', 'created_at')},
                 'remind_at': row.get('remind_at')})


def validated_title(title):
    """Same rule and message as the todo.create tool: stripped 1..2000 chars."""
    if not isinstance(title, str) or not title.strip() or len(title) > 2000:
        raise ValueError('待办标题需为 1 到 2000 个字符')
    return title.strip()


class TodoStore:
    def __init__(self, db):
        self.db = db

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

    async def create_todo(self, account_id, title):
        async with self.db.pool.connection() as conn, conn.transaction():
            return await self.create_todo_in_transaction(conn, account_id, title)

    @staticmethod
    async def create_todo_in_transaction(conn, account_id, title):
        row = await (await conn.execute(
            'INSERT INTO todos(id,account_id,title) VALUES (%s,%s,%s) RETURNING *',
            (str(uuid4()), account_id, validated_title(title)),
        )).fetchone()
        return todo_view(row)

    async def update_todo_title(self, account_id, todo_id, title):
        todo_id, title = uuid_text(todo_id), validated_title(title)
        async with self.db.pool.connection() as conn, conn.transaction():
            row = await (await conn.execute(
                'UPDATE todos SET title=%s WHERE id=%s AND account_id=%s RETURNING *',
                (title, todo_id, account_id),
            )).fetchone()
            if row is None:
                raise LookupError('待办不存在或已删除')
            return todo_view(row)

    async def delete_todo(self, account_id, todo_id):
        todo_id = uuid_text(todo_id)
        async with self.db.pool.connection() as conn, conn.transaction():
            # Hard delete: no table references todos (tool_calls store JSON results).
            row = await (await conn.execute(
                'DELETE FROM todos WHERE id=%s AND account_id=%s RETURNING *',
                (todo_id, account_id),
            )).fetchone()
            if row is None:
                raise LookupError('待办不存在或已删除')
            return todo_view(row)

    async def todos_in_transaction(self, conn, account_id):
        rows = await (await conn.execute(
            'SELECT * FROM todos WHERE account_id=%s ORDER BY created_at,id', (account_id,),
        )).fetchall()
        return [todo_view(row) for row in rows]
