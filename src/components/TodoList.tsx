import { Bell, Check, ChevronRight, LoaderCircle, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { completeTodo, createTodo, deleteTodo, listTodos, reopenTodo, setTodoReminder, updateTodoTitle } from '../lib/agent'
import type { Todo } from '../lib/agent'
import { QUICK_REMINDER_OPTIONS, resolveQuickReminder, toLocalInputValue } from '../lib/quick-reminders'
import type { QuickReminderKey } from '../lib/quick-reminders'
import { formatCreatedAt, formatReminderTime, isReminderOverdue, splitReminderLabel } from '../lib/todo-time'
import { groupTodos } from '../lib/todo-sort'
import './TodoList.css'

type ListState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; items: Todo[] }

const TITLE_RULE_MESSAGE = '待办标题需为 1 到 2000 个字符'

function titleError(value: string) {
  const trimmed = value.trim()
  return !trimmed || Array.from(trimmed).length > 2000 ? TITLE_RULE_MESSAGE : null
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
  const [newTitle, setNewTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [titleEditor, setTitleEditor] = useState<{ id: string; value: string } | null>(null)
  const [savingTitleId, setSavingTitleId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [leavingId, setLeavingId] = useState<string | null>(null)
  const [enteringId, setEnteringId] = useState<string | null>(null)
  const [completedOpen, setCompletedOpen] = useState(false)
  const removeTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const request = ++requestRef.current
    let active = true
    busyRef.current = true
    setState({ kind: 'loading' })
    setCompletionError(null)
    setCreateError(null)
    setEditor(null)
    setTitleEditor(null)
    setLeavingId(null)
    setEnteringId(null)
    if (removeTimerRef.current !== null) {
      window.clearTimeout(removeTimerRef.current)
      removeTimerRef.current = null
    }
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

  useEffect(() => () => {
    if (removeTimerRef.current !== null) window.clearTimeout(removeTimerRef.current)
  }, [])

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

  async function addTodo() {
    if (busyRef.current || creating) return
    const invalid = titleError(newTitle)
    if (invalid) {
      setCreateError(invalid)
      return
    }
    busyRef.current = true
    setCreating(true)
    setCreateError(null)
    const request = requestRef.current
    try {
      const result = await createTodo(newTitle.trim())
      if (request !== requestRef.current) return
      if (result.generation !== generation) throw new Error('助手配置已更换，请刷新待办列表。')
      setState(current => current.kind === 'ready'
        ? { kind: 'ready', items: [...current.items, result.item] }
        : current)
      setEnteringId(result.item.id)
      setNewTitle('')
    }
    catch (cause) {
      if (request === requestRef.current) setCreateError(cause instanceof Error ? cause.message : String(cause))
    }
    finally {
      if (request === requestRef.current) {
        setCreating(false)
        releaseBusy()
      }
    }
  }

  function editTitle(item: Todo) {
    if (busyRef.current) return
    setCompletionError(null)
    setTitleEditor({ id: item.id, value: item.title })
  }

  async function saveTitle() {
    if (busyRef.current || !titleEditor) return
    const invalid = titleError(titleEditor.value)
    if (invalid) {
      setCompletionError({ id: titleEditor.id, message: invalid })
      return
    }
    const current = state.kind === 'ready' ? state.items.find(item => item.id === titleEditor.id) : undefined
    const title = titleEditor.value.trim()
    if (current && current.title === title) {
      setTitleEditor(null)
      return
    }
    const request = requestRef.current
    busyRef.current = true
    setSavingTitleId(titleEditor.id)
    setCompletionError(null)
    try {
      const result = await updateTodoTitle(titleEditor.id, title)
      if (request !== requestRef.current) return
      if (result.generation !== generation) throw new Error('助手配置已更换，请刷新待办列表。')
      setState(currentState => currentState.kind === 'ready'
        ? { kind: 'ready', items: currentState.items.map(item => item.id === result.item.id ? result.item : item) }
        : currentState)
      setTitleEditor(null)
    }
    catch (cause) {
      if (request === requestRef.current)
        setCompletionError({ id: titleEditor.id, message: cause instanceof Error ? cause.message : String(cause) })
    }
    finally {
      if (request === requestRef.current) {
        setSavingTitleId(null)
        releaseBusy()
      }
    }
  }

  async function removeTodo(item: Todo) {
    if (busyRef.current) return
    busyRef.current = true
    setDeletingId(item.id)
    setCompletionError(null)
    // The fade-out starts immediately; the row leaves the list once the
    // transition has played and the deletion is durably confirmed.
    setLeavingId(item.id)
    const request = requestRef.current
    try {
      const result = await deleteTodo(item.id)
      if (request !== requestRef.current) return
      if (result.generation !== generation) throw new Error('助手配置已更换，请刷新待办列表。')
      removeTimerRef.current = window.setTimeout(() => {
        removeTimerRef.current = null
        setState(current => current.kind === 'ready'
          ? { kind: 'ready', items: current.items.filter(existing => existing.id !== item.id) }
          : current)
        setLeavingId(null)
        setDeletingId(null)
        if (editor?.id === item.id) setEditor(null)
        if (titleEditor?.id === item.id) setTitleEditor(null)
        releaseBusy()
      }, 180)
    }
    catch (cause) {
      if (request === requestRef.current) {
        setLeavingId(null)
        setDeletingId(null)
        setCompletionError({ id: item.id, message: cause instanceof Error ? cause.message : String(cause) })
        releaseBusy()
      }
    }
  }

  function editReminder(item: Todo) {
    if (busyRef.current) return
    const date = item.remind_at ? new Date(item.remind_at) : null
    const local = date && !Number.isNaN(date.getTime()) ? toLocalInputValue(date) : ''
    attemptedReminderRef.current = null
    setEditor({ id: item.id, value: local, expected: item.remind_at })
    setScheduleError(null)
  }

  function applyQuickReminder(key: QuickReminderKey) {
    if (busyRef.current || !editor) return
    // Quick picks resolve to a guaranteed-future local time and save through
    // the same expected_remind_at CAS path as the custom input.
    void saveReminder(false, toLocalInputValue(resolveQuickReminder(key)))
  }

  async function saveReminder(clear = false, overrideValue?: string) {
    if (busyRef.current || !editor) return
    const attempt = attemptedReminderRef.current
    const inputValue = overrideValue ?? editor.value
    const input = clear ? 'clear' : inputValue
    let target: string | null
    if (attempt?.id === editor.id && attempt.input === input) target = attempt.target
    else {
      const date = new Date(inputValue)
      if (!clear && (!inputValue || Number.isNaN(date.getTime()) || date.getTime() <= Date.now())) {
        setScheduleError('请选择一个未来的提醒时间。')
        return
      }
      if (!clear) {
        const normalized = toLocalInputValue(date)
        if (normalized !== inputValue) {
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

  const groups = state.kind === 'ready' ? groupTodos(state.items) : { pending: [] as Todo[], completed: [] as Todo[] }
  const pendingCount = groups.pending.length
  const completedCount = groups.completed.length

  const writing = completingId !== null || schedulingId !== null || creating || savingTitleId !== null || deletingId !== null

  function renderRow(item: Todo) {
    return (
      <li key={item.id} className={`todo-row${item.status === 'completed' ? ' is-completed' : ''}${leavingId === item.id ? ' is-leaving' : ''}${enteringId === item.id ? ' is-entering' : ''}${titleEditor?.id === item.id ? ' is-editing-title' : ''}${editor?.id === item.id ? ' is-editing-reminder' : ''}`}>
        <button className="todo-complete-control" type="button" role="checkbox" aria-checked={item.status === 'completed'} aria-disabled={writing} aria-label={completingId === item.id ? `正在保存：${item.title}` : `${item.status === 'completed' ? '取消完成' : '完成待办'}：${item.title}`} aria-busy={completingId === item.id} title={item.status === 'completed' ? '取消完成' : '标记为已完成'} onClick={() => void changeTodoStatus(item)}>
          <span className="todo-check-mark" aria-hidden="true">{completingId === item.id ? <LoaderCircle className="spinner" /> : item.status === 'completed' ? <Check /> : null}</span>
        </button>
        <div className="todo-row-content">
          {titleEditor?.id === item.id
            ? <form className="todo-title-editor" onSubmit={event => { event.preventDefault(); void saveTitle() }}>
                <input value={titleEditor.value} disabled={writing} autoFocus maxLength={2000} aria-label="编辑待办标题"
                  onChange={event => { setTitleEditor({ ...titleEditor, value: event.target.value }); setCompletionError(null) }}
                  onKeyDown={event => { if (event.key === 'Escape') setTitleEditor(null) }} />
                <div className="todo-title-editor-actions">
                  <button type="submit" disabled={writing}>{savingTitleId === item.id ? <LoaderCircle className="spinner" aria-hidden="true" /> : null}保存</button>
                  <button type="button" disabled={writing} onClick={() => setTitleEditor(null)}>取消</button>
                </div>
              </form>
            : <h2 title={`创建于 ${formatCreatedAt(item.created_at)}`}>{item.title}</h2>}
          <time className="sr-only" dateTime={item.created_at} aria-label={`创建于 ${formatCreatedAt(item.created_at)}`}>{`创建于 ${formatCreatedAt(item.created_at)}`}</time>
          {item.status === 'pending' && editor?.id === item.id && <form className="todo-reminder-editor" onSubmit={event => { event.preventDefault(); void saveReminder() }}>
            <div className="todo-reminder-quick" role="group" aria-label="快捷提醒时间">
              {QUICK_REMINDER_OPTIONS.map(option => (
                <button key={option.key} type="button" disabled={writing} onClick={() => applyQuickReminder(option.key)}>{option.label}</button>
              ))}
            </div>
            <label htmlFor={`reminder-${item.id}`}>自定义提醒时间</label>
            <input id={`reminder-${item.id}`} type="datetime-local" value={editor.value} required disabled={writing} autoFocus onChange={event => { attemptedReminderRef.current = null; setEditor({ ...editor, value: event.target.value }); setScheduleError(null) }} />
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
        {item.status === 'pending' && (() => {
          const label = item.remind_at ? formatReminderTime(item.remind_at) : '设提醒'
          const overdue = item.remind_at !== null && isReminderOverdue(item.remind_at)
          const parts = splitReminderLabel(label)
          return (
            <button className={`todo-reminder-chip${item.remind_at ? '' : ' is-empty'}${overdue ? ' is-overdue' : ''}`} type="button" disabled={writing} aria-expanded={editor?.id === item.id}
              title={item.remind_at ? `提醒时间：${formatCreatedAt(item.remind_at)}` : '设置提醒'}
              aria-label={item.remind_at ? `${overdue ? '提醒已逾期' : '提醒时间'}：${formatCreatedAt(item.remind_at)}` : `设置提醒：${item.title}`}
              onClick={() => editReminder(item)}>
              <Bell aria-hidden="true" />
              {parts.day && <span className="todo-reminder-chip-day">{parts.day}</span>}
              <span className="todo-reminder-chip-time">{parts.time}</span>
            </button>
          )
        })()}
        <div className="todo-row-actions">
          <button className="todo-row-action" type="button" disabled={writing} title="编辑标题" aria-label={`编辑待办标题：${item.title}`} onClick={() => editTitle(item)}>
            <Pencil aria-hidden="true" />
          </button>
          <button className="todo-row-action is-danger" type="button" disabled={writing} title="删除" aria-label={`删除待办：${item.title}`} aria-busy={deletingId === item.id} onClick={() => void removeTodo(item)}>
            {deletingId === item.id ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
          </button>
        </div>
      </li>
    )
  }

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
      <form className="todo-add-form" onSubmit={event => { event.preventDefault(); void addTodo() }}>
        <input value={newTitle} disabled={state.kind !== 'ready' || writing} maxLength={2000} placeholder="记录一项待办…" aria-label="新待办标题"
          onChange={event => { setNewTitle(event.target.value); setCreateError(null) }} />
        <button type="submit" disabled={state.kind !== 'ready' || writing || !newTitle.trim()} aria-label="添加待办">
          {creating ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Plus aria-hidden="true" />}添加
        </button>
      </form>
      {createError && <p className="todo-completion-error todo-create-error" role="alert">{createError}</p>}
      {state.kind === 'loading' && <div className="todo-list-notice" role="status"><LoaderCircle className="spinner" aria-hidden="true" /><p>正在读取待办…</p></div>}
      {state.kind === 'error' && <div className="todo-list-notice is-error" role="alert"><p>{state.message}</p><span>点击刷新重试。</span></div>}
      {state.kind === 'ready' && (state.items.length === 0
        ? <div className="todo-list-notice"><p>当前没有待办事项</p><span>在聊天中告诉橘伴，需要记录什么。</span></div>
        : <>
            {groups.pending.length > 0
              ? <ul className="todo-list-items">{groups.pending.map(renderRow)}</ul>
              : <p className="todo-group-empty">待完成的事项都处理完了。</p>}
            {groups.completed.length > 0 && <div className="todo-completed-group">
              <button className="todo-completed-toggle" type="button" aria-expanded={completedOpen} onClick={() => setCompletedOpen(open => !open)}>
                <ChevronRight aria-hidden="true" />已完成（{completedCount}）
              </button>
              {completedOpen && <ul className="todo-list-items">{groups.completed.map(renderRow)}</ul>}
            </div>}
          </>)}
    </section>
  )
}
