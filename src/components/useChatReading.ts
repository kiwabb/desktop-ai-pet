import { useLayoutEffect, useRef, useState } from 'react'
import { isNearChatBottom } from '../lib/chat-interaction'

/** Reading state survives secondary pages. Scroll only this viewport, never
 * scrollIntoView (which can move native frame ancestors or settings content). */
export function useChatReading(active: boolean, contentVersion: unknown, toolsVersion: unknown) {
  const listRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const followingRef = useRef(true)
  const topRef = useRef(0)
  const [showLatest, setShowLatest] = useState(false)

  function followLatest() {
    const list = listRef.current
    if (!list) return
    followingRef.current = true
    list.scrollTo({ top: list.scrollHeight, behavior: 'instant' })
    topRef.current = list.scrollTop
    setShowLatest(false)
  }

  function onScroll() {
    if (!active || !listRef.current) return
    const list = listRef.current
    followingRef.current = isNearChatBottom(list)
    topRef.current = list.scrollTop
    setShowLatest(!followingRef.current)
  }

  useLayoutEffect(() => {
    if (!active || !listRef.current) return
    const list = listRef.current
    if (followingRef.current) followLatest()
    else list.scrollTo({ top: topRef.current, behavior: 'instant' })
    setShowLatest(!followingRef.current)
    const observer = new ResizeObserver(() => {
      if (followingRef.current) followLatest()
    })
    observer.observe(list)
    if (contentRef.current) observer.observe(contentRef.current)
    return () => observer.disconnect()
  }, [active])

  useLayoutEffect(() => {
    if (active && followingRef.current) followLatest()
  }, [active, contentVersion, toolsVersion])

  function returnToLatest() {
    followLatest()
    listRef.current?.focus({ preventScroll: true })
  }

  return { listRef, contentRef, onScroll, showLatest: active && showLatest, returnToLatest }
}
