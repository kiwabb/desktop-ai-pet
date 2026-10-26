import { invoke, isTauri } from '@tauri-apps/api/core'
import { useEffect, useRef } from 'react'
import type { PointerEvent } from 'react'

interface DragOrigin {
  main_x: number
  main_y: number
  chat_x: number
  chat_y: number
  scale: number
}
interface DragSession {
  id: number
  key: string
  x: number
  y: number
  moved: boolean
  cancelled: boolean
  origin: Promise<DragOrigin | null>
  pending: { x: number; y: number } | null
  running: boolean
  work: Promise<void>
}

/** Shared pointer contract for the cat and the chat header. Native commands move
 * both windows from one captured origin, and never resize either backing. */
export function usePetGroupDrag({ onClick, onError, onDrag, canStart }: {
  onClick?: () => void
  onError?: (cause: unknown) => void
  onDrag?: (dragging: boolean, deltaX: number) => void
  canStart?: (target: HTMLElement) => boolean
}) {
  const sessionRef = useRef<DragSession | null>(null)
  const lastSessionRef = useRef<DragSession | null>(null)
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = queueRef.current.then(operation)
    queueRef.current = result.catch(() => {})
    return result
  }
  useEffect(() => () => {
    const session = sessionRef.current
    if (session) { session.cancelled = true; session.pending = null }
    sessionRef.current = null
    if (session && isTauri()) void session.work.then(() => enqueue(() => invoke('end_pet_group_drag', { dragId: session.key }))).catch(() => {})
  }, [])

  function drain(session: DragSession): Promise<void> {
    if (session.running) return session.work
    session.running = true
    session.work = (async () => {
      try {
        const origin = await session.origin
        if (!origin) return
        while (session.pending && !session.cancelled) {
          const delta = session.pending
          session.pending = null
          await enqueue(() => invoke('move_pet_group', { origin, deltaX: delta.x, deltaY: delta.y }))
        }
      } catch (cause) {
        session.cancelled = true
        session.pending = null
        onError?.(cause)
      } finally { session.running = false }
    })()
    return session.work
  }

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    const target = event.target
    if (event.button !== 0 || !event.isPrimary || !(target instanceof Element)) return
    const hit = target instanceof HTMLElement ? target : target.parentElement
    if (!hit || canStart?.(hit) === false) return
    event.preventDefault()
    event.stopPropagation()
    // preventDefault suppresses native focus; explicitly preserve keyboard
    // access after a pointer interaction with the pet itself.
    if (event.currentTarget.getAttribute('role') === 'button') event.currentTarget.focus({ preventScroll: true })
    const previous = lastSessionRef.current
    if (previous) { previous.cancelled = true; previous.pending = null }
    const key = crypto.randomUUID()
    const session: DragSession = {
      key, work: Promise.resolve(),
      id: event.pointerId, x: event.screenX, y: event.screenY, moved: false,
      cancelled: false, pending: null, running: false,
      origin: isTauri() ? enqueue(() => invoke<DragOrigin>('pet_drag_origin', { dragId: key })).catch(cause => { onError?.(cause); return null }) : Promise.resolve(null),
    }
    sessionRef.current = session
    lastSessionRef.current = session
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const session = sessionRef.current
    if (!session || session.id !== event.pointerId || session.cancelled) return
    const x = event.screenX - session.x, y = event.screenY - session.y
    if (!session.moved && Math.hypot(x, y) < 5) return
    session.moved = true
    onDrag?.(true, x)
    session.pending = { x, y }
    void drain(session)
  }

  function finish(event: PointerEvent<HTMLElement>, cancelled: boolean) {
    const session = sessionRef.current
    if (!session || session.id !== event.pointerId) return
    if (!cancelled) onPointerMove(event)
    sessionRef.current = null
    if (cancelled) { session.cancelled = true; session.pending = null }
    onDrag?.(false, 0)
    if (isTauri()) void drain(session).then(() => enqueue(() => invoke('end_pet_group_drag', { dragId: session.key }))).catch(onError)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!cancelled && !session.moved) onClick?.()
  }
  return {
    onPointerDown, onPointerMove,
    onPointerUp: (event: PointerEvent<HTMLElement>) => finish(event, false),
    onPointerCancel: (event: PointerEvent<HTMLElement>) => finish(event, true),
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => finish(event, true),
  }
}
