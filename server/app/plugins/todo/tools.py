"""Todo plugin: manifest-backed declarations, validation and in-transaction
execution. The core (app.plugin_runtime.PluginRegistry) owns the execute
skeleton; this module only knows the todo business branches."""
from __future__ import annotations

from uuid import UUID, uuid4

from app.contracts import reminder_arguments, reminder_time, uuid_string

from .manifest import (MODEL_TOOLS, PLUGIN_MANIFEST, TODO_PROMPT_FRAGMENTS, TOOL_DEFINITIONS,
                       VALIDATION_MESSAGES)
from .store import TodoStore, todo_view


def validated_arguments(handler, arguments):
    if not isinstance(arguments, dict):
        raise ValueError(VALIDATION_MESSAGES['arguments_not_object'])
    if handler == 'todo_create':
        if 'title' not in arguments or set(arguments) - {'title', 'remind_at'}:
            raise ValueError(VALIDATION_MESSAGES['create_requires_title'])
        title = arguments['title']
        if not isinstance(title, str) or not title.strip() or len(title) > 2000:
            raise ValueError(VALIDATION_MESSAGES['title_length'])
        return {'title': title.strip(), 'remind_at': reminder_time(arguments.get('remind_at'))}
    if handler == 'todo_reminder_set':
        if set(arguments) != {'todo_id', 'remind_at', 'expected_remind_at'}:
            raise ValueError(VALIDATION_MESSAGES['reminder_set_keys'])
        todo_id = uuid_string(arguments['todo_id'], 'todo_id')
        target, expected = reminder_arguments({key: arguments[key] for key in ('remind_at', 'expected_remind_at')})
        return {'todo_id': todo_id, 'remind_at': target, 'expected_remind_at': expected}
    if handler == 'todo_list':
        if arguments:
            raise ValueError(VALIDATION_MESSAGES['list_no_arguments'])
        return {}
    if handler == 'todo_complete':
        if set(arguments) != {'todo_id'} or not isinstance(arguments['todo_id'], str):
            raise ValueError(VALIDATION_MESSAGES['complete_todo_id'])
        try:
            return {'todo_id': str(UUID(arguments['todo_id']))}
        except ValueError:
            raise ValueError(VALIDATION_MESSAGES['complete_todo_id']) from None
    raise ValueError(VALIDATION_MESSAGES['unsupported_tool'])


class TodoPlugin:
    """The todo capability plugin (first consumer of the core plugin seam).

    Declarations come from the shared manifest; validate/execute_in_tx are the
    server-side handler implementation behind them.
    """

    id = 'todo'
    definitions = TOOL_DEFINITIONS
    model_tools = MODEL_TOOLS
    validation_messages = VALIDATION_MESSAGES
    affects = PLUGIN_MANIFEST['affects']
    rest_endpoints = PLUGIN_MANIFEST['rest_endpoints']

    def __init__(self, db=None):
        self.store = TodoStore(db)

    def prompt_fragments(self):
        # Declaration order in the manifest is the slot order: tool rules
        # first, then reminder/time rules (the latter reference the tool names
        # introduced by the former).
        return list(TODO_PROMPT_FRAGMENTS)

    def validate(self, handler, arguments):
        return validated_arguments(handler, arguments)

    async def execute_in_tx(self, conn, current, tool, handler, params):
        """Business effects inside the core's transaction; the returned dict
        becomes the tool result committed by the core skeleton."""
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
            return {'item': item}
        if handler == 'todo_reminder_set':
            return {'item': await self.store.set_todo_reminder_in_transaction(
                conn, current['account_id'], params['todo_id'], params['remind_at'],
                params['expected_remind_at'])}
        if handler == 'todo_complete':
            return {'item': await self.store.complete_todo_in_transaction(
                conn, current['account_id'], params['todo_id'])}
        return {'items': await self.store.todos_in_transaction(conn, current['account_id'])}
