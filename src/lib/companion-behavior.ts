import type { PetState } from './pet-state'

export const COMPANION_IDLE_MS = 120_000
const RESPONSE_MS = 1100

type Activity = 'idle' | 'thinking' | 'talking'
interface Clock {
  setTimeout: (callback: () => void, delay: number) => number
  clearTimeout: (handle: number) => void
}

/** Local pet feedback only. No model result or connection state is invented. */
export function createCompanionBehavior(publish: (state: PetState) => void, clock: Clock) {
  let activity: Activity = 'idle'
  let resting = false
  let reacting = false
  let disposed = false
  let idleTimer: number | undefined
  let reactionTimer: number | undefined
  const settle = () => { if (!disposed) publish(resting ? 'sleeping' : activity) }
  const clearReaction = () => {
    if (reactionTimer !== undefined) clock.clearTimeout(reactionTimer)
    reactionTimer = undefined
    reacting = false
  }
  const scheduleRest = () => {
    if (idleTimer !== undefined) clock.clearTimeout(idleTimer)
    idleTimer = undefined
    if (resting || disposed || activity !== 'idle') return
    idleTimer = clock.setTimeout(() => {
      idleTimer = undefined
      resting = true
      clearReaction()
      settle()
    }, COMPANION_IDLE_MS)
  }
  scheduleRest()
  return {
    interact() {
      resting = false
      clearReaction()
      reacting = true
      publish('happy')
      scheduleRest()
      reactionTimer = clock.setTimeout(() => { reactionTimer = undefined; reacting = false; settle() }, RESPONSE_MS)
    },
    wake() { resting = false; clearReaction(); settle(); scheduleRest() },
    rest() { resting = true; clearReaction(); scheduleRest(); settle() },
    setActivity(state: PetState) {
      const next = state === 'thinking' || state === 'talking' ? state : 'idle'
      if (next === activity) return
      activity = next
      if (!reacting) settle()
      scheduleRest()
    },
    isResting: () => resting,
    dispose() {
      disposed = true
      clearReaction()
      if (idleTimer !== undefined) clock.clearTimeout(idleTimer)
    },
  }
}
