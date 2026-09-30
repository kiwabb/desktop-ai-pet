import { ArrowDown, ArrowLeft, ClipboardList, Maximize2, MessageCircle, Minimize2, NotebookPen, Settings2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, WheelEvent as ReactWheelEvent } from 'react'

import { connectionLabel, saveAgentSettings } from '../lib/agent'
import type { AgentMode, AgentView, ToolCall } from '../lib/agent'
import { composerAvailability, conversationAnnouncement, HISTORY_PAGE_SIZE, projectConversationTools } from '../lib/conversation-presentation'
import type { UiMessage } from '../lib/conversation-presentation'
import { markMotionDiagnostic } from '../lib/motion-diagnostics'
import { toolEffectsFingerprint } from '../lib/tool-presentation'
import { utilityErrorMessage } from '../lib/utility-feedback'
import '../lib/tool-plugins'
import { ConversationFeed } from './ConversationFeed'
import { ChatComposer, ChatQuickPrompts } from './ChatComposer'
import type { ComposerSelection } from './ChatComposer'
import { useChatReading } from './useChatReading'
import { ChatBubbleFrame } from './ChatBubbleFrame'
import { AssistantSettings } from './AssistantSettings'
import type { ChatBubbleDockConfig, ChatBubbleFrameAppearance, ChatBubbleTailConfig } from './ChatBubbleFrame'
import { TodoList } from './TodoList'
import { ReminderSyncNotice, TodoReminders } from './TodoReminders'
import { MemoList } from './MemoList'
import { MemoReviewReminders } from './MemoReviewReminders'
import './ChatInteraction.css'
export type { UiMessage } from '../lib/conversation-presentation'

interface SubmittedDraft {
  content: string
  requestId: string
  pageIntent: number
  readingIntent: number
}

interface ChatPanelProps {
  attached?: boolean
  appearance?: ChatBubbleFrameAppearance
  expanded: boolean
  /** false while the host resizes the native window: panel stays mounted but hidden/inert. */
  visible?: boolean
  /** Replay the frame entrance motion; visibility is unaffected. */
  animateEntrance?: boolean
  /** Restore the current control after the host explicitly reactivates its window. */
  focusRequest?: number
  tail?: ChatBubbleTailConfig
  dock?: ChatBubbleDockConfig
  status: AgentView | null
  messages: UiMessage[]
  tools: ToolCall[]
  streaming: boolean
  error: string | null
  onClose: () => void
  onExpandedChange: (expanded: boolean, commitPage?: () => void) => void | Promise<void>
  acceptedRequestId: string | null
  onSend: (content: string) => { requestId: string; accepted: Promise<void> }
}

export function ChatPanel({ attached = false, appearance = attached ? 'attached' : 'standalone', expanded, visible = true, animateEntrance = false, focusRequest = 0, tail, dock, status, messages, tools: snapshotTools, streaming, error, onClose, onExpandedChange, acceptedRequestId, onSend }: ChatPanelProps) {
  const companion = appearance === 'companion'
  const conversationVisible = expanded || companion
  const previousTools = useRef<ToolCall[]>([])
  const tools = useMemo(() => {
    const next = projectConversationTools(snapshotTools, previousTools.current)
    previousTools.current = next
    return next
  }, [snapshotTools])
  const [draft, setDraft] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Secondary pages are mutually exclusive; an enum avoids boolean combinations.
  const [page, setPage] = useState<'chat' | 'todos' | 'memos'>('chat')
  const todosOpen = page === 'todos'
  const memosOpen = page === 'memos'
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:18081')
  const [apiKey, setApiKey] = useState('')
  const [mode, setMode] = useState<AgentMode>('server')
  const [localBaseUrl, setLocalBaseUrl] = useState('')
  const [localApiKey, setLocalApiKey] = useState('')
  const [localModel, setLocalModel] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [settingsSuccess, setSettingsSuccess] = useState<string | null>(null)
  const savingRef = useRef(false)
  const mountedRef = useRef(true)
  const settingsListRef = useRef<HTMLDivElement>(null)
  const sessionKey = `${status?.generation ?? 0}:${status?.snapshot.session_id ?? ''}`
  const [historyWindow, setHistoryWindow] = useState({ sessionKey, count: HISTORY_PAGE_SIZE })
  const historyCount = historyWindow.sessionKey === sessionKey ? historyWindow.count : HISTORY_PAGE_SIZE
  const submittedDraftRef = useRef<SubmittedDraft | null>(null)
  const sendingRef = useRef(false)
  const returnExpandedRef = useRef(expanded)
  const settingsReturnRef = useRef<{ page: 'chat' | 'todos' | 'memos'; expanded: boolean }>({ page: 'chat', expanded })
  const pageIntentRef = useRef(0)
  const pendingNavigationRef = useRef<{ intent: number; view: 'chat' | 'todos' | 'memos' | 'settings'; expanded: boolean } | null>(null)
  const compositionRef = useRef(false)
  const compositionEndedAtRef = useRef(-Infinity)
  const backButtonRef = useRef<HTMLButtonElement>(null)
  const reading = useChatReading(messages.length > 0 && conversationVisible && visible && !settingsOpen && page === 'chat', messages, tools, sessionKey, historyCount, expanded)
  const messageListRef = reading.listRef
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const composerSelectionRef = useRef<ComposerSelection | null>(null)
  const quickPromptFocusRef = useRef(false)
  const openingFocusPendingRef = useRef(true)
  // Model tools do not advance the native direct-write revision. Track their
  // confirmed effects separately, dispatched by the plugins' declared affects,
  // keeping streamed message updates inert here.
  const todoEffects = useMemo(() => toolEffectsFingerprint(tools, 'todo-list'), [tools])
  const todoRefreshKey = JSON.stringify([status?.generation ?? 0, status?.snapshot.session_id ?? null, status?.todo_revision ?? 0, todoEffects])
  const lastTodoRefreshKeyRef = useRef(todoRefreshKey)
  const [todoRefreshVersion, setTodoRefreshVersion] = useState(0)

  useEffect(() => {
    if (lastTodoRefreshKeyRef.current === todoRefreshKey) return
    lastTodoRefreshKeyRef.current = todoRefreshKey
    setTodoRefreshVersion(version => version + 1)
  }, [todoRefreshKey])

  const memoEffects = useMemo(() => toolEffectsFingerprint(tools, 'memo-list'), [tools])
  const memoRefreshKey = JSON.stringify([status?.generation ?? 0, status?.snapshot.session_id ?? null, status?.memo_revision ?? 0, memoEffects])
  const lastMemoRefreshKeyRef = useRef(memoRefreshKey)
  const [memoRefreshVersion, setMemoRefreshVersion] = useState(0)

  useEffect(() => {
    if (lastMemoRefreshKeyRef.current === memoRefreshKey) return
    lastMemoRefreshKeyRef.current = memoRefreshKey
    setMemoRefreshVersion(version => version + 1)
  }, [memoRefreshKey])

  useEffect(() => {
    if (settingsOpen) settingsListRef.current?.scrollTo({ top: 0, behavior: 'instant' })
  }, [settingsOpen])

  useEffect(() => {
    if (settingsOpen || page !== 'chat' || !visible) {
      compositionRef.current = false
      compositionEndedAtRef.current = -Infinity
    }
  }, [settingsOpen, page, visible])

  useEffect(() => {
    const submitted = submittedDraftRef.current
    if (submitted && acceptedRequestId === submitted.requestId) {
      acknowledgeSubmission(submitted)
    }
  }, [acceptedRequestId])

  function acknowledgeSubmission(submitted: SubmittedDraft) {
    // Snapshot recovery and the invoke promise can both acknowledge one send.
    // Consume its marker once so a late acknowledgement cannot clear a new draft.
    if (submittedDraftRef.current !== submitted) return
    submittedDraftRef.current = null
    setDraft(current => current === submitted.content ? '' : current)
    if (mountedRef.current && submitted.pageIntent === pageIntentRef.current) {
      reading.revealAcceptedSend(submitted.readingIntent)
    }
  }

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; pageIntentRef.current += 1; pendingNavigationRef.current = null }
  }, [])

  function focusCurrentView() {
    const target = settingsOpen
      ? settingsListRef.current?.querySelector<HTMLInputElement>('input')
      : page !== 'chat' ? backButtonRef.current : inputRef.current
    target?.focus({ preventScroll: true })
  }

  function restoreCurrentViewFocus() {
    if (!visible) return
    const active = document.activeElement
    const panel = messageListRef.current?.closest('.chat-panel')
    if (active instanceof HTMLElement && panel?.contains(active)
      && !active.closest('[hidden], [inert]') && !active.matches(':disabled')
      && active.getClientRects().length > 0) {
      active.focus({ preventScroll: true })
      return
    }
    focusCurrentView()
  }

  function restoreActivatedViewFocus() {
    if (!visible) return
    // Before native activation WebKit can replace an earlier DOM focus with
    // its first control. Only subsequent activations preserve that control.
    if (openingFocusPendingRef.current) {
      focusCurrentView()
      openingFocusPendingRef.current = false
    } else restoreCurrentViewFocus()
  }

  // Native window activation does not change the visible page or guarantee
  // WebView control focus. Reapply it without changing the draft or selection.
  useLayoutEffect(() => {
    if (focusRequest > 0) restoreActivatedViewFocus()
  }, [focusRequest])

  // Refocus after a committed visible/view transition; do not steal focus
  // from a settings editor when the native window merely regains focus.
  useLayoutEffect(() => {
    if (!visible) { openingFocusPendingRef.current = true; return }
    focusCurrentView()
  }, [visible, settingsOpen, page, expanded])

  useLayoutEffect(() => {
    // Empty onboarding is not history. Its first sentence must stay visible
    // rather than following the bottom of quick prompts or error content.
    if (visible && messages.length === 0 && !settingsOpen && page === 'chat')
      messageListRef.current?.scrollTo({ top: 0, behavior: 'instant' })
  }, [visible, messages.length, settingsOpen, page, sessionKey])

  // A quick prompt updates a controlled textarea. Place its caret only after
  // that value commits, without relying on a native WebView animation frame.
  useLayoutEffect(() => {
    if (!quickPromptFocusRef.current) return
    quickPromptFocusRef.current = false
    if (!visible || settingsOpen || page !== 'chat') return
    const input = inputRef.current
    input?.focus({ preventScroll: true })
    const length = input?.value.length ?? 0
    input?.setSelectionRange(length, length)
  }, [draft, visible, settingsOpen, page])

  useEffect(() => {
    if (!expanded) {
      setSettingsOpen(false)
      setPage('chat')
    }
  }, [expanded])

  useEffect(() => {
    const recoverFocus = () => {
      if (!visible || (document.activeElement instanceof HTMLElement && document.activeElement !== document.body)) return
      focusCurrentView()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (!visible || event.defaultPrevented || event.key !== 'Escape' || event.isComposing || event.keyCode === 229 || compositionRef.current) return
      event.preventDefault()
      if (settingsOpen) returnFromSettings()
      else if (page !== 'chat') returnToChat()
      else closePanel('escape')
    }
    window.addEventListener('focus', recoverFocus)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('focus', recoverFocus)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose, visible, settingsOpen, page])

  const configured = status?.configured === true
  const availability = composerAvailability(status, streaming)
  const unavailable = companion && (!status || !status.configured || status.connection !== 'connected' || !status.model_configured)
  const connectionCause = status?.error ?? status?.node_error
  const connectionNotice = unavailable ? {
    text: !status && error ? '暂时无法读取助手状态，请检查连接设置。'
      : connectionCause ? utilityErrorMessage(connectionCause, availability.reason, 'settings') : availability.reason,
    action: availability.action || Boolean(!status && error),
  } : undefined
  // Native connection failures already have an actionable notice by the input.
  // A separate send/window failure remains visible even when transport is down.
  const connectionError = Boolean(connectionNotice && error) && (error === status?.error || error === status?.node_error || (!status && error === '无法读取助手连接状态'))
  const showRunError = Boolean(error) && (!companion || !connectionError)

  useEffect(() => {
    if (!status) return
    setMode(status.mode)
    // Seed both mode forms from the stored configuration, not only the active
    // mode's endpoint, so switching modes keeps saved values editable.
    setBaseUrl(status.server_endpoint ?? 'http://127.0.0.1:18081')
    setLocalBaseUrl(status.local_endpoint ?? '')
    setLocalModel(status.local_model ?? '')
    setApiKey('')
    setLocalApiKey('')
  }, [status?.generation])

  async function submitSettings(event: FormEvent) {
    event.preventDefault()
    if (savingRef.current) return
    savingRef.current = true
    setSavingSettings(true)
    setSettingsError(null)
    setSettingsSuccess(null)
    try {
      await saveAgentSettings({
        mode,
        base_url: baseUrl,
        token: apiKey,
        local_base_url: localBaseUrl,
        local_api_key: localApiKey,
        local_model: localModel,
      })
      if (!mountedRef.current) return
      setApiKey('')
      setLocalApiKey('')
      setSettingsSuccess('设置已保存')
    }
    catch (cause) {
      console.error('保存助手配置失败', cause)
      // AssistantSettings maps the raw error once, in the settings context.
      if (mountedRef.current) setSettingsError(cause instanceof Error ? cause.message : String(cause))
    }
    finally {
      savingRef.current = false
      if (mountedRef.current) setSavingSettings(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || streaming || sendingRef.current || compositionRef.current)
      return

    if (!configured) {
      void openSettings()
      return
    }

    if (status?.connection !== 'connected' || !status.model_configured) return
    sendingRef.current = true
    const intent = pageIntentRef.current
    const readingIntent = reading.captureSendIntent()
    try {
      const request = onSend(content)
      const submitted = { content: draft, requestId: request.requestId, pageIntent: intent, readingIntent }
      submittedDraftRef.current = submitted
      await request.accepted
      acknowledgeSubmission(submitted)
      // The companion's short conversation already shows the accepted message.
      // Only the legacy input-only appearance needs a reading surface opened.
      if (!companion && !expanded && mountedRef.current && intent === pageIntentRef.current) await onExpandedChange(true)
    }
    catch {
      // App owns the visible error. Preserve the draft for an idempotent retry.
    }
    finally {
      sendingRef.current = false
    }
  }

  function closePanel(source: 'escape' | 'button') {
    if (savingRef.current) return
    markMotionDiagnostic('route:chat-close-intent', { source, page: settingsOpen ? 'settings' : page })
    reading.invalidateSendReveal()
    pageIntentRef.current += 1
    pendingNavigationRef.current = null
    setSettingsOpen(false)
    setPage('chat')
    onClose()
  }

  async function changePage(targetExpanded: boolean, commitPage: () => void, targetView: 'chat' | 'todos' | 'memos' | 'settings', preserveReading = false) {
    reading.invalidateSendReveal()
    if (preserveReading) reading.prepareLayoutChange(targetExpanded)
    const intent = ++pageIntentRef.current
    pendingNavigationRef.current = { intent, view: targetView, expanded: targetExpanded }
    let committed = false
    const commit = () => {
      if (committed || intent !== pageIntentRef.current) return
      committed = true
      if (pendingNavigationRef.current?.intent === intent) pendingNavigationRef.current = null
      commitPage()
    }
    try {
      await onExpandedChange(targetExpanded, commit)
      // Hosts without native resizing may omit the optional commit callback.
      commit()
    } catch {
      // Host reports resize failure; an uncommitted anchor cannot own a later
      // unrelated layout. A superseding navigation keeps its own reading intent.
      if (intent === pageIntentRef.current) reading.cancelLayoutChange()
    }
    finally {
      if (pendingNavigationRef.current?.intent === intent) pendingNavigationRef.current = null
    }
  }

  function stayOnCurrentPage() {
    if (savingRef.current) return
    const pending = pendingNavigationRef.current
    const currentView = settingsOpen ? 'settings' : page
    if (!pending || (pending.view === currentView && pending.expanded === expanded)) return
    // The host can be finishing an earlier native transition. Replace its
    // queued destination and size, even though this page is already selected.
    void changePage(expanded, () => {}, currentView)
  }

  function returnToChat() {
    if (savingRef.current) return
    if (companion && !settingsOpen && page === 'chat') { stayOnCurrentPage(); return }
    void changePage(returnExpandedRef.current, () => {
      setSettingsOpen(false)
      setPage('chat')
    }, 'chat')
  }

  function returnFromSettings() {
    if (savingRef.current || !settingsOpen) return
    if (!companion) { returnToChat(); return }
    const target = settingsReturnRef.current
    void changePage(target.expanded, () => {
      setSettingsOpen(false)
      setPage(target.page)
    }, target.page)
  }

  async function openSettings() {
    if (savingRef.current) return
    if (settingsOpen) {
      if (companion) stayOnCurrentPage()
      else returnToChat()
      return
    }
    settingsReturnRef.current = { page, expanded }
    if (page === 'chat') returnExpandedRef.current = expanded
    await changePage(true, () => {
      setPage('chat')
      setSettingsOpen(true)
      setSettingsSuccess(null)
      setSettingsError(null)
    }, 'settings')
  }

  async function toggleTodos() {
    if (savingRef.current) return
    if (todosOpen) {
      if (companion) stayOnCurrentPage()
      else returnToChat()
      return
    }
    if (!settingsOpen && page === 'chat') returnExpandedRef.current = expanded
    await changePage(true, () => {
      setSettingsOpen(false)
      setPage('todos')
    }, 'todos')
  }

  async function openMemos() {
    if (savingRef.current) return
    if (memosOpen) { if (companion) stayOnCurrentPage(); return }
    if (!settingsOpen && page === 'chat') returnExpandedRef.current = expanded
    await changePage(true, () => {
      setSettingsOpen(false)
      setPage('memos')
    }, 'memos')
  }

  async function toggleMemos() {
    if (memosOpen) {
      if (companion) stayOnCurrentPage()
      else returnToChat()
      return
    }
    await openMemos()
  }

  function toggleReadingView() {
    void changePage(!expanded, () => {}, 'chat', true)
  }

  function loadEarlierMessages() {
    if (companion && !expanded) {
      // Keep the same feed and reading anchor while opening the larger surface.
      toggleReadingView()
      return
    }
    reading.prepareHistoryPrepend()
    setHistoryWindow({ sessionKey, count: historyCount + HISTORY_PAGE_SIZE })
  }

  function applyQuickPrompt(prompt: string) {
    quickPromptFocusRef.current = true
    setDraft(current => current.trim() ? `${current.trimEnd()}\n${prompt}` : prompt)
  }

  function handleHistoryKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    const target = event.target
    if (!(target instanceof HTMLElement) || target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]')) return
    // Space on an action control activates that control, not history scrolling.
    if (event.key === ' ' && target.closest('button, summary')) return
    const upward = (!event.shiftKey && ['ArrowUp', 'PageUp', 'Home'].includes(event.key)) || (event.shiftKey && event.key === ' ')
    if (upward) reading.pauseForUpwardReading()
    else if (!event.shiftKey && ['ArrowDown', 'PageDown', 'End', ' '].includes(event.key)) reading.invalidateSendReveal()
  }

  function handleHistoryWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.ctrlKey) return
    if (event.deltaY < 0) reading.pauseForUpwardReading()
    else reading.invalidateSendReveal()
  }

  return (
    <ChatBubbleFrame
      variant={expanded ? 'expanded' : 'compact'}
      appearance={appearance}
      visible={visible}
      animateEntrance={animateEntrance}
      tail={tail}
      dock={dock ?? (attached && expanded ? { offsetX: 13.3 } : undefined)}
      draggable
      title={companion ? settingsOpen ? '连接设置' : '橘伴' : memosOpen ? '备忘录' : todosOpen ? '待办列表' : settingsOpen ? '助手连接设置' : expanded ? '和橘伴聊天' : '想聊点什么？'}
      subtitle={companion ? undefined : status ? connectionLabel(status) : '正在读取助手状态'}
      actions={(
        <>
          {!companion && (settingsOpen || page !== 'chat') && <button ref={backButtonRef} className="icon-button" type="button" disabled={savingSettings} aria-label="返回聊天" title="返回聊天" onClick={returnToChat}><ArrowLeft aria-hidden="true" /></button>}
          {companion && settingsOpen && <button className="icon-button" type="button" disabled={savingSettings} aria-label={settingsReturnRef.current.page === 'todos' ? '返回待办' : settingsReturnRef.current.page === 'memos' ? '返回备忘录' : '返回聊天'} title="返回上一页" onClick={returnFromSettings}><ArrowLeft aria-hidden="true" /></button>}
          {!settingsOpen && page === 'chat' && <button className={`icon-button${companion ? ' chat-labelled-action' : ''}`} type="button" aria-label={expanded ? '收起阅读' : '展开阅读'} title={expanded ? '收起阅读' : '展开阅读'} onClick={toggleReadingView}>{expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}{companion && <span>{expanded ? '收起阅读' : '展开阅读'}</span>}</button>}
          {!companion && !todosOpen && <button className="icon-button" type="button" disabled={savingSettings} aria-label="查看待办列表" title="待办列表" onClick={() => { void toggleTodos() }}><ClipboardList aria-hidden="true" /></button>}
          {!companion && !memosOpen && <button className="icon-button" type="button" disabled={savingSettings} aria-label="查看备忘录" title="备忘录" onClick={() => { void toggleMemos() }}><NotebookPen aria-hidden="true" /></button>}
          {(companion || !settingsOpen) && <button className={`icon-button${settingsOpen ? ' is-active' : ''}`} type="button" disabled={savingSettings} aria-label="配置助手服务" aria-pressed={settingsOpen} title="连接设置" onClick={() => { void openSettings() }}><Settings2 aria-hidden="true" /></button>}
          <button className="icon-button" type="button" disabled={savingSettings} aria-label="收起对话" title="收起对话" onClick={() => closePanel('button')}><X aria-hidden="true" /></button>
        </>
      )}
      navigation={companion && <nav className="chat-navigation" aria-label="助手功能">
        <button type="button" disabled={savingSettings} aria-label="聊天" aria-current={!settingsOpen && page === 'chat' ? 'page' : undefined} onClick={returnToChat}><MessageCircle aria-hidden="true" />聊天</button>
        <button ref={todosOpen ? backButtonRef : undefined} type="button" disabled={savingSettings} aria-label="查看待办列表" aria-current={todosOpen ? 'page' : undefined} onClick={() => { void toggleTodos() }}><ClipboardList aria-hidden="true" />待办</button>
        <button ref={memosOpen ? backButtonRef : undefined} type="button" disabled={savingSettings} aria-label="查看备忘录" aria-current={memosOpen ? 'page' : undefined} onClick={() => { void toggleMemos() }}><NotebookPen aria-hidden="true" />备忘录</button>
      </nav>}
      footer={!settingsOpen && page === 'chat' ? <ChatComposer draft={draft} expanded={expanded} visible={visible} streaming={streaming} status={status} companion={companion} connectionNotice={connectionNotice} showQuickPrompts={!companion && !expanded} inputRef={inputRef} selectionRef={composerSelectionRef} compositionRef={compositionRef} compositionEndedAtRef={compositionEndedAtRef} onDraftChange={setDraft} onSubmit={submit} onOpenSettings={() => { void openSettings() }} onQuickPrompt={applyQuickPrompt} /> : undefined}
    >
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{visible && !settingsOpen && page === 'chat' ? conversationAnnouncement(messages, tools) : ''}</span>
      <div className="chat-content-with-reminders" hidden={!conversationVisible} style={conversationVisible ? undefined : { display: 'none' }}>
        {expanded && <div className="chat-daily-reminders" hidden={settingsOpen} style={{ display: settingsOpen ? 'none' : 'contents' }}>
          <TodoReminders generation={status?.generation ?? 0} items={status?.reminders ?? []} error={status?.reminder_error ?? null} showSyncError={!companion} />
          <MemoReviewReminders generation={status?.generation ?? 0} items={status?.memo_reviews ?? []} error={status?.memo_review_error ?? null} showSyncError={!companion} onOpenMemos={() => { void openMemos() }} />
          {companion && <ReminderSyncNotice todoError={status?.reminder_error ?? null} memoError={status?.memo_review_error ?? null} />}
        </div>}
        {(todosOpen || (settingsOpen && settingsReturnRef.current.page === 'todos')) && <TodoList key={status?.generation ?? 0} generation={status?.generation ?? 0} refreshVersion={todoRefreshVersion} hidden={settingsOpen} onOpenSettings={() => { void openSettings() }} />}
        {(memosOpen || (settingsOpen && settingsReturnRef.current.page === 'memos')) && <MemoList key={status?.generation ?? 0} generation={status?.generation ?? 0} refreshVersion={memoRefreshVersion} hidden={settingsOpen} onOpenSettings={() => { void openSettings() }} />}
        {settingsOpen && <div ref={settingsListRef} className="message-list is-settings" tabIndex={-1}>
          <AssistantSettings
            status={status}
            mode={mode}
            baseUrl={baseUrl}
            credential={apiKey}
            localBaseUrl={localBaseUrl}
            localApiKey={localApiKey}
            localModel={localModel}
            saving={savingSettings}
            error={settingsError}
            success={settingsSuccess}
            onReturnToChat={returnToChat}
            onModeChange={value => { setMode(value); setSettingsSuccess(null) }}
            onBaseUrlChange={value => { setBaseUrl(value); setApiKey(''); setSettingsSuccess(null) }}
            onCredentialChange={value => { setApiKey(value); setSettingsSuccess(null) }}
            onLocalBaseUrlChange={value => { setLocalBaseUrl(value); setLocalApiKey(''); setSettingsSuccess(null) }}
            onLocalApiKeyChange={value => { setLocalApiKey(value); setSettingsSuccess(null) }}
            onLocalModelChange={value => { setLocalModel(value); setSettingsSuccess(null) }}
            onSubmit={submitSettings}
          />
        </div>}
        <div ref={messageListRef} hidden={settingsOpen || page !== 'chat'} className="message-list chat-reading-list" tabIndex={0} onScroll={reading.onScroll} onWheel={handleHistoryWheel} onPointerDown={reading.invalidateSendReveal} onKeyDown={handleHistoryKeyDown} aria-label="聊天记录">
          <div ref={reading.contentRef} className="chat-message-feed">
            <ConversationFeed key={sessionKey} messages={messages} tools={tools} count={historyCount} configured={configured} companion={companion} compact={companion && !expanded} emptyActions={companion ? <ChatQuickPrompts compact onQuickPrompt={applyQuickPrompt} /> : undefined} onOpenSettings={() => { void openSettings() }} onLoadEarlier={loadEarlierMessages} />
          </div>
        </div>
        {reading.showLatest && <button className="chat-latest-button" type="button" onClick={reading.returnToLatest}><ArrowDown aria-hidden="true" />回到最新</button>}
      </div>
      {page === 'chat' && !settingsOpen && showRunError && <div className={`inline-error${expanded ? '' : ' compact-error'}`} role="alert">{error}</div>}
    </ChatBubbleFrame>
  )
}
