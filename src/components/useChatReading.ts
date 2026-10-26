import { useLayoutEffect, useRef, useState } from 'react'
import { isNearChatBottom } from '../lib/chat-interaction'

/** Reading state survives secondary pages. Scroll only this viewport, never
 * scrollIntoView (which can move native frame ancestors or settings content). */
export function useChatReading(active: boolean, contentVersion: unknown, toolsVersion: unknown, sessionKey = '', historyVersion = 0, layoutVersion: unknown = false) {
  const listRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const followingRef = useRef(true)
  const upwardReadingRef = useRef(false)
  const topRef = useRef(0)
  const readingIntentRef = useRef(0)
  const pendingSendRevealRef = useRef<number | null>(null)
  const prependedRef = useRef<{ height: number; top: number; restoreFocus: boolean } | null>(null)
  const layoutAnchorRef = useRef<{ element: HTMLElement; offset: number; intent: number; sessionKey: string; target: unknown } | null>(null)
  const [showLatest, setShowLatest] = useState(false)
  const [sendRevealVersion, setSendRevealVersion] = useState(0)

  function invalidateSendReveal() {
    readingIntentRef.current += 1
    pendingSendRevealRef.current = null
    layoutAnchorRef.current = null
  }

  function captureSendIntent() {
    return readingIntentRef.current
  }

  function revealAcceptedSend(intent: number) {
    if (intent !== readingIntentRef.current) return
    pendingSendRevealRef.current = intent
    // Acceptance can arrive independently of the message snapshot. Commit the
    // reveal now, then the existing follow policy handles its later DOM growth.
    setSendRevealVersion(version => version + 1)
  }

  function followLatest() {
    const list = listRef.current
    if (!list) return
    followingRef.current = true
    upwardReadingRef.current = false
    list.scrollTo({ top: list.scrollHeight, behavior: 'instant' })
    topRef.current = list.scrollTop
    setShowLatest(false)
  }

  function onScroll() {
    if (!active || !listRef.current) return
    const list = listRef.current
    // Our own instant scrolls record topRef synchronously. A different position
    // is a newer reading choice, including scrollbar and keyboard scrolling.
    if (list.scrollTop !== topRef.current) invalidateSendReveal()
    if (upwardReadingRef.current) {
      // A delayed unchanged event or a small upward step inside the bottom
      // threshold must not undo a deliberate pause before scrolling finishes.
      followingRef.current = list.scrollTop > topRef.current && isNearChatBottom(list)
      if (followingRef.current) upwardReadingRef.current = false
    } else followingRef.current = isNearChatBottom(list)
    topRef.current = list.scrollTop
    setShowLatest(!followingRef.current)
  }

  function pauseForUpwardReading() {
    const list = listRef.current
    if (!active || !list) return
    invalidateSendReveal()
    if (list.scrollHeight <= list.clientHeight) return
    topRef.current = list.scrollTop
    upwardReadingRef.current = true
    followingRef.current = false
    setShowLatest(true)
  }

  function prepareLayoutChange(target: unknown) {
    layoutAnchorRef.current = null
    const list = listRef.current
    const content = contentRef.current
    if (!active || !list || !content || followingRef.current || pendingSendRevealRef.current !== null || prependedRef.current) return
    const viewport = list.getBoundingClientRect()
    const top = viewport.top + list.clientTop
    const bottom = top + list.clientHeight
    let anchor: { element: HTMLElement; top: number; height: number } | null = null
    // Anchor a visible semantic block, not the message's top or a fraction of
    // total history: earlier paragraphs change height when the panel reflows.
    for (const element of content.querySelectorAll<HTMLElement>('.message-markdown p, .message-markdown h1, .message-markdown h2, .message-markdown h3, .message-markdown h4, .message-markdown h5, .message-markdown h6, .message-markdown li, .message-markdown tr, .message-markdown pre, .message-outcome, .message-meta')) {
      const rect = element.getBoundingClientRect()
      if (rect.height <= 0 || rect.width <= 0 || rect.bottom <= top || rect.top >= bottom) continue
      const crossesTop = rect.top <= top
      const previousCrossesTop = anchor !== null && anchor.top <= top
      if (!anchor || (crossesTop && !previousCrossesTop)
        || (crossesTop && previousCrossesTop && (rect.top > anchor.top || (rect.top === anchor.top && rect.height < anchor.height)))
        || (!crossesTop && !previousCrossesTop && rect.top < anchor.top))
        anchor = { element, top: rect.top, height: rect.height }
    }
    if (anchor) layoutAnchorRef.current = { element: anchor.element, offset: anchor.top - top, intent: readingIntentRef.current, sessionKey, target }
  }

  function cancelLayoutChange() {
    layoutAnchorRef.current = null
  }

  useLayoutEffect(() => {
    invalidateSendReveal()
    followingRef.current = true
    upwardReadingRef.current = false
    topRef.current = 0
    prependedRef.current = null
    setShowLatest(false)
  }, [sessionKey])

  useLayoutEffect(() => {
    if (!active || !listRef.current) { layoutAnchorRef.current = null; return }
    const list = listRef.current
    // The commit effect owns following. Restore a historical position only
    // when no accepted reveal or history prepend already owns this commit.
    if (!followingRef.current && pendingSendRevealRef.current === null && !prependedRef.current)
      list.scrollTo({ top: topRef.current, behavior: 'instant' })
    setShowLatest(!followingRef.current)
    const observer = new ResizeObserver(() => {
      if (followingRef.current) followLatest()
    })
    observer.observe(list)
    if (contentRef.current) observer.observe(contentRef.current)
    return () => observer.disconnect()
  }, [active, sessionKey])

  useLayoutEffect(() => {
    const list = listRef.current
    const previous = prependedRef.current
    if (!active || !list || !previous) return
    prependedRef.current = null
    list.scrollTo({ top: previous.top + list.scrollHeight - previous.height, behavior: 'instant' })
    topRef.current = list.scrollTop
    if (previous.restoreFocus && document.activeElement === document.body) list.focus({ preventScroll: true })
    setShowLatest(!isNearChatBottom(list))
  }, [active, historyVersion])

  function commitReadingUpdate() {
    if (!active || !listRef.current) return
    const requested = pendingSendRevealRef.current
    if (requested !== null) {
      pendingSendRevealRef.current = null
      if (requested === readingIntentRef.current) {
        prependedRef.current = null
        layoutAnchorRef.current = null
        followingRef.current = true
      }
    }
    if (followingRef.current) { layoutAnchorRef.current = null; followLatest(); return }
    const anchor = layoutAnchorRef.current
    if (!anchor || anchor.target !== layoutVersion) return
    layoutAnchorRef.current = null
    if (anchor.intent !== readingIntentRef.current || anchor.sessionKey !== sessionKey || !contentRef.current?.contains(anchor.element)) return
    const list = listRef.current
    const rect = anchor.element.getBoundingClientRect()
    if (rect.height <= 0 || rect.width <= 0) return
    // A paragraph can become shorter than the previously hidden portion.
    // Keep at least its final line visible instead of jumping past the block.
    const offset = Math.max(anchor.offset, -Math.max(0, rect.height - 24))
    list.scrollTo({ top: list.scrollTop + rect.top - list.getBoundingClientRect().top - list.clientTop - offset, behavior: 'instant' })
    topRef.current = list.scrollTop
    upwardReadingRef.current = true
    setShowLatest(true)
  }

  useLayoutEffect(commitReadingUpdate, [active, contentVersion, toolsVersion, sendRevealVersion, sessionKey, layoutVersion])

  function returnToLatest() {
    invalidateSendReveal()
    followLatest()
    listRef.current?.focus({ preventScroll: true })
  }

  function prepareHistoryPrepend() {
    const list = listRef.current
    if (!list) return
    invalidateSendReveal()
    followingRef.current = false
    prependedRef.current = { height: list.scrollHeight, top: list.scrollTop, restoreFocus: list.contains(document.activeElement) }
  }

  return { listRef, contentRef, onScroll, showLatest: active && showLatest, returnToLatest, prepareHistoryPrepend, prepareLayoutChange, cancelLayoutChange, captureSendIntent, revealAcceptedSend, invalidateSendReveal, pauseForUpwardReading }
}
