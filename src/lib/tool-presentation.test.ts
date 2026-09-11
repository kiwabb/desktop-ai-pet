import { beforeEach, describe, expect, it } from 'vitest'

import type { ToolCall } from './agent'
import manifest from '../../plugins/todo/plugin.json'
import {
  presentTool,
  registerToolPresentation,
  resetToolPresentations,
  toolEffectsFingerprint,
  type ToolPresentationPlugin,
} from './tool-presentation'
import { todoPresentationPlugin } from './todo/presentation'

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
    expect(presentation).toEqual({ name: '记录待办', status: '已完成', text: '已记录：喝水' })
  })

  it('degrades unknown tools to the generic shape without throwing (AC5)', () => {
    expect(() => presentTool(tool('some_future_tool'))).not.toThrow()
    expect(presentTool(tool('some_future_tool'))).toEqual({ name: '工具：some_future_tool', status: '已完成', text: '' })
    expect(presentTool(tool('some_future_tool', { status: 'running' })).status).toBe('执行中')
    expect(presentTool(tool('  ')).name).toBe('工具')
  })

  it('degrades gracefully when a plugin registration is removed (AC5)', () => {
    resetToolPresentations()
    expect(() => presentTool(tool('todo_create'))).not.toThrow()
    expect(presentTool(tool('todo_create'))).toEqual({ name: '工具：todo_create', status: '已完成', text: '' })
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
