import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

import { ReferenceChatBubbleTail, ReferenceMiniPaw, ReferencePawBadge } from './ReferenceIllustrations'
import { ChatBubbleShell } from './ChatBubbleShell'
import type { ChatBubbleDockConfig } from './pet-shell-geometry'
import './ChatBubbleFrame.css'

export type { ChatBubbleDockConfig } from './pet-shell-geometry'

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
  /** attached = speech bubble next to the pet (tail, paw trail); standalone = plain window surface. */
  appearance?: 'attached' | 'standalone'
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
  footer,
  draggable = false,
  className,
  style,
  children,
}: ChatBubbleFrameProps) {
  const rootRef = useRef<HTMLElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const attached = appearance === 'attached'
  const explicitTail = tail != null && Object.values(tail).some(value => value !== undefined)
  const integrated = attached && !explicitTail

  useLayoutEffect(() => {
    if (!integrated || !rootRef.current) return
    const root = rootRef.current
    const update = (width: number, height: number) => setSize(current =>
      current.width === width && current.height === height ? current : { width, height })
    update(root.offsetWidth, root.offsetHeight)
    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.borderBoxSize[0]
      update(box?.inlineSize ?? root.offsetWidth, box?.blockSize ?? root.offsetHeight)
    })
    observer.observe(root)
    return () => observer.disconnect()
  }, [integrated])
  useLayoutEffect(() => {
    if (!visible || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const animation = bodyRef.current?.animate?.([
      { opacity: .65, transform: 'translateY(6px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 180, easing: 'cubic-bezier(.2,.75,.25,1)' })
    return () => animation?.cancel()
  }, [title, visible])
  const defaults = tailDefaults[variant]
  const tailWidth = tail?.width ?? defaults.width
  const frameStyle: FrameStyle = {
    ...style,
    '--chat-tail-top': tailPosition(tail?.top ?? defaults.top),
    '--chat-tail-right': tailPosition(tail?.right ?? defaults.right * tailWidth / defaults.width),
    '--chat-tail-width': `${tailWidth}px`,
    '--chat-tail-height': `${tail?.height ?? defaults.height}px`,
  }
  const rootClass = `chat-panel is-${variant} is-${appearance}${integrated ? ' is-integrated' : ''}${visible ? '' : ' is-hidden'}${visible && animateEntrance ? ' is-entering' : ''}${className ? ` ${className}` : ''}`

  return (
    <section
      ref={rootRef}
      className={rootClass}
      style={frameStyle}
      aria-label={ariaLabel ?? title}
      inert={!visible}
    >
      <ReferencePawBadge className="assistant-paw-badge" />
      {integrated && size.width > 0 && <ChatBubbleShell width={size.width} height={size.height} dock={dock} variant={variant} showFooterFootprints={variant === 'expanded' && footer == null} />}
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
            <div>
              <h1>{title}</h1>
              {subtitle && <p>{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="header-actions">{actions}</div>}
        </header>

        <div ref={bodyRef} className="chat-panel-body">{children}</div>
        {footer != null && <div className="chat-panel-footer">{footer}</div>}
      </div>
    </section>
  )
}
