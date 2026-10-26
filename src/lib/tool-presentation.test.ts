import { beforeEach, describe, expect, it } from 'vitest'

import type { ToolCall } from './agent'
import manifest from '../../plugins/todo/plugin.json'
import memoManifest from '../../plugins/memo/plugin.json'
import {
  presentTool,
  registerToolPresentation,
  resetToolPresentations,
  toolEffectsFingerprint,
  type ToolPresentationPlugin,
} from './tool-presentation'
import { todoPresentationPlugin } from './todo/presentation'
import { memoPresentationPlugin } from './memo/presentation'

function tool(name: string, overrides: Partial<ToolCall> = {}): ToolCall {
  return { id: 'call-1', run_id: 'run-1', name, status: 'completed', result: null, error: null, ...overrides }
}

beforeEach(() => {
  resetToolPresentations()
  registerToolPresentation(todoPresentationPlugin)
})

describe('tool presentation registry', () => {
  it('routes registered tools to their plugin presentation', () => {
    const presentation = presentTool(tool('todo_create', { result: { item: { id: 't1', title: '喝水', status: 'pending', remind_at: null } } }))
    expect(presentation).toEqual({ name: '记录待办', status: '已记录', text: '已记录：喝水' })
  })

  it('degrades unknown tools to the generic shape without throwing (AC5)', () => {
    expect(() => presentTool(tool('some_future_tool'))).not.toThrow()
    expect(presentTool(tool('some_future_tool'))).toEqual({ name: '工具：some_future_tool', status: '执行成功', text: '' })
    expect(presentTool(tool('some_future_tool', { status: 'running' })).status).toBe('橘伴处理中…')
    expect(presentTool(tool('some_future_tool', { status: 'failed' })).status).toBe('失败')
    expect(presentTool(tool('some_future_tool', { status: 'needs_reconciliation' })).status).toBe('结果待确认')
    expect(presentTool(tool('  ')).name).toBe('工具')
  })

  it('degrades gracefully when a plugin registration is removed (AC5)', () => {
    resetToolPresentations()
    expect(() => presentTool(tool('todo_create'))).not.toThrow()
    expect(presentTool(tool('todo_create'))).toEqual({ name: '工具：todo_create', status: '执行成功', text: '' })
    expect(toolEffectsFingerprint([tool('todo_create')], 'todo-list')).toBe('[]')
  })

  it('dispatches refresh fingerprints by declared affects', () => {
    const effect = tool('todo_create', { result: { item: { id: 't1', title: '喝水', status: 'pending', remind_at: null } } })
    const before = toolEffectsFingerprint([effect], 'todo-list')
    // A confirmed effect change advances the group's fingerprint...
    const changed = tool('todo_create', { result: { item: { id: 't1', title: '喝水', status: 'completed', remind_at: null } } })
    expect(toolEffectsFingerprint([changed], 'todo-list')).not.toBe(before)
    // ...while unrelated groups and non-effect tools stay inert.
    expect(toolEffectsFingerprint([changed], 'some-other-group')).toBe('[]')
    const listed = tool('todo_list', { result: { items: [] } })
    expect(toolEffectsFingerprint([effect, listed], 'todo-list')).toBe(before)
  })

  it('keeps tool names and affects same-sourced with plugin.json', () => {
    const expectedNames = manifest.tools.flatMap(entry => [entry.name, entry.handler_key])
    expect([...todoPresentationPlugin.toolNames].sort()).toEqual(expectedNames.sort())
    expect(todoPresentationPlugin.affects).toEqual(manifest.affects)
    for (const name of expectedNames) {
      const presentation = presentTool(tool(name))
      expect(presentation.name).not.toBe(name) // every manifest tool gets a real presentation
    }
  })

  it('accepts additional plugins without touching existing ones', () => {
    const dummy: ToolPresentationPlugin = {
      toolNames: ['dummy_ping'],
      affects: ['dummy-panel'],
      present: call => ({ name: '哑工具', status: call.status, text: '' }),
      effectsFingerprint: () => [],
    }
    registerToolPresentation(dummy)
    expect(presentTool(tool('dummy_ping')).name).toBe('哑工具')
    expect(presentTool(tool('todo_list')).name).toBe('待办列表')
    expect(toolEffectsFingerprint([], 'dummy-panel')).toBe('[[]]')
  })
})

describe('todo outcome presentation', () => {
  it.each(['todo.list', 'todo_list'])('separates a successful %s query from the returned todo states', name => {
    expect(presentTool(tool(name, { result: { items: [
      { id: 'pending', title: '测试', status: 'pending' },
      { id: 'done', title: '已办事项', status: 'completed' },
    ] } }))).toEqual({ name: '待办列表', status: '已查询', text: '测试（待完成）；已办事项（已完成）' })
    expect(presentTool(tool(name, { result: { items: [] } })))
      .toEqual({ name: '待办列表', status: '已查询', text: '当前没有待办事项。' })
  })

  it.each(['todo.create', 'todo_create'])('reports %s as recorded without marking the item complete', name => {
    expect(presentTool(tool(name, { result: { item: { id: 'pending', title: '测试', status: 'pending', remind_at: null } } })))
      .toEqual({ name: '记录待办', status: '已记录', text: '已记录：测试' })
  })

  it.each(['todo.complete', 'todo_complete'])('reports %s completion only when the result confirms the completed state', name => {
    expect(presentTool(tool(name, { result: { item: { id: 'done', title: '测试', status: 'completed' } } })))
      .toEqual({ name: '完成待办', status: '待办已完成', text: '已完成：测试' })
    for (const item of [null, { title: '测试' }, { title: '测试', status: 'pending' }, { status: 'completed' }]) {
      const presentation = presentTool(tool(name, { result: { item } }))
      expect(presentation.status).toBe('结果待确认')
      expect(presentation.text).not.toContain('已完成：')
    }
  })

  it.each(['todo_create', 'todo_list', 'todo_complete', 'todo_reminder_set'])('keeps %s running, failures and reconciliation separate from stale result data', name => {
    const result = { item: { title: '测试', status: 'completed', remind_at: null }, items: [] }
    for (const [status, expected] of [['running', '橘伴处理中…'], ['failed', '失败'], ['needs_reconciliation', '结果待确认']] as const) {
      expect(presentTool(tool(name, { status, result, error: status === 'failed' ? '执行失败' : null })))
        .toMatchObject({ status: expected, text: '' })
    }
  })

  it.each(['todo_create', 'todo_list', 'todo_complete'])('does not infer a successful %s outcome from missing or unrelated result shapes', name => {
    for (const result of [null, {}, { unexpected: true }]) {
      const presentation = presentTool(tool(name, { result }))
      expect(presentation.status).toBe('结果待确认')
      expect(presentation.text).toContain('待办')
      expect(presentation.text).not.toContain('已记录：')
      expect(presentation.text).not.toContain('已完成：')
    }
  })

  it('does not silently present unknown query item states as pending', () => {
    for (const item of [{ title: '测试' }, { title: '测试', status: 'unknown' }, { status: 'pending' }, null]) {
      expect(presentTool(tool('todo_list', { result: { items: [item] } })))
        .toEqual({ name: '待办列表', status: '结果待确认', text: '待办查询结果不完整，请刷新待办列表核对。' })
    }
  })

  it('keeps valid reminder outcomes specific and invalid reminder times unconfirmed', () => {
    const item = { id: 'pending', title: '测试', status: 'pending' }
    const scheduled = presentTool(tool('todo_create', { result: { item: { ...item, remind_at: '2036-09-09T07:15:00Z' } } }))
    expect(scheduled).toMatchObject({ name: '记录待办并设置提醒', status: '已记录' })
    expect(scheduled.text).toContain('提醒时间：')
    const zone = new Intl.DateTimeFormat('zh-CN', { timeZoneName: 'short' })
      .formatToParts(new Date('2036-09-09T07:15:00Z')).find(part => part.type === 'timeZoneName')?.value
    expect(zone).toBeTruthy()
    expect(scheduled.text).toContain(zone!)
    const unconfirmed = presentTool(tool('todo_create', { result: { item: { ...item, remind_at: 'not-a-time' } } }))
    expect(unconfirmed.status).toBe('结果待确认')
    expect(unconfirmed.text).toContain('提醒时间未确认')
    expect(presentTool(tool('todo_reminder_set', { result: { item: { ...item, remind_at: null } } })))
      .toEqual({ name: '取消提醒', status: '已取消提醒', text: '已取消提醒：测试' })
    expect(presentTool(tool('todo_reminder_set', { result: { item: { ...item, remind_at: 'not-a-time' } } })).status)
      .toBe('结果待确认')
  })
})

describe('memo presentation plugin', () => {
  beforeEach(() => {
    registerToolPresentation(memoPresentationPlugin)
  })

  function memoItem(overrides: Record<string, unknown> = {}) {
    return { id: 'm1', kind: 'note', title: '跑步计划', content: null, status: 'active', review_at: null, created_at: '2026-09-07T00:00:00Z', ...overrides }
  }

  it('keeps tool names and affects same-sourced with the memo plugin.json', () => {
    const expectedNames = memoManifest.tools.flatMap(entry => [entry.name, entry.handler_key])
    expect([...memoPresentationPlugin.toolNames].sort()).toEqual(expectedNames.sort())
    expect(memoPresentationPlugin.affects).toEqual(memoManifest.affects)
    expect(memoPresentationPlugin.affects).toEqual(['memo-list'])
    for (const name of expectedNames) {
      expect(presentTool(tool(name)).name).not.toBe(name)
    }
  })

  it('presents create/update/archive/review outcomes from real result items', () => {
    expect(presentTool(tool('memo_create', { result: { item: memoItem() } })))
      .toEqual({ name: '记录备忘', status: '执行成功', text: '已记录：跑步计划' })
    expect(presentTool(tool('memo_create', { result: { item: memoItem({ kind: 'goal' }) } })))
      .toEqual({ name: '记录长期目标', status: '执行成功', text: '已记录：跑步计划' })
    const scheduled = presentTool(tool('memo_create', { result: { item: memoItem({ review_at: '2036-09-09T07:15:00.000000Z' }) } }))
    expect(scheduled.name).toBe('记录备忘并设置回顾')
    expect(scheduled.text).toContain('已记录：跑步计划')
    expect(scheduled.text).toContain('回顾时间：')
    expect(presentTool(tool('memo_archive', { result: { item: memoItem({ status: 'archived' }) } })))
      .toEqual({ name: '归档备忘', status: '执行成功', text: '已归档：跑步计划' })
    expect(presentTool(tool('memo_archive', { result: { item: memoItem() } })))
      .toEqual({ name: '取消归档', status: '执行成功', text: '已取消归档：跑步计划' })
    expect(presentTool(tool('memo_review_set', { result: { item: memoItem() } })))
      .toEqual({ name: '取消回顾', status: '执行成功', text: '已取消回顾：跑步计划' })
    const review = presentTool(tool('memo_review_set', { result: { item: memoItem({ review_at: '2036-09-09T07:15:00.000000Z' }) } }))
    expect(review.name).toBe('设置回顾')
    expect(review.text).toContain('已设置回顾：跑步计划')
    expect(presentTool(tool('memo_list', { result: { items: [] } })))
      .toEqual({ name: '备忘列表', status: '执行成功', text: '当前没有备忘。' })
  })

  it('flags unconfirmed effects instead of implying success', () => {
    // A review write whose result dropped the requested time is not a success.
    const review = presentTool(tool('memo_review_set', { result: { item: memoItem({ title: undefined }) } }))
    expect(review.status).toBe('结果待确认')
    const scheduled = presentTool(tool('memo_create', { result: { item: memoItem({ review_at: 'not-a-time' }) } }))
    expect(scheduled.status).toBe('结果待确认')
    // Execution failures keep the generic failed status and no fabricated text.
    expect(presentTool(tool('memo_create', { status: 'failed', error: '回顾时间必须晚于当前时间' })))
      .toEqual({ name: '记录备忘', status: '失败', text: '' })
  })

  it('feeds only confirmed effect tools into the memo-list fingerprint', () => {
    const effect = tool('memo_create', { result: { item: memoItem() } })
    const before = toolEffectsFingerprint([effect], 'memo-list')
    const changed = tool('memo_create', { result: { item: memoItem({ status: 'archived' }) } })
    expect(toolEffectsFingerprint([changed], 'memo-list')).not.toBe(before)
    // Reads and failed tools stay inert, and the todo group ignores memo tools
    // (the todo plugin's fingerprint of memo-only tools is an empty list).
    const listed = tool('memo_list', { result: { items: [memoItem()] } })
    const failed = tool('memo_archive', { status: 'failed' })
    expect(toolEffectsFingerprint([effect, listed, failed], 'memo-list')).toBe(before)
    expect(toolEffectsFingerprint([effect], 'todo-list')).toBe('[[]]')
    // Todo effects still dispatch to their own group alongside memo's.
    const todoEffect = tool('todo_create', { result: { item: { id: 't1', title: '喝水', status: 'pending', remind_at: null } } })
    expect(toolEffectsFingerprint([todoEffect, effect], 'todo-list')).not.toBe('[]')
  })
})
