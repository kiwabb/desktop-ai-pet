import { Bell, Check, ChevronRight, LoaderCircle, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { completeTodo, createTodo, deleteTodo, listTodos, reopenTodo, setTodoReminder, updateTodoTitle } from '../lib/agent'
import type { Todo } from '../lib/agent'
import { quickReminderOptions, resolveQuickReminder, toLocalInputValue } from '../lib/quick-reminders'
import type { QuickReminderKey } from '../lib/quick-reminders'
import { formatCreatedAt, formatReminderTime, isReminderOverdue, splitReminderLabel } from '../lib/todo-time'
import { groupTodos } from '../lib/todo-sort'
import { watchRowEntrance } from '../lib/row-entrance'
import { isReminderConflict, utilityErrorMessage } from '../lib/utility-feedback'
import './TodoList.css'

type ListState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; items: Todo[] }

interface TodoListProps {
  generation: number
  refreshVersion: number
  onOpenSettings?: () => void
  hidden?: boolean
}

const TITLE_RULE_MESSAGE = '待办标题需为 1 到 2000 个字符'

function titleError(value: string) {
  // Match Rust/Python code-point limits; native maxLength counts UTF-16 units
  // and would silently truncate otherwise valid supplementary characters.
  const trimmed = value.trim()
  return !trimmed || Array.from(trimmed).length > 2000 ? TITLE_RULE_MESSAGE : null
}

/** Remounted for each configuration generation; no chat/model dependency. */
export function TodoList({ generation, refreshVersion, onOpenSettings, hidden = false }: TodoListProps) {
  const [state, setState] = useState<ListState>({ kind: 'loading' })
  const [refresh, setRefresh] = useState(0)
  const [refreshing, setRefreshing] = useState(true)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [now, setNow] = useState(() => new Date())
  const [editor, setEditor] = useState<{ id: string; value: string; expected: string | null } | null>(null)
  const [schedulingId, setSchedulingId] = useState<string | null>(null)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [scheduleConflict, setScheduleConflict] = useState(false)
  const attemptedReminderRef = useRef<{ id: string; input: string; target: string | null } | null>(null)
  const queuedRefreshRef = useRef(false)
  const revisionRef = useRef(refreshVersion)
  const requestRef = useRef(0)
  const busyRef = useRef(true)
  const [completingId, setCompletingId] = useState<string | null>(null)
  const [completionError, setCompletionError] = useState<{ id: string; message: string } | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const availabilityId = useId()
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [titleEditor, setTitleEditor] = useState<{ id: string; value: string } | null>(null)
  const [savingTitleId, setSavingTitleId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [leavingId, setLeavingId] = useState<string | null>(null)
  const [enteringId, setEnteringId] = useState<string | null>(null)
  const [completedOpen, setCompletedOpen] = useState(false)
  const removeTimerRef = useRef<number | null>(null)
  const viewRef = useRef<HTMLElement | null>(null)
  const addInputRef = useRef<HTMLInputElement | null>(null)
  const completedToggleRef = useRef<HTMLButtonElement | null>(null)
  const controlsRef = useRef(new Map<string, HTMLButtonElement>())
  const focusTargetRef = useRef<string | null>(null)
  const editingRef = useRef(false)
  editingRef.current = editor !== null || titleEditor !== null || deleteConfirmId !== null

  useLayoutEffect(() => {
    if (hidden) return
    const target = focusTargetRef.current
    if (!target) return
    focusTargetRef.current = null
    const control = controlsRef.current.get(target)
    if (control) control.focus({ preventScroll: true })
    else if (target === 'completed' && completedToggleRef.current) completedToggleRef.current.focus({ preventScroll: true })
    else addInputRef.current?.focus({ preventScroll: true })
  })

  useEffect(() => {
    const updateClock = () => setNow(new Date())
    const timer = window.setInterval(updateClock, 60_000)
    window.addEventListener('focus', updateClock)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', updateClock) }
  }, [])

  useLayoutEffect(() => {
    if (!enteringId) return
    const settle = () => setEnteringId(current => current === enteringId ? null : current)
    const row = viewRef.current?.querySelector<HTMLElement>('.todo-row.is-entering')
    if (!row) { settle(); return }
    return watchRowEntrance(row, 'todo-row-enter', settle)
  }, [enteringId])

  useEffect(() => {
    const request = ++requestRef.current
    let active = true
    busyRef.current = true
    setRefreshing(true)
    setRefreshError(null)
    setState(current => current.kind === 'ready' ? current : { kind: 'loading' })
    void listTodos().then(result => {
      if (!active || request !== requestRef.current) return
      if (result.generation !== generation) {
        setState({ kind: 'error', message: '助手配置已更换，请刷新待办列表。' })
        return
      }
      setState({ kind: 'ready', items: result.items })
    }).catch((cause: unknown) => {
      if (active && request === requestRef.current) {
        // The raw failure stays in the console for diagnosis; the UI shows a
        // user-readable message beside its recovery actions.
        console.error('[TodoList] 待办列表读取失败', cause)
        const message = utilityErrorMessage(cause, '未能同步待办，请重试。', 'todo')
        setRefreshError(message)
        setState(current => current.kind === 'ready' ? current : { kind: 'error', message })
      }
    }).finally(() => {
      if (active && request === requestRef.current) { setRefreshing(false); releaseBusy() }
    })
    return () => { active = false; requestRef.current++ }
  }, [generation, refresh])

  useEffect(() => () => {
    if (removeTimerRef.current !== null) window.clearTimeout(removeTimerRef.current)
  }, [])

  useEffect(() => {
    if (revisionRef.current === refreshVersion) return
    revisionRef.current = refreshVersion
    if (busyRef.current || editingRef.current) queuedRefreshRef.current = true
    else refreshList()
  }, [refreshVersion])

  useEffect(() => {
    if (!editingRef.current && !busyRef.current && queuedRefreshRef.current) {
      queuedRefreshRef.current = false
      refreshList()
    }
  }, [editor, titleEditor, deleteConfirmId])

  function registerControl(key: string, node: HTMLButtonElement | null) {
    if (node) controlsRef.current.set(key, node)
    else controlsRef.current.delete(key)
  }

  function focusAfterRow(item: Todo) {
    const visible = [...groups.pending, ...(completedOpen ? groups.completed : [])]
    const index = visible.findIndex(existing => existing.id === item.id)
    const neighbor = visible[index + 1] ?? visible[index - 1]
    return neighbor ? `complete:${neighbor.id}` : completedCount > 0 || item.status === 'pending' ? 'completed' : 'add'
  }

  function rowHasFocus(id: string) {
    const active = document.activeElement
    return active instanceof HTMLElement && active.closest<HTMLElement>('[data-todo-row]')?.dataset.todoRow === id
  }

  function closeTitleEditor() {
    if (busyRef.current || !titleEditor) return
    focusTargetRef.current = `edit:${titleEditor.id}`
    setTitleEditor(null)
    setCompletionError(null)
  }

  function closeReminderEditor() {
    if (busyRef.current || !editor) return
    focusTargetRef.current = `reminder:${editor.id}`
    setEditor(null)
    setScheduleError(null)
    setScheduleConflict(false)
    attemptedReminderRef.current = null
  }

  function consumeEditorEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return false
    event.preventDefault()
    event.stopPropagation()
    return !busyRef.current
  }

  function releaseBusy() {
    busyRef.current = false
    if (queuedRefreshRef.current && !editingRef.current) {
      queuedRefreshRef.current = false
      refreshList()
    }
  }

  function refreshList() {
    if (busyRef.current) return
    busyRef.current = true
    setRefreshing(true)
    setRefresh(value => value + 1)
  }

  function refreshManually() {
    if (busyRef.current) return
    // A conflict asks the user to refresh. Discard the stale expected timestamp
    // with its editor so the next edit uses the newly read reminder version.
    if (editor && scheduleConflict) {
      focusTargetRef.current = `reminder:${editor.id}`
      setEditor(null)
      setScheduleError(null)
      setScheduleConflict(false)
      attemptedReminderRef.current = null
    }
    else if (editingRef.current) {
      queuedRefreshRef.current = true
      setNotice('编辑内容已保留，结束编辑后同步列表。')
      return
    }
    setCompletionError(null)
    queuedRefreshRef.current = false
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
      if (rowHasFocus(item.id)) focusTargetRef.current = item.status === 'completed' || completedOpen ? `complete:${item.id}` : focusAfterRow(item)
      if (editor?.id === item.id) setEditor(null)
      if (titleEditor?.id === item.id) setTitleEditor(null)
      setNotice(item.status === 'completed' ? '已恢复待办。' : '已完成一项待办。')
      setState(current => current.kind === 'ready'
        ? { kind: 'ready', items: current.items.map(existing => existing.id === item.id ? result.item : existing) }
        : current)
    }
    catch (cause) {
      console.error('[TodoList] 待办操作失败', cause)
      if (request === requestRef.current)
        setCompletionError({ id: item.id, message: utilityErrorMessage(cause, '未能保存，请重试。', 'todo') })
    }
    finally {
      if (request === requestRef.current) {
        setCompletingId(null)
        releaseBusy()
      }
    }
  }

  async function addTodo() {
    if (busyRef.current || creating || state.kind !== 'ready') return
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
      setNotice('待办已添加。')
      if (document.activeElement === addInputRef.current || document.activeElement === document.body) focusTargetRef.current = 'add'
    }
    catch (cause) {
      console.error('[TodoList] 待办操作失败', cause)
      if (request === requestRef.current) setCreateError(utilityErrorMessage(cause, '未能保存，请重试。', 'todo'))
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
      closeTitleEditor()
      return
    }
    const request = requestRef.current
    const ownedFocus = rowHasFocus(titleEditor.id)
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
      if (rowHasFocus(titleEditor.id) || (ownedFocus && document.activeElement === document.body)) focusTargetRef.current = `edit:${titleEditor.id}`
      setTitleEditor(null)
      setNotice('标题已保存。')
    }
    catch (cause) {
      console.error('[TodoList] 待办操作失败', cause)
      if (request === requestRef.current)
        setCompletionError({ id: titleEditor.id, message: utilityErrorMessage(cause, '未能保存，请重试。', 'todo') })
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
    // Keep the entire row readable until persistence is confirmed.
    const request = requestRef.current
    const ownedFocus = rowHasFocus(item.id)
    try {
      const result = await deleteTodo(item.id)
      if (request !== requestRef.current) return
      if (result.generation !== generation) throw new Error('助手配置已更换，请刷新待办列表。')
      setNotice('待办已删除。')
      setLeavingId(item.id)
      const exitDuration = Number.parseFloat(getComputedStyle(viewRef.current ?? document.documentElement).getPropertyValue('--motion-exit'))
      const exitDelay = Number.isFinite(exitDuration) ? exitDuration : 0
      removeTimerRef.current = window.setTimeout(() => {
        if (request !== requestRef.current) return
        if (rowHasFocus(item.id) || (ownedFocus && document.activeElement === document.body)) focusTargetRef.current = focusAfterRow(item)
        removeTimerRef.current = null
        setState(current => current.kind === 'ready'
          ? { kind: 'ready', items: current.items.filter(existing => existing.id !== item.id) }
          : current)
        setLeavingId(null)
        setDeletingId(null)
        setDeleteConfirmId(null)
        if (editor?.id === item.id) setEditor(null)
        if (titleEditor?.id === item.id) setTitleEditor(null)
        releaseBusy()
      }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : exitDelay)
    }
    catch (cause) {
      console.error('[TodoList] 待办操作失败', cause)
      if (request === requestRef.current) {
        setLeavingId(null)
        setDeletingId(null)
        setCompletionError({ id: item.id, message: utilityErrorMessage(cause, '未能保存，请重试。', 'todo') })
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
    setScheduleConflict(false)
  }

  function applyQuickReminder(key: QuickReminderKey) {
    if (busyRef.current || !editor) return
    if (!quickReminderOptions().some(option => option.key === key)) {
      setNow(new Date())
      setScheduleError('这个快捷时间已经过去，请重新选择。')
      return
    }
    // Save through the same expected_remind_at CAS path as custom input.
    void saveReminder(false, toLocalInputValue(resolveQuickReminder(key)))
  }

  async function saveReminder(clear = false, overrideValue?: string) {
    if (busyRef.current || !editor) return
    setScheduleConflict(false)
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
    const ownedFocus = rowHasFocus(editor.id)
    busyRef.current = true
    setSchedulingId(editor.id)
    setScheduleError(null)
    setScheduleConflict(false)
    try {
      const result = await setTodoReminder(editor.id, target, editor.expected)
      if (request !== requestRef.current) return
      if (result.generation !== generation) throw new Error('助手配置已更换，请刷新待办列表。')
      setState(current => current.kind === 'ready'
        ? { kind: 'ready', items: current.items.map(item => item.id === result.item.id ? result.item : item) }
        : current)
      if (rowHasFocus(editor.id) || (ownedFocus && document.activeElement === document.body)) focusTargetRef.current = `reminder:${editor.id}`
      setEditor(null)
      setNotice(clear ? '提醒已清除。' : '提醒已保存。')
    }
    catch (cause) {
      console.error('[TodoList] 待办操作失败', cause)
      if (request === requestRef.current) {
        setScheduleError(utilityErrorMessage(cause, '未能保存，请重试。', 'reminder'))
        setScheduleConflict(isReminderConflict(cause))
      }
    }
    finally {
      if (request === requestRef.current) {
        setSchedulingId(null)
        releaseBusy()
      }
    }
  }

  const groups = useMemo(() => state.kind === 'ready' ? groupTodos(state.items) : { pending: [], completed: [] }, [state])
  const quickOptions = useMemo(() => quickReminderOptions(now), [now])
  const pendingCount = groups.pending.length
  const completedCount = groups.completed.length

  const writing = completingId !== null || schedulingId !== null || creating || savingTitleId !== null || deletingId !== null
  const unavailableReason = state.kind === 'error'
    ? '列表尚未同步，暂不能添加。可以先写下草稿。'
    : refreshing ? '正在同步列表，完成后可添加。' : null
  const loadError = state.kind === 'error' ? state.message : refreshError

  function renderRow(item: Todo) {
    return (
      <li key={item.id} data-todo-row={item.id} className={`todo-row${item.status === 'completed' ? ' is-completed' : ''}${leavingId === item.id ? ' is-leaving' : ''}${enteringId === item.id ? ' is-entering' : ''}${titleEditor?.id === item.id ? ' is-editing-title' : ''}${editor?.id === item.id ? ' is-editing-reminder' : ''}${deleteConfirmId === item.id ? ' is-confirming-delete' : ''}`}>
        <button ref={node => registerControl(`complete:${item.id}`, node)} className="todo-complete-control" type="button" role="checkbox" aria-checked={item.status === 'completed'} aria-disabled={writing || refreshing} aria-label={completingId === item.id ? `正在保存：${item.title}` : `${item.status === 'completed' ? '取消完成' : '完成待办'}：${item.title}`} aria-busy={completingId === item.id} title={item.status === 'completed' ? '取消完成' : '标记为已完成'} onClick={() => void changeTodoStatus(item)}>
          <span className="todo-check-mark" aria-hidden="true">{completingId === item.id ? <LoaderCircle className="spinner" /> : item.status === 'completed' ? <Check /> : null}</span>
        </button>
        <div className="todo-row-content">
          {titleEditor?.id === item.id
            ? <form className="todo-title-editor" onKeyDown={event => { if (consumeEditorEscape(event)) closeTitleEditor() }} onSubmit={event => { event.preventDefault(); void saveTitle() }}>
                <input value={titleEditor.value} readOnly={writing} autoFocus aria-label="编辑待办标题"
                  onChange={event => { setTitleEditor({ ...titleEditor, value: event.target.value }); setCompletionError(null) }}
                  />
                <div className="todo-title-editor-actions">
                  <button type="submit" disabled={writing || refreshing}>{savingTitleId === item.id ? <LoaderCircle className="spinner" aria-hidden="true" /> : null}保存</button>
                  <button type="button" disabled={writing || refreshing} onClick={closeTitleEditor}>取消</button>
                </div>
              </form>
            : <h2 title={`创建于 ${formatCreatedAt(item.created_at)}`}>{item.title}</h2>}
          <time className="sr-only" dateTime={item.created_at} aria-label={`创建于 ${formatCreatedAt(item.created_at)}`}>{`创建于 ${formatCreatedAt(item.created_at)}`}</time>
          {item.status === 'pending' && editor?.id === item.id && <form className="todo-reminder-editor" id={`reminder-editor-${item.id}`} onKeyDown={event => { if (consumeEditorEscape(event)) closeReminderEditor() }} onSubmit={event => { event.preventDefault(); void saveReminder() }}>
            <div className="todo-reminder-quick" role="group" aria-label="快捷提醒时间">
              {quickOptions.map(option => (
                <button key={option.key} type="button" disabled={writing || refreshing} onClick={() => applyQuickReminder(option.key)}>{option.label}</button>
              ))}
            </div>
            <label htmlFor={`reminder-${item.id}`}>自定义提醒时间</label>
            <input id={`reminder-${item.id}`} type="datetime-local" value={editor.value} required readOnly={writing} autoFocus onChange={event => { attemptedReminderRef.current = null; setEditor({ ...editor, value: event.target.value }); setScheduleError(null) }} />
            <p>按本机时间提醒（{Intl.DateTimeFormat().resolvedOptions().timeZone}）。</p>
            <div className="todo-reminder-editor-actions">
              <button type="submit" disabled={writing || refreshing}>{schedulingId === item.id ? <LoaderCircle className="spinner" aria-hidden="true" /> : null}保存</button>
              <button type="button" disabled={writing || refreshing} onClick={closeReminderEditor}>取消</button>
              {editor.expected && <button type="button" disabled={writing || refreshing} onClick={() => void saveReminder(true)}>清除提醒</button>}
            </div>
            {scheduleError && <p className="todo-completion-error" role="alert">{scheduleError}</p>}
          </form>}
          {completingId === item.id && <span className="sr-only" role="status">{item.status === 'completed' ? '正在取消完成' : '正在保存完成状态'}</span>}
          {completionError?.id === item.id && <p className="todo-completion-error" role="alert">{completionError.message}</p>}
        </div>
        {item.status === 'pending' && (() => {
          const label = item.remind_at ? formatReminderTime(item.remind_at, now) : '设提醒'
          const overdue = item.remind_at !== null && isReminderOverdue(item.remind_at, now)
          const parts = splitReminderLabel(label)
          return (
            <button ref={node => registerControl(`reminder:${item.id}`, node)} className={`todo-reminder-chip${item.remind_at ? '' : ' is-empty'}${overdue ? ' is-overdue' : ''}`} type="button" disabled={writing || refreshing} aria-expanded={editor?.id === item.id} aria-controls={editor?.id === item.id ? `reminder-editor-${item.id}` : undefined}
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
          <button ref={node => registerControl(`edit:${item.id}`, node)} className="todo-row-action" type="button" disabled={writing || refreshing} title="编辑标题" aria-label={`编辑待办标题：${item.title}`} onClick={() => editTitle(item)}>
            <Pencil aria-hidden="true" />
          </button>
          <button ref={node => registerControl(`delete:${item.id}`, node)} className="todo-row-action is-danger" type="button" disabled={writing || refreshing} title="删除" aria-label={`删除待办：${item.title}`} aria-busy={deletingId === item.id} onClick={() => { setDeleteConfirmId(item.id); setCompletionError(null) }}>
            {deletingId === item.id ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
          </button>
        </div>
        {deleteConfirmId === item.id && <div className="todo-delete-confirm" onKeyDown={event => {
          if (consumeEditorEscape(event)) { focusTargetRef.current = `delete:${item.id}`; setDeleteConfirmId(null) }
        }}>
          <p>{deletingId === item.id ? '正在删除，等待保存结果…' : '删除这项待办？删除后无法恢复。'}</p>
          <div><button type="button" className="is-danger" disabled={writing || refreshing} onClick={() => void removeTodo(item)}>{deletingId === item.id ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}确认删除</button>
          <button type="button" autoFocus disabled={writing || refreshing} onClick={() => { focusTargetRef.current = `delete:${item.id}`; setDeleteConfirmId(null) }}>保留</button></div>
        </div>}
      </li>
    )
  }

  return (
    <section ref={viewRef} className="todo-list-view" aria-label="待办列表" hidden={hidden} style={hidden ? { display: 'none' } : undefined}>
      <div className="todo-list-toolbar">
        <p className="todo-list-count" aria-live="polite">
          {state.kind === 'ready' ? <><strong>{pendingCount}</strong> 待完成<span className="todo-count-divider" aria-hidden="true" /><span>{completedCount} 已完成</span></> : '待办事项'}
        </p>
        <button className="todo-refresh-button" type="button" disabled={refreshing || writing} onClick={refreshManually}>
          <RefreshCw className={refreshing ? 'spinner' : undefined} aria-hidden="true" />{refreshing ? '同步中' : '刷新'}
        </button>
      </div>
      <p className="todo-companion-helper">把要做的事记下来，一件一件慢慢来。</p>
      <form className="todo-add-form" onSubmit={event => { event.preventDefault(); void addTodo() }}>
        <input ref={addInputRef} value={newTitle} readOnly={creating} placeholder="添加一件要做的事…" aria-label="新待办标题" aria-describedby={unavailableReason ? availabilityId : undefined}
          onChange={event => { setNewTitle(event.target.value); setCreateError(null) }} />
        <button type="submit" disabled={state.kind !== 'ready' || writing || refreshing || !newTitle.trim()} aria-label="添加待办" aria-describedby={unavailableReason ? availabilityId : undefined}>
          {creating ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Plus aria-hidden="true" />}添加
        </button>
      </form>
      {unavailableReason && <p id={availabilityId} className="todo-create-availability">{unavailableReason}</p>}
      <p className="todo-feedback" role="status">{notice}</p>
      {loadError && <div className="todo-list-recovery">
        <p role="alert">{loadError}</p>
        {state.kind === 'ready' && <p className="todo-recovery-detail">当前保留上次同步的列表。</p>}
        <div className="todo-recovery-actions">
          <button type="button" disabled={refreshing || writing} onClick={refreshManually} aria-label="重试同步待办"><RefreshCw aria-hidden="true" />重试</button>
          {onOpenSettings && <button type="button" disabled={writing} onClick={onOpenSettings}>连接设置</button>}
        </div>
      </div>}
      {createError && <p className="todo-completion-error todo-create-error" role="alert">{createError}</p>}
      {state.kind === 'loading' && <div className="todo-list-notice" role="status"><LoaderCircle className="spinner" aria-hidden="true" /><p>正在读取待办…</p></div>}
      {state.kind === 'ready' && (state.items.length === 0
        ? <div className="todo-list-notice"><p>当前没有待办事项</p><span>写下接下来要做的事，也可以在聊天中交给橘伴。</span></div>
        : <>
            {groups.pending.length > 0
              ? <ul className="todo-list-items">{groups.pending.map(renderRow)}</ul>
              : <p className="todo-group-empty">待完成的事项都处理完了。</p>}
            {groups.completed.length > 0 && <div className="todo-completed-group">
              <button ref={completedToggleRef} className="todo-completed-toggle" type="button" aria-expanded={completedOpen} onClick={() => setCompletedOpen(open => !open)}>
                <ChevronRight aria-hidden="true" />已完成（{completedCount}）
              </button>
              {completedOpen && <ul className="todo-list-items">{groups.completed.map(renderRow)}</ul>}
            </div>}
          </>)}
    </section>
  )
}
