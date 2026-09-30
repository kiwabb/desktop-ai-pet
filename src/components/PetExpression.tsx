import { useEffect, useState } from 'react'
import type { PetState } from '../lib/pet-state'
import './PetExpression.css'

const companionIdle = '/pets/white-cat-companion/idle.png'
const companionSleeping = '/pets/white-cat-companion/sleeping.png'

/** One finite blink, suspended while hidden or under reduced motion. */
export function usePetBlink(state: PetState, enabled = true) {
  const [blinking, setBlinking] = useState(false)
  useEffect(() => {
    if (!enabled) { setBlinking(false); return }
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let next = 0
    let end = 0
    let disposed = false
    let first = true
    const clear = () => {
      window.clearTimeout(next)
      window.clearTimeout(end)
      setBlinking(false)
    }
    const schedule = () => {
      clear()
      if (!enabled || disposed || preference.matches || document.hidden || state === 'sleeping') return
      next = window.setTimeout(() => {
        first = false
        setBlinking(true)
        end = window.setTimeout(() => { setBlinking(false); schedule() }, 150)
      }, first && (state === 'curious' || state === 'happy') ? 700 : 4200 + Math.random() * 2600)
    }
    schedule()
    preference.addEventListener('change', schedule)
    document.addEventListener('visibilitychange', schedule)
    return () => {
      disposed = true
      window.clearTimeout(next)
      window.clearTimeout(end)
      preference.removeEventListener('change', schedule)
      document.removeEventListener('visibilitychange', schedule)
    }
  }, [state, enabled])
  return blinking || state === 'sleeping'
}

/** Decode before changing the existing SVG image href. Both poses share one
 * image node and the same matte; there is no crossfade or second silhouette. */
export function useCompanionSprite(state: PetState, enabled = true) {
  const [sleepingReady, setSleepingReady] = useState(false)
  const eyesClosed = usePetBlink(state, enabled && sleepingReady)
  useEffect(() => {
    if (!enabled) return
    let disposed = false
    const image = new Image()
    image.src = companionSleeping
    void image.decode().then(() => {
      if (!disposed) setSleepingReady(true)
    }).catch(() => {
      // Keep the already visible idle portrait if the optional pose is missing.
    })
    return () => { disposed = true }
  }, [enabled])
  return sleepingReady && eyesClosed ? companionSleeping : companionIdle
}

/** The old reference illustration keeps its own registered vector eyelids. */
export function PetExpression({ state }: { state: PetState }) {
  const blinking = usePetBlink(state)
  return (
    <svg className={`pet-expression${blinking ? ' is-blinking' : ''}`} viewBox="0 0 544 893" aria-hidden="true">
      <g className="pet-eyelids">
        <path d="M198 267Q201 251 216 253Q230 255 233 270Q228 286 215 285Q201 284 198 267Z" />
        <path d="M272 280Q275 264 289 267Q303 267 306 281Q300 295 287 295Q275 293 272 280Z" />
        <path className="pet-closed-eye" d="M201 270Q216 281 230 272M275 282Q288 291 303 281" />
      </g>
    </svg>
  )
}
