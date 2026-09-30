import { useEffect, useId, useRef, useState } from 'react'
import { Heart, MessageCircle, MoreHorizontal } from 'lucide-react'

import { usePetGroupDrag } from '../lib/usePetGroupDrag'
import type { PetState } from '../lib/pet-state'
import { petStateLabel } from '../lib/pet-state'
import { getPetLiveStatus } from '../lib/pet-live-status'
import type { PetLiveStatus as LiveStatus } from '../lib/pet-live-status'
import type { PetRenderer } from '../lib/pet-2d-renderer'
import { PetLiveStatus } from './PetLiveStatus'
import { PetExpression, useCompanionSprite } from './PetExpression'
import { ReferenceHeartBurst, ReferenceSparkle, ReferenceStatusRays } from './ReferenceIllustrations'

const petPreview = '/pets/white-cat-v2/idle.png'
const closedReference = '/reference/desktop-pet-closed-reference.png'

export type PetStageMode = 'companion' | 'reference-closed' | 'animated'

interface PetStageProps {
  petState: PetState
  reply: string | null
  mode: PetStageMode
  liveStatus?: LiveStatus
  panelOpen?: boolean
  opening?: boolean
  actionError?: string | null
  onPetWake?: () => void
  onPetInteract: () => void
  onToggleChat: () => void
  onContextMenu: () => void
}

export function PetStage({ petState, reply, mode, panelOpen = false, opening = false, actionError = null, liveStatus = getPetLiveStatus(null, petState), onPetInteract, onPetWake, onToggleChat, onContextMenu }: PetStageProps) {
  const maskId = useId()
  const companionSprite = useCompanionSprite(petState, mode === 'companion')
  const rendererHostRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<PetRenderer | null>(null)
  const latestStateRef = useRef(petState)
  latestStateRef.current = petState
  const [dragging, setDragging] = useState(false)
  const [dragError, setDragError] = useState<string | null>(null)
  const groupDrag = usePetGroupDrag({
    onClick: onPetInteract,
    onDrag: (active, deltaX) => { if (active && !dragging) onPetWake?.(); setDragging(active); setDragError(null); rendererRef.current?.setDrag(active, deltaX / 90) },
    onError: () => { setDragging(false); setDragError('无法移动，松开后重试') },
  })
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
          renderer.setState(latestStateRef.current)
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


  return (
    <section
      className={`pet-stage pet-stage-${mode} pet-state-${petState}${dragging ? ' is-dragging' : ''}`}
      aria-label={`白猫助手，${petStateLabel[petState]}`}
    >
      {mode === 'companion' && (
        <>
          <div className="companion-cat-motion" aria-hidden="true">
            <svg className="companion-cat-art" viewBox="0 0 1207 1303" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
              <defs><mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="1207" height="1303" style={{ maskType: 'luminance' }}>
                <image href="/pets/white-cat-companion/idle-mask.png" width="1207" height="1303" />
              </mask></defs>
              <image href={companionSprite} width="1207" height="1303" mask={`url(#${maskId})`} />
            </svg>
          </div>
          <div className="companion-feedback" role="status">
            {dragError || (dragging ? '松手停在这里' : petState === 'happy' ? '呼噜，收到你的摸摸' : '')}
          </div>
        </>
      )}

      {mode === 'reference-closed' && (
        <div className="pet-closed-figure">
          <div className="pet-closed-accent">
            <PetLiveStatus status={dragError ? { title: '拖动失败', detail: '松开后重试', tone: 'error', accessibleLabel: dragError } : dragging ? { title: '跟着你', detail: '松手停在这里', tone: 'neutral', accessibleLabel: '正在移动桌宠，松手停在这里' } : liveStatus}>
              <img
                className="closed-reference-art"
                src={closedReference}
                alt=""
                aria-hidden="true"
                draggable={false}
              />
              <PetExpression state={petState} />
            </PetLiveStatus>
          </div>
        </div>
      )}

      {mode === 'animated' && reply && <div className="pet-reply-bubble" aria-live="polite">{reply}</div>}

      {mode === 'animated' && (
        <>
          <div className="pet-status" aria-live="polite">
            <span className="status-dot" />
            <span className="pet-status-copy">
              <strong>{petStateLabel[petState]}</strong>
              <small>在线中 · 随时待命 <Heart className="status-heart" size={12} aria-hidden="true" /></small>
            </span>
          </div>
          <ReferenceStatusRays className="pet-status-rays" />
        </>
      )}

      <div
        className="pet-character-hitbox"
        role="button"
        tabIndex={0}
        aria-label={petState === 'sleeping' ? '轻轻叫醒白猫' : '摸摸白猫'}
        title="点击摸摸；拖动调整位置；右键查看更多操作"
        {...groupDrag}
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
        }}
        onKeyDown={(event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault()
            onContextMenu()
            return
          }
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onPetInteract()
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

      {mode === 'companion' && (
        <>
          <div className="companion-actions" role="group" aria-label="白猫操作">
            <button className="companion-chat-button" type="button" onClick={onToggleChat} aria-expanded={panelOpen} aria-haspopup="dialog" disabled={opening}>
              <MessageCircle size={14} strokeWidth={1.75} aria-hidden="true" />{opening ? '正在打开' : '聊一会'}
            </button>
            <button className="companion-menu-button" type="button" onClick={onContextMenu} aria-label="桌宠菜单" aria-haspopup="menu" title="桌宠菜单">
              <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
          {actionError && <div className="companion-action-error" role="alert">{actionError}</div>}
        </>
      )}

      {mode === 'animated' && rendererStatus !== 'ready' && (
        <div className="preview-label">
          {rendererStatus === 'loading' && '正在加载白猫…'}
          {rendererStatus === 'error' && '动画加载失败 · 插画模式'}
        </div>
      )}

    </section>
  )
}
