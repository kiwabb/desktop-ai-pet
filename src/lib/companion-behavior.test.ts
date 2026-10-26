import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMPANION_IDLE_MS, createCompanionBehavior } from './companion-behavior'
import type { PetState } from './pet-state'

function setup() {
  vi.useFakeTimers()
  const states: PetState[] = []
  const behavior = createCompanionBehavior(state => states.push(state), {
    setTimeout: (fn, delay) => Number(setTimeout(fn, delay)),
    clearTimeout: handle => clearTimeout(handle),
  })
  return { states, behavior }
}
afterEach(() => vi.useRealTimers())
describe('local companion behavior', () => {
  it('rests after sustained inactivity and stays asleep until interaction', () => {
    const { states, behavior } = setup()
    vi.advanceTimersByTime(COMPANION_IDLE_MS - 1)
    expect(states).toEqual([])
    vi.advanceTimersByTime(1)
    expect(states.at(-1)).toBe('sleeping')
    vi.advanceTimersByTime(60_000)
    behavior.setActivity('error')
    expect(states.at(-1)).toBe('sleeping')
    behavior.interact()
    expect(states.at(-1)).toBe('happy')
    vi.advanceTimersByTime(1100)
    expect(states.at(-1)).toBe('idle')
    behavior.dispose()
  })
  it('keeps an explicit rest through agent completion and never fakes connection health', () => {
    const { states, behavior } = setup()
    behavior.setActivity('thinking')
    behavior.rest()
    behavior.setActivity('talking')
    behavior.setActivity('error')
    expect(states.at(-1)).toBe('sleeping')
    expect(states).not.toContain('error')
    behavior.wake()
    expect(states.at(-1)).toBe('idle')
    behavior.dispose()
  })
  it('renews interaction feedback without an old timer interrupting it and cleans up', () => {
    const { states, behavior } = setup()
    behavior.interact()
    vi.advanceTimersByTime(800)
    behavior.interact()
    vi.advanceTimersByTime(400)
    expect(states.at(-1)).toBe('happy')
    behavior.setActivity('talking')
    vi.advanceTimersByTime(700)
    expect(states.at(-1)).toBe('talking')
    vi.advanceTimersByTime(COMPANION_IDLE_MS)
    expect(states.at(-1)).toBe('talking')
    behavior.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
})
