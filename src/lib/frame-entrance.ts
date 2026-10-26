import { motionDuration } from './motion'

const entranceAnimations = new Set(['component-chat-bloom', 'pet-chat-expand', 'integrated-content-arrive', 'integrated-content-dissolve', 'companion-panel-arrive'])
const SETTLE_GRACE_MS = 80

/** A suspended CSS timeline must never keep an otherwise interactive frame hidden. */
export function watchFrameEntrance(root: HTMLElement, onSettled: () => void): () => void {
  let active = true
  const cleanup = () => {
    active = false
    window.clearTimeout(timer)
    root.removeEventListener('animationend', ended)
    root.removeEventListener('animationcancel', ended)
  }
  const settle = () => {
    if (!active) return
    cleanup()
    onSettled()
  }
  const ended = (event: Event) => {
    if (entranceAnimations.has((event as AnimationEvent).animationName)) settle()
  }
  const timer = window.setTimeout(settle, motionDuration(root, 'slow', 240) + SETTLE_GRACE_MS)
  root.addEventListener('animationend', ended)
  root.addEventListener('animationcancel', ended)
  return cleanup
}
