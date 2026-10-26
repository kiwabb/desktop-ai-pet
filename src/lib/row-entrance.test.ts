import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchRowEntrance } from './row-entrance'

describe.each(['todo-row-enter', 'conversation-arrive'])('%s lifecycle (isolated events and timers)', animationName => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '180ms' }))
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  // Only the DOM event boundary is doubled; no app APIs or records are used.
  const row = () => new EventTarget() as HTMLElement
  const animationEvent = (type: string, name = animationName) => Object.assign(new Event(type), { animationName: name })

  it('settles on the token-based deadline without any animation or RAF event', () => {
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '0.2s' }))
    const settled = vi.fn()
    watchRowEntrance(row(), animationName, settled)
    vi.advanceTimersByTime(279)
    expect(settled).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(settled).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['animationend', 'animationcancel'])('settles once on %s and removes listeners and timer', type => {
    const target = row()
    const removeListener = vi.spyOn(target, 'removeEventListener')
    const settled = vi.fn()
    watchRowEntrance(target, animationName, settled)
    target.dispatchEvent(animationEvent(type))
    target.dispatchEvent(animationEvent(type))
    vi.runAllTimers()
    expect(settled).toHaveBeenCalledOnce()
    expect(removeListener.mock.calls.map(([name]) => name)).toEqual(['animationend', 'animationcancel'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('settles immediately on the next timer turn when reduced motion disables CSS animation', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const settled = vi.fn()
    watchRowEntrance(row(), animationName, settled)
    vi.advanceTimersByTime(0)
    expect(settled).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores unrelated or descendant animation events', () => {
    const target = row()
    const settled = vi.fn()
    const cleanup = watchRowEntrance(target, animationName, settled)
    target.dispatchEvent(animationEvent('animationend', 'spinner'))
    target.dispatchEvent(animationEvent('animationend', animationName === 'todo-row-enter' ? 'conversation-arrive' : 'todo-row-enter'))
    const childEvent = animationEvent('animationcancel')
    Object.defineProperty(childEvent, 'target', { value: row() })
    target.dispatchEvent(childEvent)
    expect(settled).not.toHaveBeenCalled()
    cleanup()
  })

  it('settles a disabled animation by its original deadline before motion is enabled again', () => {
    let reduced = false
    vi.stubGlobal('matchMedia', () => ({ matches: reduced }))
    const target = row()
    const settled = vi.fn()
    watchRowEntrance(target, animationName, settled)
    vi.advanceTimersByTime(100)
    reduced = true
    // No cancellation event arrives after the system disables CSS animation.
    vi.advanceTimersByTime(160)
    expect(settled).toHaveBeenCalledOnce()
    reduced = false
    target.dispatchEvent(animationEvent('animationend'))
    vi.runAllTimers()
    expect(settled).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('removes the watcher on unmount without updating settled state', () => {
    const target = row()
    const settled = vi.fn()
    const cleanup = watchRowEntrance(target, animationName, settled)
    cleanup()
    target.dispatchEvent(animationEvent('animationend'))
    vi.runAllTimers()
    expect(settled).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('prevents a superseded entrance from clearing the next entrance', () => {
    const firstRow = row()
    const secondRow = row()
    let entering = 'first'
    const cleanupFirst = watchRowEntrance(firstRow, animationName, () => { entering = '' })
    vi.advanceTimersByTime(100)
    cleanupFirst()
    entering = 'second'
    watchRowEntrance(secondRow, animationName, () => { entering = '' })
    firstRow.dispatchEvent(animationEvent('animationcancel'))
    vi.advanceTimersByTime(160)
    expect(entering).toBe('second')
    secondRow.dispatchEvent(animationEvent('animationend'))
    expect(entering).toBe('')
    expect(vi.getTimerCount()).toBe(0)
  })
})
