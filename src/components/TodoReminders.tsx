import { Bell, Check, ChevronDown, Clock3, LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { completeTodo, setTodoReminder } from '../lib/agent'
import type { Todo } from '../lib/agent'
import { utilityErrorMessage } from '../lib/utility-feedback'
import './TodoReminders.css'

interface TodoRemindersProps {
  generation: number
  items: Todo[]
  error: string | null
  showSyncError?: boolean
}

function ReminderItem({ item, generation, onExitFocus }: { item: Todo; generation: number; onExitFocus: (panel: HTMLElement) => void }) {
  const [busy, setBusy] = useState<'complete' | 'snooze' | null>(null)
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

  async function act(action: 'complete' | 'snooze') {
    if (busyRef.current) return
    actionOwnedFocusRef.current = articleRef.current?.contains(document.activeElement) === true
    busyRef.current = true
    setBusy(action)
    setError(null)
    try {
      // Preserve this absolute target for uncertain retries, rather than adding
      // another ten minutes on every click. A new occurrence remounts this item.
      if (action === 'snooze' && !snoozeRef.current) snoozeRef.current = new Date(Date.now() + 10 * 60_000).toISOString()
      const result = await (action === 'complete'
        ? completeTodo(item.id)
        : setTodoReminder(item.id, snoozeRef.current, item.remind_at))
      if (!mountedRef.current) return
      if (result.generation !== generation) throw new Error('助手配置已更换，请重新打开待办列表。')
      // Native confirmation updates the projection and removes the notice.
    }
    catch (cause) {
      // Raw failure stays in the console; the card shows a readable message.
      console.error('[TodoReminders] 提醒处理失败', cause)
      if (mountedRef.current) setError(utilityErrorMessage(cause, '未能保存提醒操作，请重试。', 'reminder'))
    }
    finally {
      if (mountedRef.current) {
        busyRef.current = false
        setBusy(null)
      }
    }
  }

  const timestamp = item.remind_at ? new Date(item.remind_at) : null
  const time = timestamp && !Number.isNaN(timestamp.getTime())
    ? new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(timestamp)
    : '提醒时间不可用'

  return <article ref={articleRef} className="todo-reminder-card" onBlurCapture={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) actionOwnedFocusRef.current = false
  }}>
    <p className="todo-reminder-title">{item.title}</p>
    <time dateTime={item.remind_at ?? undefined}>{time}</time>
    <div className="todo-reminder-actions">
      <button type="button" aria-label={`完成提醒待办：${item.title}`} aria-busy={busy === 'complete'} disabled={busy !== null} onClick={() => void act('complete')}>
        {busy === 'complete' ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Check aria-hidden="true" />}完成
      </button>
      <button type="button" aria-label={`将提醒推迟 10 分钟：${item.title}`} aria-busy={busy === 'snooze'} disabled={busy !== null} onClick={() => void act('snooze')}>
        {busy === 'snooze' ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Clock3 aria-hidden="true" />}10 分钟后提醒
      </button>
    </div>
    {busy && <span className="sr-only" role="status">正在保存提醒处理结果</span>}
    {error && <p className="todo-reminder-error" role="alert">{error}</p>}
  </article>
}

export function TodoReminders({ generation, items, error, showSyncError = true }: TodoRemindersProps) {
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
  return <section className="todo-reminders" aria-label="待办提醒">
    {first && <>
      <h2 aria-live="polite"><Bell aria-hidden="true" />橘伴来叫你啦{items.length > 1 && <span>还有 {items.length - 1} 项</span>}</h2>
      <ReminderItem key={`${generation}:${first.id}:${first.remind_at}`} item={first} generation={generation} onExitFocus={recoverExitFocus} />
    </>}
    {showSyncError && error && <p className="todo-reminder-error" role="alert">{utilityErrorMessage(error, '提醒暂未同步，连接恢复后会自动重试。', 'reminder')}</p>}
  </section>
}

/** Aggregate projection-sync failures without hiding per-reminder action errors. */
export function ReminderSyncNotice({ todoError, memoError }: { todoError: string | null; memoError: string | null }) {
  if (!todoError && !memoError) return null
  return <details className="reminder-sync-notice" onKeyDown={event => {
    if (event.defaultPrevented || event.key !== 'Escape' || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || !event.currentTarget.open) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.open = false
    event.currentTarget.querySelector('summary')?.focus({ preventScroll: true })
  }}>
    <summary><Bell aria-hidden="true" /><span>提醒同步遇到问题</span><ChevronDown aria-hidden="true" /></summary>
    <div className="reminder-sync-details">
      {todoError && <p><strong>待办提醒</strong>{utilityErrorMessage(todoError, '提醒暂未同步，连接恢复后会自动重试。', 'reminder')}</p>}
      {memoError && <p><strong>备忘回顾</strong>{utilityErrorMessage(memoError, '回顾暂未同步，连接恢复后会自动重试。', 'memo')}</p>}
    </div>
  </details>
}
