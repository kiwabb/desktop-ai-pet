import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchFrameEntrance } from './frame-entrance'

describe('frame entrance recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '240ms' }))
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  function animationEvent(type: string, name = 'integrated-content-arrive') {
    return Object.assign(new Event(type), { animationName: name })
  }

  it('settles without RAF or CSS animation events when the timeline stalls', () => {
    const settled = vi.fn()
    watchFrameEntrance(new EventTarget() as HTMLElement, settled)
    vi.advanceTimersByTime(239)
    expect(settled).not.toHaveBeenCalled()
    vi.advanceTimersByTime(81)
    expect(settled).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['animationend', 'animationcancel'])('settles once on %s and removes the watchdog', type => {
    const root = new EventTarget() as HTMLElement
    const settled = vi.fn()
    watchFrameEntrance(root, settled)
    root.dispatchEvent(animationEvent(type))
    root.dispatchEvent(animationEvent(type))
    vi.runAllTimers()
    expect(settled).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores unrelated message animations and cancels cleanly on hide/unmount', () => {
    const root = new EventTarget() as HTMLElement
    const settled = vi.fn()
    const cleanup = watchFrameEntrance(root, settled)
    root.dispatchEvent(animationEvent('animationend', 'message-enter'))
    expect(settled).not.toHaveBeenCalled()
    cleanup()
    root.dispatchEvent(animationEvent('animationend'))
    vi.runAllTimers()
    expect(settled).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('settles the independent companion entrance on its own animation event', () => {
    const root = new EventTarget() as HTMLElement
    const settled = vi.fn()
    watchFrameEntrance(root, settled)
    root.dispatchEvent(animationEvent('animationend', 'companion-panel-arrive'))
    expect(settled).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
