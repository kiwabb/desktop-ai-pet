import type { CSSProperties, ReactNode } from 'react'

import { ReferenceChatBubbleTail, ReferenceMiniPaw, ReferencePawBadge } from './ReferenceIllustrations'
import './ChatBubbleFrame.css'

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
  /** Attached-only decoration; omitted fields use the current variant defaults. */
  tail?: ChatBubbleTailConfig
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
  const attached = appearance === 'attached'
  const defaults = tailDefaults[variant]
  const tailWidth = tail?.width ?? defaults.width
  const frameStyle: FrameStyle = {
    ...style,
    '--chat-tail-top': tailPosition(tail?.top ?? defaults.top),
    '--chat-tail-right': tailPosition(tail?.right ?? defaults.right * tailWidth / defaults.width),
    '--chat-tail-width': `${tailWidth}px`,
    '--chat-tail-height': `${tail?.height ?? defaults.height}px`,
  }
  const rootClass = `chat-panel is-${variant} is-${appearance}${visible ? '' : ' is-hidden'}${visible && animateEntrance ? ' is-entering' : ''}${className ? ` ${className}` : ''}`

  return (
    <section
      className={rootClass}
      style={frameStyle}
      aria-label={ariaLabel ?? title}
      inert={!visible}
    >
      <ReferencePawBadge className="assistant-paw-badge" />
      {attached && <ReferenceChatBubbleTail className="chat-bubble-tail" variant={variant} />}

      {attached && variant === 'compact' && (
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

        <div className="chat-panel-body">{children}</div>
        {footer != null && <div className="chat-panel-footer">{footer}</div>}
      </div>
    </section>
  )
}
