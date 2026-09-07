import { Bell, Check, Clock3, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { completeTodo, setTodoReminder } from '../lib/agent'
import type { Todo } from '../lib/agent'
import './TodoReminders.css'

interface TodoRemindersProps {
  generation: number
  items: Todo[]
  error: string | null
}

function ReminderItem({ item, generation }: { item: Todo; generation: number }) {
  const [busy, setBusy] = useState<'complete' | 'snooze' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(false)
  const mountedRef = useRef(true)
  const snoozeRef = useRef<string | null>(null)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  async function act(action: 'complete' | 'snooze') {
    if (busyRef.current) return
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
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : String(cause))
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
    ? new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' }).format(timestamp)
    : '提醒时间不可用'

  return <article className="todo-reminder-card">
    <p className="todo-reminder-title">{item.title}</p>
    <time dateTime={item.remind_at ?? undefined}>{time}</time>
    <div className="todo-reminder-actions">
      <button type="button" disabled={busy !== null} onClick={() => void act('complete')}>
        {busy === 'complete' ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Check aria-hidden="true" />}完成
      </button>
      <button type="button" disabled={busy !== null} onClick={() => void act('snooze')}>
        {busy === 'snooze' ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Clock3 aria-hidden="true" />}稍后10分钟
      </button>
    </div>
    {busy && <span className="sr-only" role="status">正在保存提醒处理结果</span>}
    {error && <p className="todo-reminder-error" role="alert">{error}</p>}
  </article>
}

export function TodoReminders({ generation, items, error }: TodoRemindersProps) {
  if (!items.length && !error) return null
  const first = items[0]
  return <section className="todo-reminders" aria-label="待办提醒">
    {first && <>
      <h2 aria-live="polite"><Bell aria-hidden="true" />到提醒时间了{items.length > 1 && <span>还有{items.length - 1}项待处理</span>}</h2>
      <ReminderItem key={`${generation}:${first.id}:${first.remind_at}`} item={first} generation={generation} />
    </>}
    {error && <p className="todo-reminder-error" role="alert">提醒同步失败：{error}。连接恢复后自动重试。</p>}
  </section>
}
