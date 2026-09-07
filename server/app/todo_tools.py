"""Registered server tools; business effects and tool results commit together."""
from __future__ import annotations

from uuid import UUID, uuid4

from app.contracts import ReminderConflict, reminder_arguments, reminder_time, uuid_string
from app.runtime_store import LeaseLost, todo_view

TOOL_HANDLERS = {'todo.create': 'todo_create', 'todo.list': 'todo_list', 'todo.complete': 'todo_complete',
                 'todo.reminder.set': 'todo_reminder_set'}
TOOL_DEFINITIONS = [
    dict(name='todo.create', version='2', description='创建一项真实待办；新事项需要提醒时同时提供 remind_at，原子保存事项与提醒。仅在用户要求记录或提醒时使用。',
         input_schema={'type': 'object', 'properties': {'title': {'type': 'string', 'minLength': 1,
                        'maxLength': 2000, 'description': '用户要求记录的待办标题'},
                        'remind_at': {'type': ['string', 'null'], 'format': 'date-time',
                                      'description': '未来的带时区 ISO 时间；省略或 null 表示普通待办。不能仅将时间写入标题充当提醒。'}},
                       'required': ['title'], 'additionalProperties': False},
         permission='todo.write', execution_location='server', handler_key='todo_create'),
    dict(name='todo.list', version='1', description='查询当前账号的真实待办；没有记录时返回空列表。',
         input_schema={'type': 'object', 'properties': {}, 'additionalProperties': False},
         permission='todo.read', execution_location='server', handler_key='todo_list'),
    dict(name='todo.complete', version='1', description='完成用户明确指定的一项已有待办；目标缺失或有歧义时先询问，不得猜测。',
         input_schema={'type': 'object', 'properties': {'todo_id': {'type': 'string', 'format': 'uuid',
                        'description': '从真实待办查询结果取得的记录 ID'}},
                       'required': ['todo_id'], 'additionalProperties': False},
         permission='todo.write', execution_location='server', handler_key='todo_complete'),
]
TOOL_DEFINITIONS.append(dict(
    name='todo.reminder.set', version='1',
    description='设置、修改或取消已有待办的提醒。先查询真实 ID 和当前 remind_at；取消传 null，目标不明确先询问。',
    input_schema={'type': 'object', 'properties': {
        'todo_id': {'type': 'string', 'format': 'uuid', 'description': '从真实查询结果取得的已有待办 ID'},
        'remind_at': {'type': ['string', 'null'], 'format': 'date-time',
                      'description': '未来的带时区 ISO 时间；null 取消提醒'},
        'expected_remind_at': {'type': ['string', 'null'], 'format': 'date-time',
                               'description': '真实查询结果中的当前 remind_at，未设置为 null；不得猜测'}},
        'required': ['todo_id', 'remind_at', 'expected_remind_at'], 'additionalProperties': False},
    permission='todo.write', execution_location='server', handler_key='todo_reminder_set'))
MODEL_TO_BUSINESS = {handler: name for name, handler in TOOL_HANDLERS.items()}
MODEL_TOOLS = [
    {'type': 'function', 'function': {'name': definition['handler_key'],
                                    'description': definition['description'],
                                    'parameters': definition['input_schema']}}
    for definition in TOOL_DEFINITIONS
]


def validated_arguments(handler, arguments):
    if not isinstance(arguments, dict):
        raise ValueError('工具参数必须为对象')
    if handler == 'todo_create':
        if 'title' not in arguments or set(arguments) - {'title', 'remind_at'}:
            raise ValueError('创建待办必须提供 title，仅可附加 remind_at 参数')
        title = arguments['title']
        if not isinstance(title, str) or not title.strip() or len(title) > 2000:
            raise ValueError('待办标题需为 1 到 2000 个字符')
        return {'title': title.strip(), 'remind_at': reminder_time(arguments.get('remind_at'))}
    if handler == 'todo_reminder_set':
        if set(arguments) != {'todo_id', 'remind_at', 'expected_remind_at'}:
            raise ValueError('设置提醒必须且只能提供 todo_id、remind_at 和 expected_remind_at')
        todo_id = uuid_string(arguments['todo_id'], 'todo_id')
        target, expected = reminder_arguments({key: arguments[key] for key in ('remind_at', 'expected_remind_at')})
        return {'todo_id': todo_id, 'remind_at': target, 'expected_remind_at': expected}
    if handler == 'todo_list':
        if arguments:
            raise ValueError('查询待办不接受额外参数')
        return {}
    if handler == 'todo_complete':
        if set(arguments) != {'todo_id'} or not isinstance(arguments['todo_id'], str):
            raise ValueError('完成待办只接受有效的 todo_id 参数')
        try:
            return {'todo_id': str(UUID(arguments['todo_id']))}
        except ValueError:
            raise ValueError('完成待办只接受有效的 todo_id 参数') from None
    raise ValueError('不支持该工具')


class TodoTools:
    def __init__(self, store, registry):
        self.store, self.registry = store, registry

    async def execute(self, run, owner, call):
        model_name = call.get('name', '')
        business_name = MODEL_TO_BUSINESS.get(model_name, model_name)
        arguments = call.get('args', {})
        tool = await self.store.start_tool(run, owner, call.get('id'), business_name, arguments)
        if tool['status'] in ('completed', 'failed'):
            return tool  # A repeated graph/tool call must not repeat a write.
        try:
            if model_name not in MODEL_TO_BUSINESS:
                raise ValueError('不支持该工具')
            # The database registry must actually resolve to a supported local
            # implementation on every invocation, not just advertise a catalog.
            handler = await self.registry.resolve_server(business_name)
            if handler != TOOL_HANDLERS[business_name]:
                raise ValueError('工具注册与可执行实现不匹配')
            params = validated_arguments(handler, arguments)
            async with self.store.executing(run, owner) as (conn, current):
                if handler == 'todo_create':
                    row = await (await conn.execute(
                        'INSERT INTO todos(id,account_id,title,source_tool_call_id) '
                        'VALUES (%s,%s,%s,%s) RETURNING *',
                        (str(uuid4()), current['account_id'], params['title'], tool['id']),
                    )).fetchone()
                    item = todo_view(row)
                    if params['remind_at'] is not None:
                        item = await self.store.set_todo_reminder_in_transaction(
                            conn, current['account_id'], str(row['id']), params['remind_at'], None)
                    result = {'item': item}
                elif handler == 'todo_reminder_set':
                    result = {'item': await self.store.set_todo_reminder_in_transaction(
                        conn, current['account_id'], params['todo_id'], params['remind_at'],
                        params['expected_remind_at'])}
                elif handler == 'todo_complete':
                    result = {'item': await self.store.complete_todo_in_transaction(
                        conn, current['account_id'], params['todo_id'])}
                else:
                    result = {'items': await self.store.todos_in_transaction(conn, current['account_id'])}
                return await self.store.finish_tool(conn, current, tool['id'], result=result)
        except LeaseLost:
            raise
        except Exception as exc:
            # Never surface provider/DB exception strings (they can contain
            # credentials or SQL). Validation errors are our own fixed messages.
            error = str(exc) if isinstance(exc, (ValueError, LookupError, ReminderConflict)) else '工具执行失败，未确认保存成功'
            async with self.store.executing(run, owner) as (conn, current):
                return await self.store.finish_tool(conn, current, tool['id'], error=error)
