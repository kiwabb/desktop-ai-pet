import { BookOpen, Clock3, LoaderCircle, NotebookPen } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { setMemoReview } from '../lib/agent'
import type { Memo } from '../lib/agent'
import { utilityErrorMessage } from '../lib/utility-feedback'
import './TodoReminders.css'

interface MemoReviewRemindersProps {
  generation: number
  items: Memo[]
  error: string | null
  showSyncError?: boolean
  onOpenMemos: () => void
}

function ReviewItem({ item, generation, onOpenMemos, onExitFocus }: { item: Memo; generation: number; onOpenMemos: () => void; onExitFocus: (panel: HTMLElement) => void }) {
  const [busy, setBusy] = useState<'snooze' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(false)
  const mountedRef = useRef(true)
  const snoozeRef = useRef<string | null>(null)
  const articleRef = useRef<HTMLElement | null>(null)
  const actionOwnedFocusRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  useLayoutEffect(() => () => {
    // Snapshot focus before React removes this occurrence's DOM. A disabled
    // action may already have returned focus to body while awaiting persistence.
    const article = articleRef.current
    const panel = article?.closest<HTMLElement>('.chat-panel')
    if (panel && (article?.contains(document.activeElement)
      || (actionOwnedFocusRef.current && document.activeElement === document.body))) onExitFocus(panel)
  }, [onExitFocus])

  async function snooze() {
    if (busyRef.current) return
    actionOwnedFocusRef.current = articleRef.current?.contains(document.activeElement) === true
    busyRef.current = true
    setBusy('snooze')
    setError(null)
    try {
      // Preserve this absolute target for uncertain retries, rather than adding
      // another ten minutes on every click. A new occurrence remounts this item.
      if (!snoozeRef.current) snoozeRef.current = new Date(Date.now() + 10 * 60_000).toISOString()
      const result = await setMemoReview(item.id, snoozeRef.current, item.review_at)
      if (!mountedRef.current) return
      if (result.generation !== generation) throw new Error('助手配置已更换，请重新打开备忘录。')
      // Native confirmation updates the projection and removes the notice.
    }
    catch (cause) {
      // Raw failure stays in the console; the card shows a readable message.
      console.error('[MemoReviewReminders] 回顾处理失败', cause)
      if (mountedRef.current) setError(utilityErrorMessage(cause, '未能保存回顾操作，请重试。', 'memo'))
    }
    finally {
      if (mountedRef.current) {
        busyRef.current = false
        setBusy(null)
      }
    }
  }

  const timestamp = item.review_at ? new Date(item.review_at) : null
  const time = timestamp && !Number.isNaN(timestamp.getTime())
    ? new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(timestamp)
    : '回顾时间不可用'

  return <article ref={articleRef} className="todo-reminder-card" onBlurCapture={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) actionOwnedFocusRef.current = false
  }}>
    <p className="todo-reminder-title">{item.title}</p>
    <time dateTime={item.review_at ?? undefined}>{time}</time>
    <div className="todo-reminder-actions">
      <button type="button" aria-label={`查看备忘：${item.title}`} disabled={busy !== null} onClick={onOpenMemos}>
        <NotebookPen aria-hidden="true" />查看备忘
      </button>
      <button type="button" aria-label={`10 分钟后再回顾：${item.title}`} aria-busy={busy === 'snooze'} disabled={busy !== null} onClick={() => void snooze()}>
        {busy === 'snooze' ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Clock3 aria-hidden="true" />}10 分钟后再回顾
      </button>
    </div>
    {busy && <span className="sr-only" role="status">正在保存回顾处理结果</span>}
    {error && <p className="todo-reminder-error" role="alert">{error}</p>}
  </article>
}

export function MemoReviewReminders({ generation, items, error, onOpenMemos, showSyncError = true }: MemoReviewRemindersProps) {
  const recoveryFrameRef = useRef<number | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (recoveryFrameRef.current !== null) window.cancelAnimationFrame(recoveryFrameRef.current)
    }
  }, [])
  const recoverExitFocus = useCallback((panel: HTMLElement) => {
    if (!mountedRef.current) return
    if (recoveryFrameRef.current !== null) window.cancelAnimationFrame(recoveryFrameRef.current)
    recoveryFrameRef.current = window.requestAnimationFrame(() => {
      recoveryFrameRef.current = null
      if (!mountedRef.current || !panel.isConnected || panel.getAttribute('aria-hidden') === 'true' || panel.closest('[inert]')) return
      const active = document.activeElement
      // The user may have continued typing or navigated during the request.
      if (active instanceof HTMLElement && active !== document.body && active.isConnected) return
      const target = panel.querySelector<HTMLButtonElement>('.todo-reminder-actions button:not(:disabled)')
        ?? panel.querySelector<HTMLTextAreaElement>('textarea:not(:disabled)')
        ?? panel.querySelector<HTMLInputElement>('.assistant-settings input:not(:disabled)')
        ?? panel.querySelector<HTMLButtonElement>('.chat-header button:not(:disabled)')
      target?.focus({ preventScroll: true })
    })
  }, [])
  if (!items.length && !(showSyncError && error)) return null
  const first = items[0]
  return <section className="todo-reminders" aria-label="备忘回顾">
    {first && <>
      <h2 aria-live="polite"><BookOpen aria-hidden="true" />橘伴喊你回顾啦{items.length > 1 && <span>还有 {items.length - 1} 项</span>}</h2>
      <ReviewItem key={`${generation}:${first.id}:${first.review_at}`} item={first} generation={generation} onOpenMemos={onOpenMemos} onExitFocus={recoverExitFocus} />
    </>}
    {showSyncError && error && <p className="todo-reminder-error" role="alert">{utilityErrorMessage(error, '回顾暂未同步，连接恢复后会自动重试。', 'memo')}</p>}
  </section>
}
