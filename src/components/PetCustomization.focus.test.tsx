import { isValidElement } from 'react'
import type { ReactNode, ReactElement } from 'react'
import type { CustomizationView } from '../lib/customization'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const host = vi.hoisted(() => ({
  state: [] as unknown[], refs: [] as { current: unknown }[], deps: [] as unknown[][],
  stateIndex: 0, refIndex: 0, effectIndex: 0, effects: [] as (() => void)[],
  mutate: vi.fn(), view: null as CustomizationView | null,
  button: { focus: vi.fn(), scrollIntoView: vi.fn() }, input: { focus: vi.fn(), scrollIntoView: vi.fn() },
}))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const i = host.stateIndex++
    if (!(i in host.state)) host.state[i] = initial
    return [host.state[i], (next: unknown) => { host.state[i] = typeof next === 'function' ? next(host.state[i]) : next }]
  },
  useRef: (initial: unknown) => host.refs[host.refIndex++] ?? (host.refs[host.refIndex - 1] = { current: initial }),
  useEffect: () => {},
  useLayoutEffect: (effect: () => void, deps: unknown[]) => {
    const i = host.effectIndex++, old = host.deps[i]
    if (!old || deps.some((value, index) => value !== old[index])) { host.deps[i] = deps; host.effects.push(effect) }
  },
}))
vi.mock('../lib/useCustomization', () => ({ useCustomization: () => ({ view: host.view, available: true, error: null, mutate: host.mutate }) }))
import { PetCustomization } from './PetCustomization'
import { PetThemePreview } from './PetThemePicker'
type Props = { children?: ReactNode; ref?: { current: unknown }; type?: string; value?: string; placeholder?: string; disabled?: boolean; onClick?: () => void; onChange?: (event: { target: { value: string } }) => void; 'aria-expanded'?: boolean }
function flatten(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(flatten)
  return isValidElement<Props>(node) ? [node, ...flatten(node.props.children)] : []
}
let tree: ReactElement<Props>[]
function render(hidden = false) {
  host.stateIndex = host.refIndex = host.effectIndex = 0
  tree = flatten(PetCustomization({ hidden }))
  tree.forEach(node => { if (node.props.ref) node.props.ref.current = node.type === 'input' ? host.input : host.button })
  host.effects.splice(0).forEach(effect => effect())
}
function toggle() { tree.find(node => node.type === 'button' && typeof node.props['aria-expanded'] === 'boolean')!.props.onClick!() }
beforeEach(() => {
  host.view = null; host.state = []; host.refs = []; host.deps = []; host.effects = []
  vi.clearAllMocks(); render()
})
describe('image settings focus (isolated component handlers, no native layout claim)', () => {
  it('reveals the URL on explicit open, stays still while editing, and restores the opener on close', () => {
    expect(host.input.focus).not.toHaveBeenCalled()
    toggle(); render()
    expect(host.input.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(host.input.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
    tree.find(node => node.type === 'input' && node.props.type === 'url')!.props.onChange!({ target: { value: 'https://example.invalid/v1' } })
    render()
    expect(host.input.focus).toHaveBeenCalledOnce()
    expect(host.input.scrollIntoView).toHaveBeenCalledOnce()
    toggle(); render()
    expect(host.button.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(host.button.scrollIntoView).toHaveBeenCalledOnce()
  })
  it('does not steal focus when a pending open is superseded by hiding the page', () => {
    toggle(); render(true); render(false)
    expect(host.input.focus).not.toHaveBeenCalled()
    expect(host.input.scrollIntoView).not.toHaveBeenCalled()
  })
})

// Isolated UI command contract; no native/keychain/provider claims.
it('copies only the image model through IPC, applies returned address and never receives a key', async () => {
  toggle(); render()
  const button = () => tree.find(node => node.type === 'button' && node.props.children === '使用聊天连接')!
  expect(button().props.disabled).toBe(true)
  tree.find(node => node.type === 'input' && node.props.placeholder === '服务商提供的图片模型名称')!.props.onChange!({ target: { value: 'gpt-image-2' } })
  render()
  host.mutate.mockResolvedValue({ settings: { base_url: 'https://example.invalid/v1', model: 'gpt-image-2', has_key: true } })
  button().props.onClick!()
  await Promise.resolve(); await Promise.resolve(); render()
  expect(host.mutate).toHaveBeenCalledWith('use_chat_connection', { model: 'gpt-image-2' })
  expect(tree.find(node => node.type === 'input' && node.props.type === 'url')!.props.value).toBe('https://example.invalid/v1')
  expect(tree.find(node => node.type === 'input' && node.props.type === 'password')!.props.value).toBe('')
})

it('reuses a paid candidate only by explicit local selection and preserves omission on ordinary save', async () => {
  const id = 'pet'; const token = 'saved-candidate'
  host.view = { revision: 2, active_id: id, presets: [{ id, name: '小虎', accent: '#b3a469', created_at: 'test', assets: {} as never, badge: null }], job: null, badge_job: { id: 'badge-job', preset_id: id, status: 'ready', request_count: 1, result: token, error: null }, settings: { base_url: 'https://example.invalid/v1', model: 'image', has_key: false }, warning: null }
  render()
  tree.find(node => node.type === 'button' && flatten(node.props.children).length > 0 && JSON.stringify(node.props.children).includes('小虎'))!.props.onClick!()
  render()
  const save = () => tree.find(node => node.type === 'button' && node.props.children === '保存修改')!
  tree.find(node => node.type === 'input' && node.props.type === undefined && node.props.value === '')!.props.onChange!({ target: { value: '小虎' } })
  render(); host.mutate.mockResolvedValue(host.view)
  save().props.onClick!(); await Promise.resolve(); await Promise.resolve(); render()
  expect(host.mutate).toHaveBeenLastCalledWith('update', { id, name: '小虎', accent: '#d39964' })
  host.mutate.mockClear()
  tree.find(node => node.type === 'button' && node.props.children === '使用已生成猫爪')!.props.onClick!()
  render(); expect(host.mutate).not.toHaveBeenCalled()
  save().props.onClick!(); await Promise.resolve(); await Promise.resolve(); render()
  expect(host.mutate).toHaveBeenLastCalledWith('update', { id, name: '小虎', accent: '#d39964', badge: { action: 'select', token } })
})


it('shows a saved theme without fixed palette controls or analysis side effects', () => {
  const id = 'pet'
  host.view = { revision: 1, active_id: id, presets: [{ id, name: '三花', accent: '#d39964', created_at: '', assets: {} as never }], job: null, settings: { base_url: '', model: '', has_key: false }, warning: null }
  render()
  tree.find(node => node.type === 'button' && JSON.stringify(node.props.children).includes('三花'))!.props.onClick!(); render()
  expect(tree.some(node => node.type === PetThemePreview)).toBe(true)
  expect(tree.some(node => node.type === 'input' && node.props.type === 'color')).toBe(false)
  expect(host.mutate).not.toHaveBeenCalled()
})
