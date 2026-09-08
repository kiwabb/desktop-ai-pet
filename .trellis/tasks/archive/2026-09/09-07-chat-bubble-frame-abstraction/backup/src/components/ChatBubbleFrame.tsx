import type { ReactNode } from 'react'

import { ReferenceChatBubbleTail, ReferenceMiniPaw, ReferencePawBadge } from './ReferenceIllustrations'

interface ChatBubbleFrameProps {
  attached?: boolean
  expanded: boolean
  entering?: boolean
  title: string
  subtitle: string
  contentKind?: 'chat' | 'settings'
  actions: ReactNode
  children: ReactNode
}

/**
 * Shared visual shell for compact chat and expanded detail/settings content.
 * Content changes between modes; the frame, header and cat-facing tail do not.
 */
export function ChatBubbleFrame({
  attached = false,
  expanded,
  entering = true,
  title,
  subtitle,
  contentKind = 'chat',
  actions,
  children,
}: ChatBubbleFrameProps) {
  const className = `chat-panel ${expanded ? 'is-expanded' : 'is-compact'} is-${contentKind}${attached ? ' is-attached' : ''}${attached && !expanded ? ' component-compact' : ''}${attached && !expanded && entering ? ' is-entering' : ''}`

  return (
    <section className={className} aria-label="与橘伴对话">
      {attached && <ReferenceChatBubbleTail className="chat-bubble-tail" />}

      <header className="chat-header" data-tauri-drag-region>
        <div className="assistant-identity">
          <ReferencePawBadge className="assistant-paw-badge" />
          <div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
        </div>
        <div className="header-actions">{actions}</div>
      </header>

      {attached && !expanded && (
        <span className="compact-paw-trail" aria-hidden="true">
          <ReferenceMiniPaw />
          <ReferenceMiniPaw />
        </span>
      )}

      {children}
    </section>
  )
}
