import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Isolated timing/transport doubles only: no WebView, app records or UI actions.
const transport = vi.hoisted(() => ({
  handler: null as ((event: { payload: unknown }) => void) | null,
  emit: vi.fn<(name: string, value: Record<string, unknown>) => Promise<void>>(),
}))
vi.mock('@tauri-apps/api/event', () => ({
  emit: transport.emit,
  listen: async (_name: string, handler: (event: { payload: unknown }) => void) => { transport.handler = handler; return () => {} },
}))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'chat' }) }))

describe('motion diagnostic capture (isolated clock and events)', () => {
  let frames: Map<number, FrameRequestCallback>
  let nextFrame: number
  let eventWindow: EventTarget
  let reducedMotion: boolean
  const query = vi.fn<() => Element | null>()
  const reports = () => transport.emit.mock.calls.filter(([name]) => name === 'pet:motion-diagnostic-report').map(([, value]) => value)
  const command = async (phase: string, extras: Record<string, unknown> = {}) => {
    transport.handler?.({ payload: { id: 'isolated-1', mode: 'normal', action: 'none', targetLabel: 'chat', phase, ...extras } })
    await Promise.resolve()
    await Promise.resolve()
  }
  const frameAfter = (ms: number) => {
    vi.advanceTimersByTime(ms)
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach(callback => callback(performance.now()))
  }
  const install = async () => {
    const module = await import('./motion-diagnostics')
    await module.installMotionDiagnostics()
    return module
  }

  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
    vi.stubEnv('DEV', true)
    vi.stubEnv('MODE', 'test')
    transport.handler = null
    transport.emit.mockReset().mockResolvedValue(undefined)
    query.mockReset().mockReturnValue(null)
    frames = new Map()
    nextFrame = 1
    reducedMotion = false
    eventWindow = new EventTarget()
    vi.stubGlobal('window', Object.assign(eventWindow, {
      setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
      matchMedia: () => ({ matches: reducedMotion }), crypto: globalThis.crypto, isSecureContext: true,
    }))
    vi.stubGlobal('document', {
      createElement: () => ({ textContent: '' }), head: { append() {} },
      documentElement: { dataset: {} }, scripts: [], querySelector: query,
    })
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { const id = nextFrame++; frames.set(id, callback); return id }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => { frames.delete(id) }))
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it('keeps the unarmed immediate one-second sample and reports its exact interval seed', async () => {
    await install()
    await command('apply')
    await command('run')
    expect(frames.size).toBe(1)
    frameAfter(16)
    frameAfter(16)
    vi.advanceTimersByTime(968)
    expect(reports()).toEqual([expect.objectContaining({ protocol: 'phase-v5', rafSeedNow: 0, rafIntervals: [16, 16], completedNow: 1000 })])
    expect(reports()[0]).not.toHaveProperty('armOnNextTransition')
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('waits through tool latency and seeds synchronously before the first real route marker', async () => {
    const { markMotionDiagnostic } = await install()
    await command('apply', { armOnNextTransition: true })
    await command('run', { armOnNextTransition: true })
    vi.advanceTimersByTime(12_000)
    markMotionDiagnostic('route:chat-close-intent')
    expect(frames.size).toBe(0)
    expect(reports()).toHaveLength(0)
    reducedMotion = true
    markMotionDiagnostic('route:change-enter', { mode: 'expanded', chat: true })
    expect(frames.size).toBe(1) // Scheduled before the caller proceeds.
    frameAfter(16)
    markMotionDiagnostic('morph-start')
    frameAfter(16)
    markMotionDiagnostic('morph-end')
    vi.advanceTimersByTime(1468)
    expect(reports()).toHaveLength(1)
    expect(reports()[0]).toMatchObject({ armOnNextTransition: true, reducedMotion: true, rafSeedNow: 12_000, rafIntervals: [16, 16], completedNow: 13_500 })
    expect(reports()[0].marks).toEqual([
      expect.objectContaining({ name: 'request', now: 12_000 }),
      expect.objectContaining({ name: 'route:change-enter', now: 12_000 }),
      expect.objectContaining({ name: 'morph-start', now: 12_016 }),
      expect.objectContaining({ name: 'morph-end', now: 12_032 }),
    ])
    markMotionDiagnostic('route:change-enter')
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(reports()).toHaveLength(1)
  })

  it('reports a bounded no-trigger outcome and removes the armed callback', async () => {
    const { markMotionDiagnostic } = await install()
    await command('apply', { armOnNextTransition: true })
    await command('run', { armOnNextTransition: true })
    vi.advanceTimersByTime(30_000)
    expect(reports()).toEqual([expect.objectContaining({ error: 'transition-arm-timeout', rafSeedNow: null, rafIntervals: [] })])
    markMotionDiagnostic('route:change-enter')
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([false, true])('cancels while started=%s with no timer, RAF or callback left behind', async started => {
    const { markMotionDiagnostic } = await install()
    await command('apply', { armOnNextTransition: true })
    await command('run', { armOnNextTransition: true })
    if (started) markMotionDiagnostic('route:change-enter')
    await command('cancel', { id: 'unrelated-id' })
    expect(reports()).toHaveLength(0)
    await command('cancel')
    await command('cancel')
    markMotionDiagnostic('route:change-enter')
    vi.advanceTimersByTime(35_000)
    expect(reports()).toEqual([expect.objectContaining({ error: 'diagnostic-cancelled' })])
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('replaces an armed probe once and does not let an old cancel clear the new one', async () => {
    const { markMotionDiagnostic } = await install()
    await command('apply', { armOnNextTransition: true })
    await command('run', { armOnNextTransition: true })
    await command('apply', { id: 'isolated-2', armOnNextTransition: true })
    await command('run', { id: 'isolated-2', armOnNextTransition: true })
    await command('cancel')
    expect(reports()).toEqual([expect.objectContaining({ id: 'isolated-1', error: 'diagnostic-replaced' })])
    markMotionDiagnostic('route:change-enter')
    vi.advanceTimersByTime(1500)
    expect(reports()).toHaveLength(2)
    expect(reports()[1]).toMatchObject({ id: 'isolated-2', rafSeedNow: 0 })
    expect(reports()[1]).not.toHaveProperty('error')
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cleans up on pagehide', async () => {
    const { markMotionDiagnostic } = await install()
    await command('apply', { armOnNextTransition: true })
    await command('run', { armOnNextTransition: true })
    eventWindow.dispatchEvent(new Event('pagehide'))
    markMotionDiagnostic('route:change-enter')
    expect(reports()).toEqual([expect.objectContaining({ error: 'diagnostic-cancelled' })])
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports a sampler setup error without interrupting the real route', async () => {
    const { markMotionDiagnostic } = await install()
    await command('apply', { armOnNextTransition: true })
    await command('run', { armOnNextTransition: true })
    vi.mocked(requestAnimationFrame).mockImplementationOnce(() => { throw new Error('isolated RAF failure') })
    expect(() => markMotionDiagnostic('route:change-enter')).not.toThrow()
    expect(reports()).toEqual([expect.objectContaining({ error: 'diagnostic-handler-failed' })])
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([{ mode: 'none' }, { action: 'open' }, { armOnNextTransition: 'true' }])('rejects invalid arming %j before applying mode', async extra => {
    await install()
    await command('apply', { armOnNextTransition: true, ...extra })
    expect(transport.emit).toHaveBeenCalledWith('pet:motion-diagnostic-applied', expect.objectContaining({ error: 'invalid-arm-request' }))
    expect(document.documentElement.dataset.petMotionDiagnostic).toBeUndefined()
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores another WebView target and refuses a run without its matching apply', async () => {
    await install()
    await command('apply', { targetLabel: 'main', armOnNextTransition: true })
    expect(transport.emit.mock.calls.filter(([name]) => name === 'pet:motion-diagnostic-applied')).toHaveLength(0)
    await command('run', { armOnNextTransition: true })
    expect(reports()).toEqual([expect.objectContaining({ error: 'mode-not-applied' })])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('installs no diagnostics in an ordinary release', async () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('MODE', 'production')
    const { markMotionDiagnostic, motionDiagnosticMode } = await install()
    markMotionDiagnostic('route:change-enter')
    expect(transport.handler).toBeNull()
    expect(transport.emit).not.toHaveBeenCalled()
    expect(motionDiagnosticMode()).toBe('normal')
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
