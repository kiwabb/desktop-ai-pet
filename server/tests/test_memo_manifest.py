"""Shared plugin manifest equivalence tests (plugins/memo/plugin.json).

The manifest is the single source of truth: Python loads it at runtime
(app.plugins.memo.manifest), Rust embeds the same file at compile time
(src-tauri/src/local_agent/plugins/memo/manifest.rs). The pinned literals
below are independent transcriptions; the Rust suite pins the same MODEL_TOOLS
schema (plugins/memo/mod.rs tool_schemas_match_plugin_manifest), so drift
fails both suites. The full SYSTEM_PROMPT (todo + memo fragments) is pinned in
test_plugin_manifest.py.
"""
import json
import unittest

from app.plugins.memo.manifest import (MEMO_PROMPT_FRAGMENTS, MODEL_TO_BUSINESS, MODEL_TOOLS,
                                       PLUGIN_PATH, TOOL_DEFINITIONS, TOOL_HANDLERS,
                                       VALIDATION_MESSAGES)

EXPECTED_MODEL_TOOLS = json.loads(r'''[
    {"type":"function","function":{"name":"memo_create",
     "description":"创建一条真实备忘或长期目标；需要回顾时同时提供 review_at，原子保存记录与回顾时间。仅在用户要求记录时使用。",
     "parameters":{"type":"object","properties":{
        "title":{"type":"string","minLength":1,"maxLength":2000,"description":"用户要求记录的备忘标题（摘要）"},
        "kind":{"type":"string","enum":["note","goal"],"description":"note 为普通备忘（默认），goal 为长期目标"},
        "content":{"type":["string","null"],"maxLength":20000,"description":"可选正文细节；省略或 null 表示只有标题"},
        "review_at":{"type":["string","null"],"format":"date-time","description":"未来的带时区 ISO 回顾时间；省略或 null 表示不设置回顾。不能仅将时间写入标题充当回顾提醒。"}},
        "required":["title"],"additionalProperties":false}}},
    {"type":"function","function":{"name":"memo_list",
     "description":"查询当前账号的真实备忘与长期目标；默认不含已归档，可按 kind 过滤；没有记录时返回空列表。",
     "parameters":{"type":"object","properties":{
        "kind":{"type":"string","enum":["note","goal"],"description":"可选，按类型过滤：note 备忘或 goal 长期目标"},
        "include_archived":{"type":"boolean","description":"可选，为 true 时同时返回已归档记录；默认只返回未归档"}},
        "additionalProperties":false}}},
    {"type":"function","function":{"name":"memo_update",
     "description":"更新用户明确指定的一条已有备忘的标题、正文或类型；目标缺失或有歧义时先询问，不得猜测 ID。",
     "parameters":{"type":"object","properties":{
        "memo_id":{"type":"string","format":"uuid","description":"从真实备忘查询结果取得的记录 ID"},
        "title":{"type":"string","minLength":1,"maxLength":2000,"description":"新标题；不修改则省略"},
        "kind":{"type":"string","enum":["note","goal"],"description":"新类型；不修改则省略"},
        "content":{"type":["string","null"],"maxLength":20000,"description":"新正文；null 清空；不修改则省略"}},
        "required":["memo_id"],"additionalProperties":false}}},
    {"type":"function","function":{"name":"memo_archive",
     "description":"归档或取消归档用户明确指定的一条已有备忘；归档会同时清除其回顾时间。目标缺失或有歧义时先询问，不得猜测 ID。",
     "parameters":{"type":"object","properties":{
        "memo_id":{"type":"string","format":"uuid","description":"从真实备忘查询结果取得的记录 ID"},
        "archived":{"type":"boolean","description":"true 归档（同时清除回顾时间），false 取消归档"}},
        "required":["memo_id","archived"],"additionalProperties":false}}},
    {"type":"function","function":{"name":"memo_review_set",
     "description":"设置、修改或取消已有备忘的回顾时间。先查询真实 ID 和当前 review_at；取消传 null，目标不明确先询问。",
     "parameters":{"type":"object","properties":{
        "memo_id":{"type":"string","format":"uuid","description":"从真实查询结果取得的已有备忘 ID"},
        "review_at":{"type":["string","null"],"format":"date-time","description":"未来的带时区 ISO 时间；null 取消回顾"},
        "expected_review_at":{"type":["string","null"],"format":"date-time","description":"真实查询结果中的当前 review_at，未设置为 null；不得猜测"}},
        "required":["memo_id","review_at","expected_review_at"],"additionalProperties":false}}}
]''')

EXPECTED_VALIDATION_MESSAGES = {
    'arguments_not_object': '工具参数必须为对象',
    'create_requires_title': '创建备忘必须提供 title，仅可附加 kind、content 和 review_at 参数',
    'title_length': '备忘标题需为 1 到 2000 个字符',
    'content_length': '备忘正文需为不超过 20000 个字符的文本',
    'kind_values': 'kind 仅支持 note 或 goal',
    'list_filters': '查询备忘仅接受可选的 kind 和 include_archived 参数',
    'update_keys': '更新备忘必须提供 memo_id，并至少提供 title、content 或 kind 之一',
    'memo_id': 'memo_id 必须为有效的 UUID',
    'archive_keys': '归档备忘必须且只能提供 memo_id 和布尔值 archived',
    'review_set_keys': '设置回顾时间必须且只能提供 memo_id、review_at 和 expected_review_at',
    'unsupported_tool': '不支持该工具',
}

EXPECTED_ENDPOINTS = {
    ('GET', '/v1/memos'),
    ('POST', '/v1/memos'),
    ('PATCH', '/v1/memos/{memo_id}'),
    ('POST', '/v1/memos/{memo_id}/archive'),
    ('PUT', '/v1/memos/{memo_id}/review'),
    ('GET', '/v1/memos/reviews/due'),
}


class MemoManifestTests(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads(PLUGIN_PATH.read_text(encoding='utf-8'))

    def test_tool_definitions_and_mapping_come_from_the_manifest(self):
        self.assertEqual(TOOL_DEFINITIONS, self.manifest['tools'])
        self.assertEqual(MODEL_TOOLS, EXPECTED_MODEL_TOOLS)
        self.assertEqual(MODEL_TO_BUSINESS, self.manifest['name_mapping'])
        self.assertEqual(TOOL_HANDLERS,
                         {business: model for model, business in self.manifest['name_mapping'].items()})
        for tool in self.manifest['tools']:
            self.assertEqual(self.manifest['name_mapping'][tool['handler_key']], tool['name'])
            self.assertEqual(tool['execution_location'], 'server')
        permissions = {tool['name']: tool['permission'] for tool in self.manifest['tools']}
        self.assertEqual(permissions['memo.list'], 'memo.read')
        self.assertTrue(all(permission.startswith('memo.') for permission in permissions.values()))

    def test_prompt_fragments_follow_the_layout_slot_order(self):
        fragments = self.manifest['prompt_fragments']
        # Declaration order in the manifest is the layout's slot order.
        self.assertEqual([fragment['key'] for fragment in fragments], ['tool_rules', 'review_time_rules'])
        self.assertEqual(MEMO_PROMPT_FRAGMENTS, [fragment['text'] for fragment in fragments])

    def test_validation_messages_match_the_manifest(self):
        self.assertEqual(VALIDATION_MESSAGES, EXPECTED_VALIDATION_MESSAGES)
        self.assertEqual(VALIDATION_MESSAGES, self.manifest['validation_messages'])

    def test_affects_and_rest_endpoint_declarations(self):
        self.assertEqual(self.manifest['affects'], ['memo-list'])
        endpoints = {(endpoint['method'], endpoint['path']) for endpoint in self.manifest['rest_endpoints']}
        self.assertEqual(endpoints, EXPECTED_ENDPOINTS)


if __name__ == '__main__':
    unittest.main()
