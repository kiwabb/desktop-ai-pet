interface ComposerKey {
  key: string
  shiftKey: boolean
  isComposing: boolean
  keyCode: number
  compositionActive: boolean
  timeStamp: number
  compositionEndedAt: number
}

/** WebKit can end composition before dispatching its candidate-confirming
 * Enter. Keep that same short event burst out of the submit path as well. */
export function shouldSubmitComposer(event: ComposerKey) {
  return event.key === 'Enter' && !event.shiftKey
    && !event.isComposing && !event.compositionActive && event.keyCode !== 229
    && event.timeStamp - event.compositionEndedAt > 50
}

export function isNearChatBottom({ scrollHeight, clientHeight, scrollTop }: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  return scrollHeight - clientHeight - Math.max(0, scrollTop) <= 64
}

/** Message links only open explicit web/mail addresses. Relative paths would
 * navigate the desktop app; protocol-relative, control-obfuscated and active
 * schemes are rejected rather than delegated to the current document URL. */
export function safeMessageUrl(value: string) {
  if (!value || /[\u0000-\u0020\u007f]/.test(value)) return undefined
  if (!/^(https?:\/\/|mailto:)/i.test(value)) return undefined
  try {
    const url = new URL(value)
    if (url.protocol === 'http:' || url.protocol === 'https:')
      return url.hostname && !url.username && !url.password ? url.href : undefined
    if (url.protocol === 'mailto:') return url.pathname ? url.href : undefined
  }
  catch { /* Invalid or partial streaming links stay plain text. */ }
  return undefined
}
