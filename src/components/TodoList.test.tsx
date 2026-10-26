import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'

// Unit-only hook host: exercise recovery and draft handlers without a service,
// database or browser. Native focus and layout have separate acceptance.
const host = vi.hoisted(() => ({
  state: [] as unknown[], refs: [] as { current: unknown }[],
  stateIndex: 0, refIndex: 0, effects: [] as (() => void)[], createTodo: vi.fn(),
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
    useId: () => 'todo-availability-unit',
    useMemo: (factory: () => unknown) => factory(),
    useEffect: () => {},
    useLayoutEffect: (effect: () => void) => { host.effects.push(effect) },
  }
})
vi.mock('../lib/agent', () => ({
  createTodo: host.createTodo, listTodos: vi.fn(), completeTodo: vi.fn(),
  deleteTodo: vi.fn(), reopenTodo: vi.fn(), setTodoReminder: vi.fn(), updateTodoTitle: vi.fn(),
}))
import { TodoList } from './TodoList'

interface NodeProps {
  children?: ReactNode
  className?: string
  id?: string
  value?: string
  hidden?: boolean
  readOnly?: boolean
  disabled?: boolean
  style?: CSSProperties
  ref?: { current: unknown }
  'aria-label'?: string
  'aria-describedby'?: string
  onClick?: () => void
  onChange?: (event: { target: { value: string } }) => void
}
type Node = ReactElement<NodeProps>
function elements(node: ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<NodeProps>(node)) return []
  return [node, ...elements(node.props.children)]
}
let tree: Node[]
let props: Parameters<typeof TodoList>[0]
const openSettings = vi.fn()
function render(overrides: Partial<Parameters<typeof TodoList>[0]> = {}) {
  props = { ...props, ...overrides }
  host.stateIndex = 0; host.refIndex = 0
  tree = elements(TodoList(props))
  host.effects.splice(0).forEach(effect => effect())
}
function field(label: string) {
  const found = tree.find(node => node.props['aria-label'] === label)
  if (!found) throw new Error(`Missing ${label}`)
  return found
}
function changeTitle(value: string) {
  field('新待办标题').props.onChange?.({ target: { value } }); render()
}

beforeEach(() => {
  props = { generation: 4, refreshVersion: 0, onOpenSettings: openSettings }
  host.state = [{ kind: 'error', message: '未能同步待办，请重试。' }, 0, false]
  host.refs = []; host.effects = []; host.createTodo.mockReset(); openSettings.mockReset()
  render()
  // The network effect is not executed by this handler-only host.
  host.refs[4].current = false
})

describe('Todo recovery and draft availability (unit evidence)', () => {
  it('keeps the draft editable while explaining unavailable add and providing recovery', () => {
    changeTitle('先写下这件事')
    const add = field('添加待办')
    expect(add.props.disabled).toBe(true)
    expect(field('新待办标题').props.readOnly).toBe(false)
    const explanation = tree.find(node => node.props.id === add.props['aria-describedby'])
    expect(explanation?.props.children).toContain('暂不能添加')
    expect(tree.some(node => node.props.children === '当前没有待办事项')).toBe(false)
    const settings = tree.find(node => node.type === 'button' && node.props.children === '连接设置')
    settings?.props.onClick?.()
    expect(openSettings).toHaveBeenCalledOnce()
    const retry = field('重试同步待办')
    retry.props.onClick?.(); retry.props.onClick?.(); render()
    expect(host.state[1]).toBe(1)
    expect(field('重试同步待办').props.disabled).toBe(true)
    expect(field('新待办标题').props.value).toBe('先写下这件事')
    expect(host.createTodo).not.toHaveBeenCalled()
  })

  it('retains the draft while its settings route hides the list', () => {
    changeTitle('设置回来后继续')
    render({ hidden: true })
    expect(field('待办列表').props.hidden).toBe(true)
    expect(field('待办列表').props.style?.display).toBe('none')
    render({ hidden: false })
    expect(field('新待办标题').props.value).toBe('设置回来后继续')
    expect(host.createTodo).not.toHaveBeenCalled()
  })

  it('defers a pending control-focus restoration until the list is visible', () => {
    const focus = vi.fn()
    const titleRef = field('新待办标题').props.ref
    if (!titleRef) throw new Error('Missing title ref')
    titleRef.current = { focus }
    // Model an already queued focus target after a confirmed row operation.
    host.refs[10].current = 'add'
    render({ hidden: true })
    expect(focus).not.toHaveBeenCalled()
    render({ hidden: false })
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('retains the last known list after a refresh failure and omits an absent settings callback', () => {
    host.state[0] = { kind: 'ready', items: [] }
    host.state[3] = '未能同步待办，请重试。'
    render({ onOpenSettings: undefined })
    expect(tree.some(node => node.props.children === '当前保留上次同步的列表。')).toBe(true)
    expect(tree.some(node => node.props.children === '当前没有待办事项')).toBe(true)
    expect(field('新待办标题').props['aria-describedby']).toBeUndefined()
    expect(tree.some(node => node.type === 'button' && node.props.children === '连接设置')).toBe(false)
  })
})
