import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Real panel handlers and element output, with isolated hook state. This checks
// reconciliation inputs, not native focus, browser layout or service behavior.
const host = vi.hoisted(() => ({
  state: [] as unknown[], refs: [] as { current: unknown }[], stateIndex: 0, refIndex: 0,
}))
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = host.stateIndex++
      if (!(index in host.state)) host.state[index] = typeof initial === 'function' ? initial() : initial
      return [host.state[index], (next: unknown) => {
        host.state[index] = typeof next === 'function' ? next(host.state[index]) : next
      }]
    },
    useRef: (initial: unknown) => host.refs[host.refIndex++] ?? (host.refs[host.refIndex - 1] = { current: initial }),
    useMemo: (factory: () => unknown) => factory(),
    useEffect: () => {},
    useLayoutEffect: () => {},
  }
})
vi.mock('./useChatReading', () => ({
  useChatReading: (): ReturnType<typeof import('./useChatReading').useChatReading> => ({
    listRef: { current: null },
    contentRef: { current: null },
    showLatest: false,
    onScroll: () => {},
    returnToLatest: () => {},
    prepareHistoryPrepend: () => {},
    prepareLayoutChange: () => {},
    cancelLayoutChange: () => {},
    captureSendIntent: () => 0,
    revealAcceptedSend: () => {},
    invalidateSendReveal: () => {},
    pauseForUpwardReading: () => {},
  }),
}))

import { ChatPanel } from './ChatPanel'
import { TodoList } from './TodoList'
import { MemoList } from './MemoList'
import { TodoReminders, ReminderSyncNotice } from './TodoReminders'
import { MemoReviewReminders } from './MemoReviewReminders'
import { AssistantSettings } from './AssistantSettings'

interface Props { children?: ReactNode; actions?: ReactNode; navigation?: ReactNode; footer?: ReactNode; [key: string]: unknown }
type Entry = { node: ReactElement<Props>; path: string }
function elements(node: ReactNode, path = 'root'): Entry[] {
  if (Array.isArray(node)) return node.flatMap((child, index) => elements(child, `${path}.${index}`))
  if (!isValidElement<Props>(node)) return []
  return [{ node, path }, ...['children', 'actions', 'navigation', 'footer'].flatMap(slot => {
    const child = node.props[slot]
    return isValidElement(child) || Array.isArray(child) ? elements(child, `${path}.${slot}`) : []
  })]
}

let tree: Entry[]
let expanded = false
function render() {
  host.stateIndex = 0
  host.refIndex = 0
  tree = elements(ChatPanel({
    appearance: 'companion', expanded, status: null, messages: [], tools: [], streaming: false,
    error: null, acceptedRequestId: null, onClose: () => {},
    onExpandedChange: (next, commit) => { expanded = next; commit?.() },
    onSend: () => { throw new Error('Navigation tests must not send') },
  }))
}
function find(predicate: (entry: Entry) => boolean) {
  const result = tree.find(predicate)
  if (!result) throw new Error('Missing expected panel element')
  return result
}
async function invoke(entry: Entry, prop: string) {
  const callback = entry.node.props[prop]
  if (typeof callback !== 'function') throw new Error(`Missing callback ${prop}`)
  await callback()
  render()
}
function button(label: string) { return find(({ node }) => node.type === 'button' && node.props['aria-label'] === label) }

beforeEach(() => {
  host.state = []
  host.refs = []
  expanded = false
  render()
})

describe('utility connection recovery navigation (unit evidence)', () => {
  it.each([
    { type: TodoList, label: '查看待办列表', back: '返回待办' },
    { type: MemoList, label: '查看备忘录', back: '返回备忘录' },
  ])('keeps $label at the same keyed position through settings and return', async ({ type, label, back }) => {
    await invoke(button(label), 'onClick')
    const before = find(({ node }) => node.type === type)
    expect(before.node.props.hidden).toBe(false)
    await invoke(before, 'onOpenSettings')
    const during = find(({ node }) => node.type === type)
    expect([during.path, during.node.type, during.node.key]).toEqual([before.path, before.node.type, before.node.key])
    expect(during.node.props.hidden).toBe(true)
    expect(tree.some(({ node }) => node.type === AssistantSettings)).toBe(true)
    expect(button('聊天').node.props['aria-current']).toBeUndefined()
    expect(button(label).node.props['aria-current']).toBeUndefined()
    await invoke(button(back), 'onClick')
    const after = find(({ node }) => node.type === type)
    expect([after.path, after.node.type, after.node.key]).toEqual([before.path, before.node.type, before.node.key])
    expect(after.node.props.hidden).toBe(false)
    expect(tree.some(({ node }) => node.type === AssistantSettings)).toBe(false)
    expect(button(label).node.props['aria-current']).toBe('page')
  })

  it('hides reminders in settings without replacing their mounted state', async () => {
    await invoke(button('展开阅读'), 'onClick')
    const before = [TodoReminders, MemoReviewReminders, ReminderSyncNotice].map(type => find(({ node }) => node.type === type))
    await invoke(button('配置助手服务'), 'onClick')
    const wrapper = find(({ node }) => node.props.className === 'chat-daily-reminders')
    expect(wrapper.node.props.hidden).toBe(true)
    expect(wrapper.node.props.style).toEqual({ display: 'none' })
    before.forEach(entry => {
      const during = find(({ node }) => node.type === entry.node.type)
      expect([during.path, during.node.key]).toEqual([entry.path, entry.node.key])
    })
    await invoke(button('返回聊天'), 'onClick')
    const restored = find(({ node }) => node.props.className === 'chat-daily-reminders')
    expect(restored.node.props.hidden).toBe(false)
    expect(restored.node.props.style).toEqual({ display: 'contents' })
  })
})
