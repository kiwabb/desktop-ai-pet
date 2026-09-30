import { motionDiagnosticMode } from '../lib/motion-diagnostics'
import { motionDuration, MOTION_EASE_OUT } from '../lib/motion'
import { watchFrameEntrance } from '../lib/frame-entrance'
import { useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { CSSProperties, ReactNode } from 'react'

import { ReferenceChatBubbleTail, ReferenceMiniPaw, ReferencePawBadge } from './ReferenceIllustrations'
import type { FrameGeometry } from './useFrameMorph'
import { useFrameMorph } from './useFrameMorph'
import { ChatBubbleShell } from './ChatBubbleShell'
import type { ChatBubbleDockConfig } from './pet-shell-geometry'
import './ChatBubbleFrame.css'

export type { ChatBubbleDockConfig } from './pet-shell-geometry'
export type ChatBubbleFrameAppearance = 'attached' | 'standalone' | 'companion'

export interface ChatBubbleTailConfig {
  /** Vertical center anchor from the frame padding edge; numbers use CSS px. */
  top?: number | string
  /** Right padding-edge offset; negative protrudes. Omitted scales with width to preserve seam overlap. */
  right?: number | string
  /** CSS px; scales the path independently on each axis, without letterboxing. */
  width?: number
  height?: number
}

const tailDefaults = {
  compact: { top: 132, right: -16, width: 24, height: 30 },
  expanded: { top: '67%', right: -20, width: 30, height: 36 },
} satisfies Record<'compact' | 'expanded', Required<ChatBubbleTailConfig>>

type FrameStyle = CSSProperties & {
  '--chat-tail-top': string
  '--chat-tail-right': string
  '--chat-tail-width': string
  '--chat-tail-height': string
}

function tailPosition(value: number | string): string {
  return typeof value === 'number' ? `${value}px` : value
}

interface ChatBubbleFrameProps {
  /** Layout mode of the frame. */
  variant: 'compact' | 'expanded'
  /** companion = independent reading surface; other appearances retain their reference decoration. */
  appearance?: ChatBubbleFrameAppearance
  /** Explicit tail fields opt into the legacy detached decoration; an empty object uses the integrated shell. */
  tail?: ChatBubbleTailConfig
  /** Placement of the integrated platform; no effect in standalone or explicit-tail mode. */
  dock?: ChatBubbleDockConfig
  /** false keeps the frame mounted and laid out but hidden, non-interactive and unfocusable. */
  visible?: boolean
  /** Plays on each visible entrance; hidden frames reset it, without unmounting content. */
  animateEntrance?: boolean
  title: string
  subtitle?: string
  /** Accessible name; falls back to the title. */
  ariaLabel?: string
  actions?: ReactNode
  /** Optional labelled navigation below the window header. */
  navigation?: ReactNode
  /** Optional bottom slot (e.g. composer); omitted entirely when not provided. */
  footer?: ReactNode
  /** Opt-in: only then does the header become a Tauri window drag region. */
  draggable?: boolean
  /** Host escape hatches for desktop anchoring / sizing only. */
  className?: string
  style?: CSSProperties
  children: ReactNode
}

/**
 * Reusable desktop-pet bubble frame: border, background, radii, shadow, header,
 * badge/tail/paw-trail decorations, stable body/footer slots and its own entrance
 * motion. All internal styles ship with the component (./ChatBubbleFrame.css) and
 * are scoped to the `.chat-panel` root — no pet-shell / pet-chat-* /
 * chat-window-app ancestor is required. The host owns desktop coordinates,
 * available size and z-index via className/style; the frame knows nothing about
 * chat, settings, AI or Tauri window APIs.
 */
export function ChatBubbleFrame({
  variant,
  appearance = 'standalone',
  tail,
  dock,
  visible = true,
  animateEntrance = false,
  title,
  subtitle,
  ariaLabel,
  actions,
  navigation,
  footer,
  draggable = false,
  className,
  style,
  children,
}: ChatBubbleFrameProps) {
  const rootRef = useRef<HTMLElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [geometry, setGeometry] = useState<FrameGeometry>({ width: 0, height: 0, dockShift: 0 })
  const [entranceActive, setEntranceActive] = useState(visible && animateEntrance)
  const { width, height, dockShift } = geometry
  const attached = appearance === 'attached'
  const explicitTail = tail != null && Object.values(tail).some(value => value !== undefined)
  const integrated = attached && !explicitTail
  const morphingRef = useFrameMorph(rootRef, variant, visible, integrated, setGeometry, dock)
  const previousPageRef = useRef<{ title: string; variant: string; visible: boolean } | null>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || !visible || !animateEntrance || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setEntranceActive(false)
      return
    }
    setEntranceActive(true)
    return watchFrameEntrance(root, () => setEntranceActive(false))
  }, [visible, animateEntrance])

  useLayoutEffect(() => {
    if (!integrated || !rootRef.current) return
    const root = rootRef.current
    const update = (width: number, height: number) => {
      if (morphingRef.current) return
      setGeometry(current => current.width === width && current.height === height ? current : { width, height, dockShift: 0 })
    }
    update(root.offsetWidth, root.offsetHeight)
    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.borderBoxSize[0]
      update(box?.inlineSize ?? root.offsetWidth, box?.blockSize ?? root.offsetHeight)
    })
    function resizeViewport() {
      // A drag-end native refit is one layout transaction. Cancel the old
      // dissolve, then commit the new perimeter before this viewport paints.
      root.dispatchEvent(new Event('chat-frame-viewport-resize'))
      flushSync(() => update(root.offsetWidth, root.offsetHeight))
      const bounds = root.getBoundingClientRect()
      root.dispatchEvent(new CustomEvent('chat-frame-bounds', { detail: {
        x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
      } }))
    }
    observer.observe(root)
    window.addEventListener('resize', resizeViewport)
    return () => { observer.disconnect(); window.removeEventListener('resize', resizeViewport) }
  }, [integrated])
  useLayoutEffect(() => {
    const diagnostic = motionDiagnosticMode()
    const previous = previousPageRef.current
    previousPageRef.current = { title, variant, visible }
    if (diagnostic === 'none' || diagnostic === 'translate-only') return
    if (!visible || !previous?.visible || (previous.title === title && previous.variant === variant)) return
    if (previous.variant !== variant && morphingRef.current) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const animation = bodyRef.current?.animate?.(reduced ? [
      { opacity: .8 }, { opacity: 1 },
    ] : [
      { opacity: .8, transform: 'translateY(4px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: reduced ? 140 : motionDuration(rootRef.current ?? document.documentElement, 'normal', 180), easing: MOTION_EASE_OUT })
    return () => animation?.cancel()
  }, [title, variant, visible])
  const defaults = tailDefaults[variant]
  const tailWidth = tail?.width ?? defaults.width
  const frameStyle: FrameStyle = {
    ...style,
    '--chat-tail-top': tailPosition(tail?.top ?? defaults.top),
    '--chat-tail-right': tailPosition(tail?.right ?? defaults.right * tailWidth / defaults.width),
    '--chat-tail-width': `${tailWidth}px`,
    '--chat-tail-height': `${tail?.height ?? defaults.height}px`,
  }
  const rootClass = `chat-panel is-${variant} is-${appearance}${integrated ? ' is-integrated' : ''}${navigation ? ' has-navigation' : ''}${visible ? '' : ' is-hidden'}${visible && animateEntrance && entranceActive ? ' is-entering' : ''}${className ? ` ${className}` : ''}`

  return (
    <section
      ref={rootRef}
      className={rootClass}
      style={frameStyle}
      aria-label={ariaLabel ?? title}
      inert={!visible}
    >
      {appearance !== 'companion' && <ReferencePawBadge className="assistant-paw-badge" />}
      {integrated && width > 0 && <ChatBubbleShell width={width} height={height} dock={{ ...dock, offsetX: (dock?.offsetX ?? 0) + dockShift }} variant={variant} showFooterFootprints={variant === 'expanded' && footer == null} />}
      {attached && explicitTail && <ReferenceChatBubbleTail className="chat-bubble-tail" variant={variant} />}

      {attached && !integrated && variant === 'compact' && (
        <span className="compact-paw-trail" aria-hidden="true">
          <ReferenceMiniPaw />
          <ReferenceMiniPaw />
        </span>
      )}

      <div className="chat-panel-surface">
        <header className="chat-header" {...(draggable ? { 'data-tauri-drag-region': true } : {})}>
          <div className="assistant-identity">
            {appearance === 'companion' && <ReferencePawBadge className="companion-brand-mark" />}
            <div>
              <h1>{title}</h1>
              {subtitle && <p>{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="header-actions">{actions}</div>}
        </header>
        {navigation && <div className="chat-panel-navigation">{navigation}</div>}

        <div ref={bodyRef} className="chat-panel-body">{children}</div>
        {footer != null && <div className="chat-panel-footer">{footer}</div>}
      </div>
    </section>
  )
}
