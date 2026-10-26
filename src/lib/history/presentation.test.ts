import { beforeEach, describe, expect, it } from 'vitest'
import type { ToolCall } from '../agent'
import { presentTool, registerToolPresentation, resetToolPresentations, toolEffectsFingerprint } from '../tool-presentation'
import { historyPresentationPlugin } from './presentation'

function tool(overrides: Partial<ToolCall> = {}): ToolCall {
  return { id: 'lookup', run_id: 'current-run', name: 'local.history.search', status: 'completed', result: null, error: null, ...overrides }
}

beforeEach(() => {
  resetToolPresentations()
  registerToolPresentation(historyPresentationPlugin)
})

describe('history presentation', () => {
  it('routes both local tool names and keeps unconfirmed stages separate from results', () => {
    for (const name of ['local.history.search', 'local_history_search']) {
      expect(presentTool(tool({ name, status: 'running' }))).toEqual({ name: '查找聊天记录', status: '正在查找…', text: '' })
    }
    expect(presentTool(tool({ status: 'failed' })).status).toBe('查找失败')
    expect(presentTool(tool({ status: 'needs_reconciliation' })).status).toBe('查找中断')
    expect(presentTool(tool()).status).toBe('结果待确认')
    expect(presentTool(tool({ result: { items: [{ source_id: 'missing excerpt' }] } })).status).toBe('结果待确认')
  })

  it('limits excerpts without losing the result count or claiming complete recall', () => {
    const result = {
      has_more: true,
      items: [
        { excerpt: '长'.repeat(600), excerpt_truncated: true, message_id: 'do-not-display', run_id: 'do-not-display' },
        { excerpt: '第二条\n 聊天记录', excerpt_truncated: false },
        { excerpt: '第三条不作为预览展示', excerpt_truncated: false },
      ],
    }
    const presentation = presentTool(tool({ result }))
    expect(presentation.status).toBe('已查询')
    expect(presentation.text).toContain('返回 3 条聊天片段，仅展示有限摘录。还有更多聊天片段。')
    expect(presentation.text).toContain(`${'长'.repeat(80)}…`)
    expect(presentation.text).toContain('第二条 聊天记录')
    expect(presentation.text).not.toContain('第三条不作为预览展示')
    expect(presentation.text).not.toContain('do-not-display')
    expect(toolEffectsFingerprint([tool({ result })], 'todo-list')).toBe('[]')
    expect(toolEffectsFingerprint([tool({ result })], 'memo-list')).toBe('[]')
  })

  it('distinguishes an empty query page from an unmatched literal query', () => {
    expect(presentTool(tool({ result: { items: [], search_mode: 'recent_messages' } })))
      .toEqual({ name: '查找聊天记录', status: '已查询', text: '暂无更早的聊天记录。' })
    expect(presentTool(tool({ result: { items: [], search_mode: 'literal_case_sensitive' } })))
      .toEqual({ name: '查找聊天记录', status: '已查询', text: '未找到匹配的聊天记录。' })
  })
})
