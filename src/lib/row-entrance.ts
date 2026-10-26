import { motionDuration } from './motion'

const SETTLE_GRACE_MS = 80

/** Clear transient row state even if CSS motion is cancelled or never finishes. */
export function watchRowEntrance(row: HTMLElement, animationName: string, onSettled: () => void): () => void {
  let active = true
  const cleanup = () => {
    active = false
    window.clearTimeout(timer)
    row.removeEventListener('animationend', ended)
    row.removeEventListener('animationcancel', ended)
  }
  const settle = () => {
    if (!active) return
    cleanup()
    onSettled()
  }
  const ended = (event: AnimationEvent) => {
    if (event.target === row && event.animationName === animationName) settle()
  }
  const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 0 : motionDuration(row, 'normal', 180) + SETTLE_GRACE_MS
  const timer = window.setTimeout(settle, delay)
  row.addEventListener('animationend', ended)
  row.addEventListener('animationcancel', ended)
  return cleanup
}
