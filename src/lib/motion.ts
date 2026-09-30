/** CSS tokens remain the timing authority for JS-driven compositor motion. */
export function motionDuration(element: Element, token: 'fast' | 'normal' | 'slow' | 'exit', fallback: number) {
  const value = getComputedStyle(element).getPropertyValue(`--motion-${token}`).trim()
  const amount = Number.parseFloat(value)
  return Number.isFinite(amount) && amount >= 0 ? amount * (value.endsWith('ms') ? 1 : 1000) : fallback
}
export const MOTION_EASE_OUT = 'cubic-bezier(.16,1,.3,1)'
