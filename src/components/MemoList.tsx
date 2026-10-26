import { Archive, ArchiveRestore, Bell, ChevronRight, LoaderCircle, Plus, RefreshCw, X } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { archiveMemo, createMemo, listMemos } from '../lib/agent'
import type { Memo, MemoKind } from '../lib/agent'
import { toLocalInputValue } from '../lib/quick-reminders'
import { formatCreatedAt, formatReminderTime, isReminderOverdue } from '../lib/todo-time'
import { groupMemos } from '../lib/memo-sort'
import { utilityErrorMessage } from '../lib/utility-feedback'
import './MemoList.css'

type ListState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; items: Memo[] }

interface MemoListProps {
  generation: number
  refreshVersion: number
  onOpenSettings?: () => void
  hidden?: boolean
}

const TITLE_RULE_MESSAGE = '备忘标题需为 1 到 2000 个字符'
const CONTENT_RULE_MESSAGE = '备忘正文需为不超过 20000 个字符'

function titleError(value: string) {
  // Match Rust/Python code-point limits; native maxLength counts UTF-16 units
  // and would silently truncate otherwise valid supplementary characters.
  const trimmed = value.trim()
  return !trimmed || Array.from(trimmed).length > 2000 ? TITLE_RULE_MESSAGE : null
}

function contentError(value: string) {
  return value.trim() && Array.from(value.trim()).length > 20000 ? CONTENT_RULE_MESSAGE : null
}

/** Remounted for each configuration generation; no chat/model dependency. */
export function MemoList({ generation, refreshVersion, onOpenSettings, hidden = false }: MemoListProps) {
  const [state, setState] = useState<ListState>({ kind: 'loading' })
  const [refresh, setRefresh] = useState(0)
  const [refreshing, setRefreshing] = useState(true)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [now, setNow] = useState(() => new Date())
  const [archivingId, setArchivingId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newKind, setNewKind] = useState<MemoKind>('note')
  const [newContent, setNewContent] = useState('')
  const [newReviewAt, setNewReviewAt] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const editorId = useId()
  const availabilityId = `${editorId}-availability`
  const queuedRefreshRef = useRef(false)
  const revisionRef = useRef(refreshVersion)
  const requestRef = useRef(0)
  const busyRef = useRef(true)
  const addInputRef = useRef<HTMLInputElement | null>(null)
  const editorToggleRef = useRef<HTMLButtonElement | null>(null)

  useLayoutEffect(() => {
    if (editorOpen && !hidden) addInputRef.current?.focus({ preventScroll: true })
  }, [editorOpen, hidden])

  function closeEditor() {
    if (creating) return
    // Keep the mounted inputs and all draft state, including the selected kind
    // and review time. Only a confirmed create clears the submitted draft.
    setEditorOpen(false)
    editorToggleRef.current?.focus({ preventScroll: true })
  }

  function handleEditorEscape(event: KeyboardEvent) {
    if (hidden || !editorOpen || event.defaultPrevented || event.key !== 'Escape' || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    event.preventDefault()
    event.stopPropagation()
    closeEditor()
  }

  useEffect(() => {
    const updateClock = () => setNow(new Date())
    const timer = window.setInterval(updateClock, 60_000)
    window.addEventListener('focus', updateClock)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', updateClock) }
  }, [])

  useEffect(() => {
    const request = ++requestRef.current
    let active = true
    busyRef.current = true
    setRefreshing(true)
    setRefreshError(null)
    setState(current => current.kind === 'ready' ? current : { kind: 'loading' })
    void listMemos({ includeArchived: true }).then(result => {
      if (!active || request !== requestRef.current) return
      if (result.generation !== generation) {
        setState({ kind: 'error', message: '助手配置已更换，请刷新备忘录。' })
        return
      }
      setState({ kind: 'ready', items: result.items })
    }).catch((cause: unknown) => {
      if (active && request === requestRef.current) {
        // The raw failure stays in the console for diagnosis; the UI shows a
        // user-readable message beside its recovery actions.
        console.error('[MemoList] 备忘录读取失败', cause)
        const message = utilityErrorMessage(cause, '未能同步备忘，请重试。', 'memo')
        setRefreshError(message)
        setState(current => current.kind === 'ready' ? current : { kind: 'error', message })
      }
    }).finally(() => {
      if (active && request === requestRef.current) { setRefreshing(false); releaseBusy() }
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
    setRefreshing(true)
    setRefresh(value => value + 1)
  }

  function refreshManually() {
    if (busyRef.current) return
    setRowError(null)
    queuedRefreshRef.current = false
    refreshList()
  }

  async function addMemo() {
    if (busyRef.current || creating || state.kind !== 'ready') return
    const invalidTitle = titleError(newTitle)
    if (invalidTitle) {
      setCreateError(invalidTitle)
      return
    }
    const invalidContent = contentError(newContent)
    if (invalidContent) {
      setCreateError(invalidContent)
      return
    }
    let reviewAt: string | null = null
    if (newReviewAt) {
      const date = new Date(newReviewAt)
      if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
        setCreateError('请选择一个未来的回顾时间。')
        return
      }
      if (toLocalInputValue(date) !== newReviewAt) {
        setCreateError('该本地时间不存在，请重新选择回顾时间。')
        return
      }
      reviewAt = date.toISOString()
    }
    busyRef.current = true
    setCreating(true)
    setCreateError(null)
    const request = requestRef.current
    const kind = newKind
    try {
      const result = await createMemo(newTitle.trim(), kind, newContent.trim() || null, reviewAt)
      if (request !== requestRef.current) return
      if (result.generation !== generation) throw new Error('助手配置已更换，请刷新备忘录。')
      setState(current => current.kind === 'ready'
        ? { kind: 'ready', items: [...current.items, result.item] }
        : current)
      setNewTitle('')
      setNewContent('')
      setNewReviewAt('')
      setNotice(kind === 'goal' ? '长期目标已记录。' : '备忘已记录。')
      if (document.activeElement === document.body) addInputRef.current?.focus({ preventScroll: true })
    }
    catch (cause) {
      console.error('[MemoList] 备忘操作失败', cause)
      if (request === requestRef.current) setCreateError(utilityErrorMessage(cause, '未能保存，请重试。', 'memo'))
    }
    finally {
      if (request === requestRef.current) {
        setCreating(false)
        releaseBusy()
      }
    }
  }

  async function toggleArchive(item: Memo) {
    if (busyRef.current) return
    busyRef.current = true
    setArchivingId(item.id)
    setRowError(null)
    const request = requestRef.current
    try {
      const result = await archiveMemo(item.id, item.status !== 'archived')
      if (request !== requestRef.current) return
      if (result.generation !== generation) throw new Error('助手配置已更换，请刷新备忘录。')
      setState(current => current.kind === 'ready'
        ? { kind: 'ready', items: current.items.map(existing => existing.id === item.id ? result.item : existing) }
        : current)
      setNotice(item.status === 'archived' ? '已取消归档。' : '已归档一条备忘。')
    }
    catch (cause) {
      console.error('[MemoList] 备忘操作失败', cause)
      if (request === requestRef.current)
        setRowError({ id: item.id, message: utilityErrorMessage(cause, '未能保存，请重试。', 'memo') })
    }
    finally {
      if (request === requestRef.current) {
        setArchivingId(null)
        releaseBusy()
      }
    }
  }

  const groups = useMemo(() => state.kind === 'ready' ? groupMemos(state.items) : { goals: [], notes: [], archived: [] }, [state])
  const writing = archivingId !== null || creating
  const unavailableReason = state.kind === 'error'
    ? '列表尚未同步，暂不能保存。收起会保留草稿。'
    : refreshing ? '正在同步列表，完成后可保存。' : null
  const loadError = state.kind === 'error' ? state.message : refreshError

  function renderRow(item: Memo) {
    const archived = item.status === 'archived'
    const overdue = item.review_at !== null && isReminderOverdue(item.review_at, now)
    return (
      <li key={item.id} data-memo-row={item.id} className={`memo-row${archived ? ' is-archived' : ''}`}>
        <div className="memo-row-content">
          <h2 title={`创建于 ${formatCreatedAt(item.created_at)}`}>{item.title}</h2>
          <time className="sr-only" dateTime={item.created_at} aria-label={`创建于 ${formatCreatedAt(item.created_at)}`}>{`创建于 ${formatCreatedAt(item.created_at)}`}</time>
          {item.content && <p className="memo-row-text">{item.content}</p>}
          {item.review_at && <p className={`memo-review-chip${overdue ? ' is-overdue' : ''}`}>
            <Bell aria-hidden="true" />
            <time dateTime={item.review_at}>{`回顾时间：${formatReminderTime(item.review_at, now)}`}</time>
          </p>}
          {archivingId === item.id && <span className="sr-only" role="status">{archived ? '正在取消归档' : '正在归档'}</span>}
          {rowError?.id === item.id && <p className="memo-row-error" role="alert">{rowError.message}</p>}
        </div>
        <div className="memo-row-actions">
          <button className="memo-row-action" type="button" disabled={writing || refreshing} aria-busy={archivingId === item.id}
            title={archived ? '取消归档' : '归档'}
            aria-label={archivingId === item.id ? `正在保存：${item.title}` : `${archived ? '取消归档' : '归档'}备忘：${item.title}`}
            onClick={() => void toggleArchive(item)}>
            {archivingId === item.id ? <LoaderCircle className="spinner" aria-hidden="true" /> : archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
          </button>
        </div>
      </li>
    )
  }

  return (
    <section className="memo-list-view" aria-label="备忘录" onKeyDown={handleEditorEscape} hidden={hidden} style={hidden ? { display: 'none' } : undefined}>
      <div className="memo-list-toolbar">
        <p className="memo-list-count" aria-live="polite">
          {state.kind === 'ready' ? <><strong>{groups.goals.length}</strong> 长期目标<span className="memo-count-divider" aria-hidden="true" /><span>{groups.notes.length} 备忘</span></> : '备忘录'}
        </p>
        <div className="memo-toolbar-actions">
          <button className="memo-refresh-button" type="button" disabled={refreshing || writing} onClick={refreshManually} aria-label={refreshing ? '正在同步备忘录' : '刷新备忘录'} title="刷新备忘录">
            <RefreshCw className={refreshing ? 'spinner' : undefined} aria-hidden="true" />
          </button>
          <button ref={editorToggleRef} className="memo-editor-toggle" type="button" disabled={creating} aria-expanded={editorOpen} aria-controls={editorId}
            onClick={() => { if (editorOpen) closeEditor(); else setEditorOpen(true) }}>
            {editorOpen ? <X aria-hidden="true" /> : <Plus aria-hidden="true" />}{editorOpen ? '收起编辑' : '新建备忘'}
            {!editorOpen && (newTitle || newContent || newReviewAt) && <span className="memo-draft-indicator">草稿</span>}
          </button>
        </div>
      </div>
      <p className="memo-companion-helper">灵感、心愿和小事，都可以收在这里。</p>
      <form id={editorId} className="memo-add-form" hidden={!editorOpen} aria-label="新建备忘" aria-busy={creating} onSubmit={event => { event.preventDefault(); void addMemo() }}>
        <div className="memo-add-row">
          <label className="memo-title-field">标题
            <input ref={addInputRef} value={newTitle} readOnly={creating} placeholder="想记住什么？" aria-label="新备忘标题" aria-describedby={unavailableReason ? availabilityId : undefined}
              onChange={event => { setNewTitle(event.target.value); setCreateError(null) }} />
          </label>
          <label className="memo-kind-field">类型
            <select value={newKind} disabled={creating} aria-label="备忘类型"
              onChange={event => { setNewKind(event.target.value === 'goal' ? 'goal' : 'note'); setCreateError(null) }}>
              <option value="note">备忘</option>
              <option value="goal">长期目标</option>
            </select>
          </label>
        </div>
        <label className="memo-content-field"><span className="memo-field-label">正文 <span>可选</span></span>
          <textarea value={newContent} readOnly={creating} rows={2} placeholder="补充细节（可选）" aria-label="新备忘正文"
            onChange={event => { setNewContent(event.target.value); setCreateError(null) }} />
        </label>
        <div className="memo-add-row">
          <label className="memo-add-review">回顾时间 · 可选
            <input type="datetime-local" value={newReviewAt} readOnly={creating} aria-label="新备忘回顾时间"
              onChange={event => { setNewReviewAt(event.target.value); setCreateError(null) }} />
          </label>
        </div>
        <div className="memo-editor-footer">
          <p id={availabilityId}>{unavailableReason ?? '收起编辑会保留草稿。'}</p>
          <button type="submit" disabled={state.kind !== 'ready' || writing || refreshing || !newTitle.trim()} aria-label="添加备忘" aria-describedby={availabilityId}>
            {creating ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Plus aria-hidden="true" />}{creating ? '保存中' : '保存备忘'}
          </button>
        </div>
        {createError && <p className="memo-row-error memo-create-error" role="alert">{createError}</p>}
      </form>
      <p className="memo-feedback" role="status">{notice}</p>
      {loadError && <div className="memo-list-recovery">
        <p role="alert">{loadError}</p>
        {state.kind === 'ready' && <p className="memo-recovery-detail">当前保留上次同步的列表。</p>}
        <div className="memo-recovery-actions">
          <button type="button" disabled={refreshing || writing} onClick={refreshManually} aria-label="重试同步备忘录"><RefreshCw aria-hidden="true" />重试</button>
          {onOpenSettings && <button type="button" disabled={writing} onClick={onOpenSettings}>连接设置</button>}
        </div>
      </div>}
      {state.kind === 'loading' && <div className="memo-list-notice" role="status"><LoaderCircle className="spinner" aria-hidden="true" /><p>正在读取备忘…</p></div>}
      {state.kind === 'ready' && (state.items.length === 0
        ? <div className="memo-list-notice"><p>留住值得记下的事</p><span>点“新建备忘”记录想法，也可以在聊天中交给橘伴。</span></div>
        : <>
            <section className="memo-group" aria-label="长期目标">
              <h2 className="memo-group-title">长期目标（{groups.goals.length}）</h2>
              {groups.goals.length > 0
                ? <ul className="memo-list-items">{groups.goals.map(renderRow)}</ul>
                : <p className="memo-group-empty">还没有长期目标。</p>}
            </section>
            <section className="memo-group" aria-label="备忘">
              <h2 className="memo-group-title">备忘（{groups.notes.length}）</h2>
              {groups.notes.length > 0
                ? <ul className="memo-list-items">{groups.notes.map(renderRow)}</ul>
                : <p className="memo-group-empty">还没有进行中的备忘。</p>}
            </section>
            {groups.archived.length > 0 && <div className="memo-archived-group">
              <button className="memo-archived-toggle" type="button" aria-expanded={archivedOpen} onClick={() => setArchivedOpen(open => !open)}>
                <ChevronRight aria-hidden="true" />已归档（{groups.archived.length}）
              </button>
              {archivedOpen && <ul className="memo-list-items">{groups.archived.map(renderRow)}</ul>}
            </div>}
          </>)}
    </section>
  )
}
