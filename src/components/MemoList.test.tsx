import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

// Exercise the component's real event handlers with an in-memory hook host.
// These are unit interactions, not native/browser acceptance or service data.
const host = vi.hoisted(() => ({
  state: [] as unknown[], refs: [] as { current: unknown }[], deps: [] as unknown[][],
  stateIndex: 0, refIndex: 0, effectIndex: 0, effects: [] as (() => void)[],
  createMemo: vi.fn(),
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
    useId: () => 'memo-editor-unit',
    useMemo: (factory: () => unknown) => factory(),
    useEffect: () => {},
    useLayoutEffect: (effect: () => void, deps: unknown[]) => {
      const index = host.effectIndex++
      if (!host.deps[index] || deps.some((value, i) => value !== host.deps[index][i])) host.effects.push(effect)
      host.deps[index] = deps
    },
  }
})
vi.mock('../lib/agent', () => ({ createMemo: host.createMemo, listMemos: vi.fn(), archiveMemo: vi.fn() }))
import { MemoList } from './MemoList'

type Node = ReactElement<Record<string, any>>
function elements(node: ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  const element = node as Node
  return [element, ...elements(element.props.children)]
}
let tree: Node[]
const titleFocus = vi.fn()
const toggleFocus = vi.fn()
const openSettings = vi.fn()
let props: Parameters<typeof MemoList>[0]
function render(overrides: Partial<Parameters<typeof MemoList>[0]> = {}) {
  props = { ...props, ...overrides }
  host.stateIndex = 0
  host.refIndex = 0
  host.effectIndex = 0
  tree = elements(MemoList(props))
  const title = field('新备忘标题')
  title.props.ref.current = { focus: titleFocus }
  get('button', 'memo-editor-toggle').props.ref.current = { focus: toggleFocus }
  host.effects.splice(0).forEach(effect => effect())
}
function get(type: string, className: string) {
  const result = tree.find(node => node.type === type && node.props.className === className)
  if (!result) throw new Error(`Missing ${className}`)
  return result
}
function field(label: string) {
  const result = tree.find(node => node.props['aria-label'] === label)
  if (!result) throw new Error(`Missing ${label}`)
  return result
}
function clickToggle() { get('button', 'memo-editor-toggle').props.onClick(); render() }
function change(label: string, value: string) { field(label).props.onChange({ target: { value } }); render() }
function escape(overrides: Record<string, unknown> = {}) {
  const event = { key: 'Escape', nativeEvent: { isComposing: false, keyCode: 27 }, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...overrides }
  get('section', 'memo-list-view').props.onKeyDown(event)
  render()
  return event
}

beforeEach(() => {
  props = { generation: 4, refreshVersion: 0, onOpenSettings: openSettings }
  host.state = [{ kind: 'ready', items: [] }, 0, false]
  host.refs = []; host.deps = []; host.effects = []
  host.createMemo.mockReset(); titleFocus.mockReset(); toggleFocus.mockReset(); openSettings.mockReset()
  render()
  // The network loading effect is outside this editor-only unit harness.
  host.refs[3].current = false
})

describe('memo inline editor interactions (unit evidence)', () => {
  it('starts collapsed, opens intentionally and focuses the title', () => {
    expect(get('form', 'memo-add-form').props.hidden).toBe(true)
    expect(get('button', 'memo-editor-toggle').props['aria-expanded']).toBe(false)
    expect(titleFocus).not.toHaveBeenCalled()
    clickToggle()
    expect(get('form', 'memo-add-form').props.hidden).toBe(false)
    expect(titleFocus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('retains every draft field through collapse and reopen', () => {
    clickToggle()
    change('新备忘标题', '未提交的标题')
    change('备忘类型', 'goal')
    change('新备忘正文', '未提交的正文\n第二行')
    change('新备忘回顾时间', '2099-10-01T08:00')
    clickToggle()
    expect(get('form', 'memo-add-form').props.hidden).toBe(true)
    expect(toggleFocus).toHaveBeenCalledWith({ preventScroll: true })
    clickToggle()
    expect(field('新备忘标题').props.value).toBe('未提交的标题')
    expect(field('备忘类型').props.value).toBe('goal')
    expect(field('新备忘正文').props.value).toBe('未提交的正文\n第二行')
    expect(field('新备忘回顾时间').props.value).toBe('2099-10-01T08:00')
    expect(host.createMemo).not.toHaveBeenCalled()
  })

  it('Escape closes the editor before the page and keeps its draft', () => {
    clickToggle(); change('新备忘标题', '保留这段草稿')
    const event = escape()
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
    expect(get('form', 'memo-add-form').props.hidden).toBe(true)
    expect(field('新备忘标题').props.value).toBe('保留这段草稿')
    const closedEvent = escape()
    expect(closedEvent.stopPropagation).not.toHaveBeenCalled()
  })

  it('does not close on an IME Escape', () => {
    clickToggle()
    const event = escape({ nativeEvent: { isComposing: true, keyCode: 229 } })
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(get('form', 'memo-add-form').props.hidden).toBe(false)
  })

  it('respects Escape already consumed by an inner control', () => {
    clickToggle()
    const event = escape({ defaultPrevented: true })
    expect(event.stopPropagation).not.toHaveBeenCalled()
    expect(get('form', 'memo-add-form').props.hidden).toBe(false)
  })

  it('keeps pending save locked and preserves draft when that save fails', async () => {
    let rejectSave!: (cause: Error) => void
    host.createMemo.mockImplementation(() => new Promise((_resolve, reject) => { rejectSave = reject }))
    clickToggle(); change('新备忘标题', '等待保存的草稿')
    get('form', 'memo-add-form').props.onSubmit({ preventDefault: vi.fn() })
    render()
    expect(host.createMemo).toHaveBeenCalledOnce()
    expect(get('button', 'memo-editor-toggle').props.disabled).toBe(true)
    const event = escape()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
    expect(get('form', 'memo-add-form').props.hidden).toBe(false)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    rejectSave(new Error('unit-only save failure'))
    await Promise.resolve(); await Promise.resolve()
    render(); consoleError.mockRestore()
    expect(field('新备忘标题').props.value).toBe('等待保存的草稿')
    expect(get('button', 'memo-editor-toggle').props.disabled).toBe(false)
    expect(tree.some(node => node.props.role === 'alert')).toBe(true)
    escape()
    expect(get('form', 'memo-add-form').props.hidden).toBe(true)
  })

  it('explains unavailable save beside the control and offers guarded local recovery', () => {
    host.state[0] = { kind: 'error', message: '未能同步备忘，请重试。' }
    render(); clickToggle(); change('新备忘标题', '尚未保存的草稿')
    const save = field('添加备忘')
    const explanation = tree.find(node => node.props.id === save.props['aria-describedby'])
    expect(save.props.disabled).toBe(true)
    expect(explanation?.props.children).toContain('暂不能保存')
    expect(field('新备忘标题').props.readOnly).toBe(false)
    expect(tree.some(node => node.props.children === '留住值得记下的事')).toBe(false)
    const settings = tree.find(node => node.type === 'button' && node.props.children === '连接设置')
    settings?.props.onClick()
    expect(openSettings).toHaveBeenCalledOnce()
    const retry = field('重试同步备忘录')
    retry.props.onClick(); retry.props.onClick(); render()
    expect(host.state[1]).toBe(1)
    expect(field('重试同步备忘录').props.disabled).toBe(true)
    expect(field('新备忘标题').props.value).toBe('尚未保存的草稿')
    expect(host.createMemo).not.toHaveBeenCalled()
  })

  it('retains editor fields while hidden for settings without stealing focus', () => {
    clickToggle(); change('新备忘标题', '连接恢复后再保存')
    change('备忘类型', 'goal'); change('新备忘正文', '继续保留正文')
    change('新备忘回顾时间', '2099-10-01T08:00')
    titleFocus.mockClear()
    render({ hidden: true })
    expect(get('section', 'memo-list-view').props.hidden).toBe(true)
    expect(get('section', 'memo-list-view').props.style.display).toBe('none')
    expect(titleFocus).not.toHaveBeenCalled()
    expect(escape().stopPropagation).not.toHaveBeenCalled()
    render({ hidden: false })
    expect(get('form', 'memo-add-form').props.hidden).toBe(false)
    expect(field('新备忘标题').props.value).toBe('连接恢复后再保存')
    expect(field('备忘类型').props.value).toBe('goal')
    expect(field('新备忘正文').props.value).toBe('继续保留正文')
    expect(field('新备忘回顾时间').props.value).toBe('2099-10-01T08:00')
    expect(host.createMemo).not.toHaveBeenCalled()
  })

  it('keeps a previous list distinct from a failed initial load', () => {
    host.state[3] = '未能同步备忘，请重试。'
    render()
    expect(get('div', 'memo-list-recovery').props.children).toBeTruthy()
    expect(tree.some(node => node.props.children === '当前保留上次同步的列表。')).toBe(true)
    expect(tree.some(node => node.props.children === '留住值得记下的事')).toBe(true)
    expect(field('新备忘标题').props['aria-describedby']).toBeUndefined()
    render({ onOpenSettings: undefined })
    expect(tree.some(node => node.type === 'button' && node.props.children === '连接设置')).toBe(false)
  })
})
