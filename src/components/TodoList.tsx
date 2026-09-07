import { Bell, Check, LoaderCircle, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { completeTodo, listTodos, reopenTodo, setTodoReminder } from '../lib/agent'
import type { Todo } from '../lib/agent'
import './TodoList.css'

type ListState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; items: Todo[] }

function createdTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '创建时间不可用' : new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'short',
  }).format(date)
}

function createdDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '日期不可用'
  return new Intl.DateTimeFormat('zh-CN', {
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric', month: 'short', day: 'numeric',
  }).format(date)
}

/** Remounted for each configuration generation; no chat/model dependency. */
export function TodoList({ generation, refreshVersion }: { generation: number; refreshVersion: number }) {
  const [state, setState] = useState<ListState>({ kind: 'loading' })
  const [refresh, setRefresh] = useState(0)
  const [editor, setEditor] = useState<{ id: string; value: string; expected: string | null } | null>(null)
  const [schedulingId, setSchedulingId] = useState<string | null>(null)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const attemptedReminderRef = useRef<{ id: string; input: string; target: string | null } | null>(null)
  const queuedRefreshRef = useRef(false)
  const revisionRef = useRef(refreshVersion)
  const requestRef = useRef(0)
  const busyRef = useRef(true)
  const [completingId, setCompletingId] = useState<string | null>(null)
  const [completionError, setCompletionError] = useState<{ id: string; message: string } | null>(null)

  useEffect(() => {
    const request = ++requestRef.current
    let active = true
    busyRef.current = true
    setState({ kind: 'loading' })
    setCompletionError(null)
    void listTodos().then(result => {
      if (!active || request !== requestRef.current) return
      if (result.generation !== generation) {
        setState({ kind: 'error', message: '助手配置已更换，请刷新待办列表。' })
        return
      }
      setState({ kind: 'ready', items: result.items })
    }).catch((cause: unknown) => {
      if (active && request === requestRef.current)
        setState({ kind: 'error', message: cause instanceof Error ? cause.message : String(cause) })
    }).finally(() => {
      if (active && request === requestRef.current) releaseBusy()
    })
    return () => { active = false; requestRef.current++ }
  }, [generation, refresh])

  useEffect(() => {
    if (revisionRef.current === refreshVersion) return
    revisionRef.current = refreshVersion
    if (busyRef.current) queuedRefreshRef.current = true
    else refreshList()
  }, [refreshVersion])

  function releaseBusy() {
    busyRef.current = false
    if (queuedRefreshRef.current) {
      queuedRefreshRef.current = false
      refreshList()
    }
  }

  function refreshList() {
    if (busyRef.current) return
    busyRef.current = true
    setState({ kind: 'loading' })
    setRefresh(value => value + 1)
  }

  function refreshManually() {
    if (busyRef.current) return
    // A conflict asks the user to refresh. Discard the stale expected timestamp
    // with its editor so the next edit uses the newly read reminder version.
    setEditor(null)
    setScheduleError(null)
    attemptedReminderRef.current = null
    refreshList()
  }

  async function changeTodoStatus(item: Todo) {
    if (busyRef.current) return
    busyRef.current = true
    setCompletingId(item.id)
    setCompletionError(null)
    const request = requestRef.current
    try {
      const result = await (item.status === 'completed' ? reopenTodo(item.id) : completeTodo(item.id))
      if (request !== requestRef.current) return
      if (result.generation !== generation) throw new Error('助手配置已更换，请刷新待办列表。')
      if (editor?.id === item.id) setEditor(null)
      setState(current => current.kind === 'ready'
        ? { kind: 'ready', items: current.items.map(existing => existing.id === item.id ? result.item : existing) }
        : current)
    }
    catch (cause) {
      if (request === requestRef.current)
        setCompletionError({ id: item.id, message: cause instanceof Error ? cause.message : String(cause) })
    }
    finally {
      if (request === requestRef.current) {
        setCompletingId(null)
        releaseBusy()
      }
    }
  }

  function editReminder(item: Todo) {
    if (busyRef.current) return
    const date = item.remind_at ? new Date(item.remind_at) : null
    const local = date && !Number.isNaN(date.getTime())
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : ''
    attemptedReminderRef.current = null
    setEditor({ id: item.id, value: local, expected: item.remind_at })
    setScheduleError(null)
  }

  async function saveReminder(clear = false) {
    if (busyRef.current || !editor) return
    const attempt = attemptedReminderRef.current
    const input = clear ? 'clear' : editor.value
    let target: string | null
    if (attempt?.id === editor.id && attempt.input === input) target = attempt.target
    else {
      const date = new Date(editor.value)
      if (!clear && (!editor.value || Number.isNaN(date.getTime()) || date.getTime() <= Date.now())) {
        setScheduleError('请选择一个未来的提醒时间。')
        return
      }
      if (!clear) {
        const normalized = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
        if (normalized !== editor.value) {
          setScheduleError('该本地时间不存在，请重新选择提醒时间。')
          return
        }
      }
      target = clear ? null : date.toISOString()
      attemptedReminderRef.current = { id: editor.id, input, target }
    }
    // Retry the identical absolute target even if its time has since passed;
    // the server can acknowledge an earlier successful, but uncertain, write.
    const request = requestRef.current
    busyRef.current = true
    setSchedulingId(editor.id)
    setScheduleError(null)
    try {
      const result = await setTodoReminder(editor.id, target, editor.expected)
      if (request !== requestRef.current) return
      if (result.generation !== generation) throw new Error('助手配置已更换，请刷新待办列表。')
      setState(current => current.kind === 'ready'
        ? { kind: 'ready', items: current.items.map(item => item.id === result.item.id ? result.item : item) }
        : current)
      setEditor(null)
    }
    catch (cause) {
      if (request === requestRef.current) setScheduleError(cause instanceof Error ? cause.message : String(cause))
    }
    finally {
      if (request === requestRef.current) {
        setSchedulingId(null)
        releaseBusy()
      }
    }
  }

  const pendingCount = state.kind === 'ready' ? state.items.filter(item => item.status === 'pending').length : 0
  const completedCount = state.kind === 'ready' ? state.items.length - pendingCount : 0

  const writing = completingId !== null || schedulingId !== null

  return (
    <section className="todo-list-view" aria-label="待办列表">
      <div className="todo-list-toolbar">
        <p className="todo-list-count" aria-live="polite">
          {state.kind === 'ready' ? <><strong>{pendingCount}</strong> 待完成<span className="todo-count-divider" aria-hidden="true" /><span>{completedCount} 已完成</span></> : '待办事项'}
        </p>
        <button className="todo-refresh-button" type="button" disabled={state.kind === 'loading' || writing} onClick={refreshManually}>
          <RefreshCw aria-hidden="true" />刷新
        </button>
      </div>
      {state.kind === 'loading' && <div className="todo-list-notice" role="status"><LoaderCircle className="spinner" aria-hidden="true" /><p>正在读取待办…</p></div>}
      {state.kind === 'error' && <div className="todo-list-notice is-error" role="alert"><p>{state.message}</p><span>点击刷新重试。</span></div>}
      {state.kind === 'ready' && (state.items.length === 0
        ? <div className="todo-list-notice"><p>当前没有待办事项</p><span>在聊天中告诉橘伴，需要记录什么。</span></div>
        : <ul className="todo-list-items">{state.items.map(item => (
            <li key={item.id} className={`todo-row${item.status === 'completed' ? ' is-completed' : ''}`}>
              <button className="todo-complete-control" type="button" role="checkbox" aria-checked={item.status === 'completed'} aria-disabled={writing} aria-label={completingId === item.id ? `正在保存：${item.title}` : `${item.status === 'completed' ? '取消完成' : '完成待办'}：${item.title}`} aria-busy={completingId === item.id} title={item.status === 'completed' ? '取消完成' : '标记为已完成'} onClick={() => void changeTodoStatus(item)}>
                <span className="todo-check-mark" aria-hidden="true">{completingId === item.id ? <LoaderCircle className="spinner" /> : item.status === 'completed' ? <Check /> : null}</span>
              </button>
              <div className="todo-row-content">
                <h2>{item.title}</h2>
                <time dateTime={item.created_at} title={`创建于 ${createdTime(item.created_at)}`} aria-label={`创建于 ${createdTime(item.created_at)}`}>{createdDate(item.created_at)} 创建</time>
                {item.status === 'pending' && <button className="todo-reminder-trigger" type="button" disabled={writing} aria-expanded={editor?.id === item.id} onClick={() => editReminder(item)}>
                  <Bell aria-hidden="true" />{item.remind_at ? createdTime(item.remind_at) : '设置提醒'}
                </button>}
                {item.status === 'pending' && editor?.id === item.id && <form className="todo-reminder-editor" onSubmit={event => { event.preventDefault(); void saveReminder() }}>
                  <label htmlFor={`reminder-${item.id}`}>提醒时间</label>
                  <input id={`reminder-${item.id}`} type="datetime-local" value={editor.value} required disabled={writing} onChange={event => { attemptedReminderRef.current = null; setEditor({ ...editor, value: event.target.value }); setScheduleError(null) }} />
                  <p>本地时区：{Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
                  <div className="todo-reminder-editor-actions">
                    <button type="submit" disabled={writing}>{schedulingId === item.id ? <LoaderCircle className="spinner" aria-hidden="true" /> : null}保存</button>
                    <button type="button" disabled={writing} onClick={() => setEditor(null)}>取消</button>
                    {editor.expected && <button type="button" disabled={writing} onClick={() => void saveReminder(true)}>清除提醒</button>}
                  </div>
                  {scheduleError && <p className="todo-completion-error" role="alert">{scheduleError}</p>}
                </form>}
                {completingId === item.id && <span className="sr-only" role="status">{item.status === 'completed' ? '正在取消完成' : '正在保存完成状态'}</span>}
                {completionError?.id === item.id && <p className="todo-completion-error" role="alert">{completionError.message}</p>}
              </div>
            </li>
          ))}</ul>)}
    </section>
  )
}
