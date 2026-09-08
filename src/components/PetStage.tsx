import { isTauri } from '@tauri-apps/api/core'
import { PhysicalPosition } from '@tauri-apps/api/dpi'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useRef, useState } from 'react'

import type { PetState } from '../lib/pet-state'
import { petStateLabel } from '../lib/pet-state'
import { getPetLiveStatus } from '../lib/pet-live-status'
import type { PetLiveStatus as LiveStatus } from '../lib/pet-live-status'
import type { PetRenderer } from '../lib/pet-2d-renderer'
import { PetLiveStatus } from './PetLiveStatus'
import { ReferenceHeartBurst, ReferenceSparkle, ReferenceStatusRays } from './ReferenceIllustrations'

const petPreview = '/pets/white-cat-v2/idle.png'
const closedReference = '/reference/desktop-pet-closed-reference.png'

export type PetStageMode = 'reference-closed' | 'animated'

interface PetStageProps {
  petState: PetState
  reply: string | null
  mode: PetStageMode
  liveStatus?: LiveStatus
  onPetInteract: () => void
  onToggleChat: () => void
  onContextMenu: () => void
}

export function PetStage({ petState, reply, mode, liveStatus = getPetLiveStatus(null, petState), onPetInteract, onToggleChat, onContextMenu }: PetStageProps) {
  const rendererHostRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<PetRenderer | null>(null)
  const windowPositionRef = useRef({ x: 0, y: 0 })
  const dragRef = useRef<{
    pointerId: number
    pointerX: number
    pointerY: number
    windowX: number
    windowY: number
    moved: boolean
  } | null>(null)
  const [rendererStatus, setRendererStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    if (mode !== 'animated') {
      setRendererStatus('loading')
      return
    }

    let disposed = false
    const host = rendererHostRef.current
    if (!host)
      return

    void import('../lib/pet-2d-renderer')
      .then(({ createPetRenderer }) => createPetRenderer())
      .then(async (renderer) => {
        if (disposed) {
          renderer.destroy()
          return
        }
        rendererRef.current = renderer
        await renderer.mount(host)
        if (!disposed) {
          renderer.setState(petState)
          setRendererStatus('ready')
        }
      })
      .catch((cause) => {
        console.error('2D pet renderer initialization failed', cause)
        if (!disposed)
          setRendererStatus('error')
      })

    return () => {
      disposed = true
      rendererRef.current?.destroy()
      rendererRef.current = null
    }
  }, [mode])

  useEffect(() => {
    rendererRef.current?.setState(petState)
  }, [petState])

  useEffect(() => {
    if (!isTauri())
      return
    const currentWindow = getCurrentWindow()
    void currentWindow.outerPosition().then((position) => {
      windowPositionRef.current = position
    })
    const unlistenPromise = currentWindow.onMoved(({ payload }) => {
      windowPositionRef.current = payload
    })
    return () => {
      unlistenPromise.then(unlisten => unlisten())
    }
  }, [])

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0)
      return
    const position = windowPositionRef.current
    dragRef.current = {
      pointerId: event.pointerId,
      pointerX: event.screenX,
      pointerY: event.screenY,
      windowX: position.x,
      windowY: position.y,
      moved: false,
    }
    rendererRef.current?.setDrag(true, 0)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId)
      return
    const deltaX = event.screenX - drag.pointerX
    const deltaY = event.screenY - drag.pointerY
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 5)
      return
    drag.moved = true
    rendererRef.current?.setDrag(true, deltaX / 90)
    if (isTauri()) {
      void getCurrentWindow().setPosition(new PhysicalPosition(
        drag.windowX + deltaX,
        drag.windowY + deltaY,
      ))
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    dragRef.current = null
    rendererRef.current?.setDrag(false, 0)
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    if (drag && !drag.moved) {
      onPetInteract()
      onToggleChat()
    }
  }

  return (
    <section
      className={`pet-stage pet-stage-${mode} pet-state-${petState}`}
      aria-label={`白猫助手，${petStateLabel[petState]}`}
    >
      {mode === 'reference-closed' && (
        <PetLiveStatus status={liveStatus}>
          <img
            className="closed-reference-art"
            src={closedReference}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
        </PetLiveStatus>
      )}

      {mode === 'animated' && reply && <div className="pet-reply-bubble" aria-live="polite">{reply}</div>}

      {mode === 'animated' && (
        <>
          <div className="pet-status" aria-live="polite">
            <span className="status-dot" />
            <span className="pet-status-copy">
              <strong>{petStateLabel[petState]}</strong>
              <small>在线中 · 随时待命 <span className="status-heart" aria-hidden="true">♥</span></small>
            </span>
          </div>
          <ReferenceStatusRays className="pet-status-rays" />
        </>
      )}

      <div
        className="pet-character-hitbox"
        role="button"
        tabIndex={0}
        aria-label="点击白猫打开对话"
        title="点击打开对话"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          dragRef.current = null
          rendererRef.current?.setDrag(false, 0)
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onContextMenu()
        }}
        onClick={(event) => {
          // Pointer clicks are handled on pointer-up so dragging never toggles
          // the panel. A zero-detail click is an accessibility/keyboard press.
          if (event.detail !== 0)
            return
          onPetInteract()
          onToggleChat()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onPetInteract()
            onToggleChat()
          }
        }}
      >
        {mode === 'animated' && (
          <>
            <ReferenceSparkle className="pet-side-sparkle" />
            <ReferenceHeartBurst className="pet-heart-burst" />
            <div
              ref={rendererHostRef}
              className={`pet-render-stage${rendererStatus === 'ready' ? ' is-ready' : ''}`}
              aria-label="白猫桌宠动画"
            />

            <img
              className={`pet-preview pet-fallback${rendererStatus === 'ready' ? ' is-hidden' : ''}`}
              src={petPreview}
              alt={rendererStatus === 'ready' ? '' : '白猫桌面助手插画兜底'}
              aria-hidden={rendererStatus === 'ready'}
              draggable={false}
            />
          </>
        )}
      </div>

      {mode === 'animated' && rendererStatus !== 'ready' && (
        <div className="preview-label">
          {rendererStatus === 'loading' && '正在加载白猫…'}
          {rendererStatus === 'error' && '动画加载失败 · 插画模式'}
        </div>
      )}

    </section>
  )
}
