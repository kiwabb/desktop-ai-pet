import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { CustomizationView } from './customization'
import type { CustomizationController } from './useCustomization'
const host = vi.hoisted(() => ({
  slots: [] as { value?: unknown; deps?: unknown[]; cleanup?: () => void }[], cursor: 0,
  pending: [] as (() => void)[], dirty: false,
  ipc: vi.fn(), subscribe: vi.fn(), assets: vi.fn(), event: null as null | ((event: { payload: CustomizationView }) => void),
}))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: host.ipc }))
vi.mock('@tauri-apps/api/event', () => ({ listen: host.subscribe }))
vi.mock('./customization', async original => ({ ...await original<typeof import('./customization')>(), loadPetAppearance: host.assets }))
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>()
  const changed = (old: unknown[] | undefined, next: unknown[]) => !old || old.length !== next.length || old.some((value, index) => !Object.is(value, next[index]))
  return { ...actual,
    useRef: (initial: unknown) => { const slot = host.slots[host.cursor] ??= { value: { current: initial } }; host.cursor++; return slot.value },
    useState: (initial: unknown) => {
      const slot = host.slots[host.cursor] ??= { value: initial }; host.cursor++
      return [slot.value, (value: unknown) => { const next = typeof value === 'function' ? value(slot.value) : value; if (!Object.is(next, slot.value)) { slot.value = next; host.dirty = true } }]
    },
    useCallback: (callback: unknown, deps: unknown[]) => { const slot = host.slots[host.cursor] ??= {}; host.cursor++; if (changed(slot.deps, deps)) { slot.value = callback; slot.deps = deps } return slot.value },
    useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
      const slot = host.slots[host.cursor] ??= {}; host.cursor++
      if (changed(slot.deps, deps)) { slot.deps = deps; host.pending.push(() => { slot.cleanup?.(); slot.cleanup = effect() || undefined }) }
    },
  }
})
import { CustomizationProvider } from './useCustomization'
const sprites = { base: 'base', closed: 'closed', happy: 'happy', talk: 'talk' }
const preset = { id: 'pet', name: '伙伴', accent: '#d39964', created_at: '', assets: Object.fromEntries(['base', 'closed', 'happy', 'talk'].map(kind => [kind, { width: 768, height: 960, anchor_x: 384, anchor_y: 928 }])) }
function view(revision: number, active = 'pet'): CustomizationView { return { revision, active_id: active, presets: [preset] as CustomizationView['presets'], job: null, settings: { base_url: '', model: '', has_key: false }, warning: null } }
let controller: CustomizationController
function render() { host.cursor = 0; host.dirty = false; controller = CustomizationProvider({ children: null }).props.value; host.pending.splice(0).forEach(effect => effect()) }
async function settle() { for (let i = 0; i < 12; i++) { await Promise.resolve(); if (host.dirty) render() } }
beforeEach(() => {
  host.slots = []; host.cursor = 0; host.pending = []; host.dirty = false; host.ipc.mockReset(); host.assets.mockReset(); host.subscribe.mockReset()
  host.subscribe.mockImplementation(async (_event, callback) => { host.event = callback; return vi.fn() })
  host.ipc.mockResolvedValue(view(1)); host.assets.mockImplementation(async p => ({ pet: { preset: p, sprites, badge: p.badge ?? null }, warning: null }))
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('document', { documentElement: { toggleAttribute: vi.fn(), removeAttribute: vi.fn(), style: { setProperty: vi.fn(), removeProperty: vi.fn() } } })
})
afterEach(() => { host.slots.forEach(slot => slot.cleanup?.()); vi.unstubAllGlobals() })

describe('appearance synchronization (isolated hook tests, no native runtime)', () => {
  it('subscribes before fetch and ignores progress-only revisions for asset decoding', async () => {
    render(); expect(host.subscribe).toHaveBeenCalledOnce(); expect(host.ipc).not.toHaveBeenCalled()
    await settle(); expect(controller.active?.preset.id).toBe('pet'); expect(host.assets).toHaveBeenCalledOnce()
    host.event?.({ payload: view(2) }); await settle()
    host.event?.({ payload: view(3) }); await settle()
    expect(host.assets).toHaveBeenCalledOnce()
  })
  it('synchronizes a secondary-color-only saved edit without decoding sprites or accepting stale revisions', async () => {
    render(); await settle()
    const changed = view(2)
    changed.presets = [{ ...changed.presets[0], theme: { palette: 'mint', primary: '#459f87', secondary: '#c5b567', strength: 80 } }]
    host.event?.({ payload: changed }); await settle()
    expect(controller.active?.preset.theme?.secondary).toBe('#c5b567')
    const newer = view(3)
    newer.presets = [{ ...changed.presets[0], theme: { ...changed.presets[0].theme!, secondary: '#d68ba4' } }]
    host.event?.({ payload: newer }); await settle()
    host.event?.({ payload: changed }); await settle()
    expect(controller.active?.preset.theme?.secondary).toBe('#d68ba4')
    expect(host.assets).toHaveBeenCalledOnce()
  })
  it('refreshes same-revision analysis service metadata without starting analysis', async () => {
    render(); await settle()
    host.ipc.mockResolvedValue({ ...view(1), theme_service: { base_url: 'https://vision.example/v1', model: 'vision', available: true } })
    await controller.refresh(); await settle()
    expect(controller.view?.theme_service?.model).toBe('vision')
    expect(host.ipc.mock.calls.every(([command]) => command === 'customization_view')).toBe(true)
    host.ipc.mockResolvedValue({ ...view(1), theme_service: null })
    await controller.refresh(); await settle()
    expect(controller.view?.theme_service).toBeNull()
  })
  it('retries a transient asset failure even when authoritative revision is unchanged', async () => {
    host.assets.mockRejectedValueOnce(new Error('decode')).mockResolvedValue({ pet: { preset, sprites }, warning: null })
    render(); await settle(); expect(controller.error).toContain('图片读取失败'); expect(controller.active).toBeNull()
    await controller.refresh(); await settle()
    expect(host.assets).toHaveBeenCalledTimes(2); expect(controller.active?.preset.id).toBe('pet'); expect(controller.error).toBeNull()
  })
  it('fences a late image decode after restoring default', async () => {
    let resolve!: (value: unknown) => void
    host.assets.mockReturnValue(new Promise(done => { resolve = done }))
    render(); await settle()
    host.event?.({ payload: view(2, 'default') }); await settle()
    resolve({ pet: { preset, sprites }, warning: null }); await settle(); expect(controller.active).toBeNull()
  })
  it('refreshes a same-preset badge and fences an older badge decode', async () => {
    render(); await settle()
    let resolveOld!: (value: unknown) => void
    host.assets.mockImplementationOnce(() => new Promise(done => { resolveOld = done }))
    const older = view(2); older.presets = [{ ...older.presets[0], badge: 'older' }]
    host.event?.({ payload: older }); await settle()
    const newer = view(3); newer.presets = [{ ...newer.presets[0], badge: 'newer' }]
    host.event?.({ payload: newer }); await settle()
    expect(controller.active?.badge).toBe('newer')
    resolveOld({ pet: { preset: older.presets[0], sprites, badge: 'older' }, warning: null })
    await settle(); expect(controller.active?.badge).toBe('newer')
    host.event?.({ payload: view(4) }); await settle()
    expect(controller.active?.badge).toBeNull()
  })
  it('keeps a committed notification warning returned after same-revision event', async () => {
    render(); await settle()
    host.event?.({ payload: view(2) }); await settle()
    host.ipc.mockResolvedValue({ ...view(2), warning: '已保存，通知失败' })
    await controller.mutate('update'); await settle()
    expect(controller.view?.warning).toBe('已保存，通知失败')
  })
})
