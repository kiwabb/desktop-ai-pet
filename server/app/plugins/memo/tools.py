"""Memo plugin: manifest-backed declarations, validation and in-transaction
execution. The core (app.plugin_runtime.PluginRegistry) owns the execute
skeleton; this module only knows the memo business branches."""
from __future__ import annotations

from uuid import UUID, uuid4

from app.contracts import reminder_arguments, reminder_time

from .manifest import (MEMO_PROMPT_FRAGMENTS, MODEL_TOOLS, PLUGIN_MANIFEST, TOOL_DEFINITIONS,
                       VALIDATION_MESSAGES)
from .store import MemoStore, memo_view, validated_content, validated_kind, validated_title


def _memo_id(value):
    if not isinstance(value, str):
        raise ValueError(VALIDATION_MESSAGES['memo_id'])
    try:
        return str(UUID(value))
    except ValueError:
        raise ValueError(VALIDATION_MESSAGES['memo_id']) from None


def validated_arguments(handler, arguments):
    if not isinstance(arguments, dict):
        raise ValueError(VALIDATION_MESSAGES['arguments_not_object'])
    if handler == 'memo_create':
        if 'title' not in arguments or set(arguments) - {'title', 'kind', 'content', 'review_at'}:
            raise ValueError(VALIDATION_MESSAGES['create_requires_title'])
        return {'title': validated_title(arguments['title']),
                'kind': validated_kind(arguments.get('kind', 'note')),
                'content': validated_content(arguments.get('content')),
                'review_at': reminder_time(arguments.get('review_at'))}
    if handler == 'memo_list':
        if set(arguments) - {'kind', 'include_archived'}:
            raise ValueError(VALIDATION_MESSAGES['list_filters'])
        include_archived = arguments.get('include_archived', False)
        if not isinstance(include_archived, bool):
            raise ValueError(VALIDATION_MESSAGES['list_filters'])
        kind = arguments.get('kind')
        return {'kind': validated_kind(kind) if kind is not None else None,
                'include_archived': include_archived}
    if handler == 'memo_update':
        allowed = {'memo_id', 'title', 'content', 'kind'}
        if 'memo_id' not in arguments or not (set(arguments) - {'memo_id'}) or set(arguments) - allowed:
            raise ValueError(VALIDATION_MESSAGES['update_keys'])
        params = {'memo_id': _memo_id(arguments['memo_id'])}
        if 'title' in arguments:
            params['title'] = validated_title(arguments['title'])
        if 'content' in arguments:
            params['content'] = validated_content(arguments['content'])
        if 'kind' in arguments:
            params['kind'] = validated_kind(arguments['kind'])
        return params
    if handler == 'memo_archive':
        if set(arguments) != {'memo_id', 'archived'} or not isinstance(arguments.get('archived'), bool):
            raise ValueError(VALIDATION_MESSAGES['archive_keys'])
        return {'memo_id': _memo_id(arguments['memo_id']), 'archived': arguments['archived']}
    if handler == 'memo_review_set':
        if set(arguments) != {'memo_id', 'review_at', 'expected_review_at'}:
            raise ValueError(VALIDATION_MESSAGES['review_set_keys'])
        memo_id = _memo_id(arguments['memo_id'])
        target, expected = reminder_arguments({'remind_at': arguments['review_at'],
                                               'expected_remind_at': arguments['expected_review_at']})
        return {'memo_id': memo_id, 'review_at': target, 'expected_review_at': expected}
    raise ValueError(VALIDATION_MESSAGES['unsupported_tool'])


class MemoPlugin:
    """The memo capability plugin (records and review reminders).

    Declarations come from the shared manifest; validate/execute_in_tx are the
    server-side handler implementation behind them.
    """

    id = 'memo'
    definitions = TOOL_DEFINITIONS
    model_tools = MODEL_TOOLS
    validation_messages = VALIDATION_MESSAGES
    affects = PLUGIN_MANIFEST['affects']
    rest_endpoints = PLUGIN_MANIFEST['rest_endpoints']

    def __init__(self, db=None):
        self.store = MemoStore(db)

    def prompt_fragments(self):
        # Declaration order in the manifest is the slot order: tool rules
        # first, then review/time rules (the latter reference the tool names
        # introduced by the former).
        return list(MEMO_PROMPT_FRAGMENTS)

    def validate(self, handler, arguments):
        return validated_arguments(handler, arguments)

    async def execute_in_tx(self, conn, current, tool, handler, params):
        """Business effects inside the core's transaction; the returned dict
        becomes the tool result committed by the core skeleton."""
        if handler == 'memo_create':
            row = await (await conn.execute(
                'INSERT INTO memos(id,account_id,kind,title,content,source_tool_call_id) '
                'VALUES (%s,%s,%s,%s,%s,%s) RETURNING *',
                (str(uuid4()), current['account_id'], params['kind'], params['title'],
                 params['content'], tool['id']),
            )).fetchone()
            item = memo_view(row)
            if params['review_at'] is not None:
                item = await self.store.set_memo_review_in_transaction(
                    conn, current['account_id'], str(row['id']), params['review_at'], None)
            return {'item': item}
        if handler == 'memo_review_set':
            return {'item': await self.store.set_memo_review_in_transaction(
                conn, current['account_id'], params['memo_id'], params['review_at'],
                params['expected_review_at'])}
        if handler == 'memo_archive':
            return {'item': await self.store.set_memo_archived_in_transaction(
                conn, current['account_id'], params['memo_id'], params['archived'])}
        if handler == 'memo_update':
            changes = {key: params[key] for key in ('title', 'content', 'kind') if key in params}
            return {'item': await self.store.update_memo_in_transaction(
                conn, current['account_id'], params['memo_id'], changes)}
        return {'items': await self.store.memos_in_transaction(
            conn, current['account_id'], params['kind'], params['include_archived'])}
