import { ArrowDown, ArrowLeft, ClipboardList, BarChart3, CheckCheck, FileText, Lightbulb, LoaderCircle, Pin, Send, Settings2, Sparkles, UserRound, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'

import { connectionLabel, saveAgentSettings } from '../lib/agent'
import type { AgentMode, AgentView, ToolCall } from '../lib/agent'
import { shouldSubmitComposer } from '../lib/chat-interaction'
import { presentTool, toolEffectsFingerprint } from '../lib/tool-presentation'
import '../lib/tool-plugins'
import { MessageContent } from './MessageContent'
import { useChatReading } from './useChatReading'
import { ChatBubbleFrame } from './ChatBubbleFrame'
import { AssistantSettings } from './AssistantSettings'
import type { ChatBubbleDockConfig, ChatBubbleTailConfig } from './ChatBubbleFrame'
import { TodoList } from './TodoList'
import { TodoReminders } from './TodoReminders'
import { ReferenceSparkle } from './ReferenceIllustrations'
import './ChatInteraction.css'
const petPreview = '/pets/white-cat-v2/idle.png'

export interface UiMessage {
  role: 'user' | 'assistant'
  content: string
  runId?: string | null
  id: string
  pending?: boolean
  createdAt?: number
}

function formatMessageTime(createdAt?: number) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(createdAt ?? Date.now())
}

interface ChatPanelProps {
  attached?: boolean
  expanded: boolean
  /** false while the host resizes the native window: panel stays mounted but hidden/inert. */
  visible?: boolean
  /** Replay the frame entrance motion; visibility is unaffected. */
  animateEntrance?: boolean
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

export function ChatPanel({ attached = false, expanded, visible = true, animateEntrance = false, tail, dock, status, messages, tools, streaming, error, onClose, onExpandedChange, acceptedRequestId, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [todosOpen, setTodosOpen] = useState(false)
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:18081')
  const [apiKey, setApiKey] = useState('')
  const [mode, setMode] = useState<AgentMode>('server')
  const [localBaseUrl, setLocalBaseUrl] = useState('')
  const [localApiKey, setLocalApiKey] = useState('')
  const [localModel, setLocalModel] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const submittedDraftRef = useRef<{ content: string; requestId: string } | null>(null)
  const sendingRef = useRef(false)
  const returnExpandedRef = useRef(expanded)
  const pageIntentRef = useRef(0)
  const compositionRef = useRef(false)
  const compositionEndedAtRef = useRef(-Infinity)
  const backButtonRef = useRef<HTMLButtonElement>(null)
  const reading = useChatReading(expanded && visible && !settingsOpen && !todosOpen, messages, tools)
  const messageListRef = reading.listRef
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // Model tools do not advance the native direct-write revision. Track their
  // confirmed effects separately, dispatched by the plugins' declared affects,
  // keeping streamed message updates inert here.
  const todoRefreshKey = JSON.stringify([status?.generation ?? 0, status?.snapshot.session_id ?? null, status?.todo_revision ?? 0, toolEffectsFingerprint(tools, 'todo-list')])
  const lastTodoRefreshKeyRef = useRef(todoRefreshKey)
  const [todoRefreshVersion, setTodoRefreshVersion] = useState(0)

  useEffect(() => {
    if (lastTodoRefreshKeyRef.current === todoRefreshKey) return
    lastTodoRefreshKeyRef.current = todoRefreshKey
    setTodoRefreshVersion(version => version + 1)
  }, [todoRefreshKey])

  useEffect(() => {
    if (settingsOpen) messageListRef.current?.scrollTo({ top: 0, behavior: 'instant' })
  }, [settingsOpen])

  useEffect(() => {
    if (settingsOpen || todosOpen || !visible) {
      compositionRef.current = false
      compositionEndedAtRef.current = -Infinity
    }
  }, [settingsOpen, todosOpen, visible])

  useEffect(() => {
    const submitted = submittedDraftRef.current
    if (submitted && acceptedRequestId === submitted.requestId) {
      acknowledgeSubmission(submitted)
    }
  }, [acceptedRequestId])

  function acknowledgeSubmission(submitted: { content: string; requestId: string }) {
    // Snapshot recovery and the invoke promise can both acknowledge one send.
    // Consume its marker once so a late acknowledgement cannot clear a new draft.
    if (submittedDraftRef.current !== submitted) return
    submittedDraftRef.current = null
    setDraft(current => current === submitted.content ? '' : current)
  }

  useEffect(() => () => { pageIntentRef.current += 1 }, [])

  function focusCurrentView() {
    const target = settingsOpen
      ? messageListRef.current?.querySelector<HTMLInputElement>('input')
      : todosOpen ? backButtonRef.current : inputRef.current
    target?.focus({ preventScroll: true })
  }

  // Refocus after a committed visible/view transition; do not steal focus
  // from a settings editor when the native window merely regains focus.
  useEffect(() => {
    if (!visible) return
    const frame = window.requestAnimationFrame(focusCurrentView)
    return () => window.cancelAnimationFrame(frame)
  }, [visible, settingsOpen, todosOpen, expanded])

  useEffect(() => {
    if (!expanded) {
      setSettingsOpen(false)
      setTodosOpen(false)
    }
  }, [expanded])

  useEffect(() => {
    let focusFrame: number | undefined
    const recoverFocus = () => {
      if (!visible || (document.activeElement instanceof HTMLElement && document.activeElement !== document.body)) return
      focusFrame = window.requestAnimationFrame(focusCurrentView)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229 && !compositionRef.current)
        closePanel()
    }
    window.addEventListener('focus', recoverFocus)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      if (focusFrame !== undefined) window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('focus', recoverFocus)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose, visible, settingsOpen, todosOpen])

  const configured = status?.configured === true

  useEffect(() => {
    if (!status) return
    setMode(status.mode)
    // Seed both mode forms from the stored configuration, not only the active
    // mode's endpoint, so switching modes keeps saved values editable.
    if (status.server_endpoint) setBaseUrl(status.server_endpoint)
    if (status.local_endpoint) setLocalBaseUrl(status.local_endpoint)
    if (status.local_model) setLocalModel(status.local_model)
    setApiKey('')
    setLocalApiKey('')
  }, [status?.generation])

  async function submitSettings(event: FormEvent) {
    event.preventDefault()
    setSavingSettings(true)
    setSettingsError(null)
    try {
      await saveAgentSettings({
        mode,
        base_url: baseUrl,
        token: apiKey,
        local_base_url: localBaseUrl,
        local_api_key: localApiKey,
        local_model: localModel,
      })
      setApiKey('')
      setLocalApiKey('')
      setSettingsOpen(false)
      await onExpandedChange(false)
    }
    catch (cause) {
      setSettingsError(cause instanceof Error ? cause.message : String(cause))
    }
    finally {
      setSavingSettings(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || streaming || sendingRef.current || compositionRef.current)
      return

    if (!configured) {
      openSettings()
      return
    }

    if (status?.connection !== 'connected' || !status.model_configured) return
    sendingRef.current = true
    try {
      const request = onSend(content)
      const submitted = { content: draft, requestId: request.requestId }
      submittedDraftRef.current = submitted
      await request.accepted
      acknowledgeSubmission(submitted)
      // Keep the existing conversation visible while the server accepts and streams.
      if (!expanded) await onExpandedChange(true)
    }
    catch {
      // App owns the visible error. Preserve the draft for an idempotent retry.
    }
    finally {
      sendingRef.current = false
    }
  }

  function closePanel() {
    pageIntentRef.current += 1
    setSettingsOpen(false)
    setTodosOpen(false)
    onClose()
  }

  async function changePage(targetExpanded: boolean, commitPage: () => void) {
    const intent = ++pageIntentRef.current
    let committed = false
    const commit = () => {
      if (committed || intent !== pageIntentRef.current) return
      committed = true
      commitPage()
    }
    try {
      await onExpandedChange(targetExpanded, commit)
      // Hosts without native resizing may omit the optional commit callback.
      commit()
    } catch { /* Host reports resize failure; preserve the current page. */ }
  }

  function returnToChat() {
    void changePage(returnExpandedRef.current, () => {
      setSettingsOpen(false)
      setTodosOpen(false)
    })
  }

  async function openSettings() {
    if (settingsOpen) {
      returnToChat()
      return
    }
    if (!todosOpen) returnExpandedRef.current = expanded
    await changePage(true, () => {
      setTodosOpen(false)
      setSettingsOpen(true)
    })
  }

  async function toggleTodos() {
    if (todosOpen) {
      returnToChat()
      return
    }
    if (!settingsOpen) returnExpandedRef.current = expanded
    await changePage(true, () => {
      setSettingsOpen(false)
      setTodosOpen(true)
    })
  }

  function applyQuickPrompt(prompt: string) {
    setDraft(prompt)
    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(prompt.length, prompt.length)
    })
  }

  return (
    <ChatBubbleFrame
      variant={expanded ? 'expanded' : 'compact'}
      appearance={attached ? 'attached' : 'standalone'}
      visible={visible}
      animateEntrance={animateEntrance}
      tail={tail}
      dock={dock ?? (attached && expanded ? { offsetX: 13.3 } : undefined)}
      draggable
      title={todosOpen ? '待办列表' : settingsOpen ? '助手连接设置' : expanded ? '和橘伴聊天' : '想聊点什么？'}
      subtitle={connectionLabel(status)}
      actions={(
        <>
          <button ref={todosOpen ? backButtonRef : undefined} className={`icon-button${todosOpen ? ' is-active' : ''}`} type="button" aria-label={todosOpen ? '返回聊天' : '查看待办列表'} title={todosOpen ? '返回聊天' : '待办列表'} onClick={toggleTodos}>
            {todosOpen ? <ArrowLeft aria-hidden="true" /> : <ClipboardList aria-hidden="true" />}
          </button>
          <button ref={settingsOpen ? backButtonRef : undefined} className={`icon-button${settingsOpen ? ' is-active' : ''}`} type="button" aria-label={settingsOpen ? '返回聊天' : '配置助手服务'} onClick={openSettings}>
            {settingsOpen ? <ArrowLeft aria-hidden="true" /> : <Settings2 aria-hidden="true" />}
          </button>
          {!settingsOpen && (
            <span className="pin-indicator" role="img" aria-label="桌宠已置顶" title="桌宠已置顶">
              <Pin aria-hidden="true" />
            </span>
          )}
          <button className="icon-button" type="button" aria-label="收起对话" onClick={closePanel}>
            <X aria-hidden="true" />
          </button>
        </>
      )}
      footer={!settingsOpen && !todosOpen ? (
        <>
          <form className="composer" onSubmit={submit}>
            <label className="sr-only" htmlFor="chat-input">发送给橘伴</label>
            <div className="composer-row">
              <ReferenceSparkle className="composer-sparkle" />
              <textarea
                ref={inputRef}
                id="chat-input"
                value={draft}
                rows={1}
                placeholder="说点什么…"
                disabled={streaming}
                onChange={event => setDraft(event.target.value)}
                onCompositionStart={() => { compositionRef.current = true }}
                onCompositionEnd={event => { compositionRef.current = false; compositionEndedAtRef.current = event.timeStamp }}
                onKeyDown={event => {
                  if (shouldSubmitComposer({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode, compositionActive: compositionRef.current, timeStamp: event.timeStamp, compositionEndedAt: compositionEndedAtRef.current })) {
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
              />
              <button
                className="send-button"
                type="submit"
                aria-label={streaming ? '正在生成' : configured ? '发送消息' : '配置后发送消息'}
                disabled={streaming || !draft.trim() || (configured && (status?.connection !== 'connected' || !status.model_configured))}
              >
                {streaming
                  ? <LoaderCircle className="spinner" aria-hidden="true" />
                  : <Send className="send-plane" aria-hidden="true" />}
              </button>
            </div>
          </form>

          {!expanded && (
            <div className="quick-prompts" aria-label="快捷提问">
              <button type="button" onClick={() => applyQuickPrompt('帮我分析一下：')}><Lightbulb aria-hidden="true" />帮我分析</button>
              <button type="button" onClick={() => applyQuickPrompt('帮我生成一份文档：')}><FileText aria-hidden="true" />生成文档</button>
              <button type="button" onClick={() => applyQuickPrompt('帮我做数据分析：')}><BarChart3 aria-hidden="true" />数据分析</button>
              <button type="button" onClick={() => applyQuickPrompt('给我一些创意灵感：')}><Sparkles aria-hidden="true" />创意灵感</button>
            </div>
          )}
        </>
      ) : undefined}
    >

      {expanded && <div className="chat-content-with-reminders">
      <TodoReminders generation={status?.generation ?? 0} items={status?.reminders ?? []} error={status?.reminder_error ?? null} />
      {todosOpen && <TodoList key={status?.generation ?? 0} generation={status?.generation ?? 0} refreshVersion={todoRefreshVersion} />}
      {expanded && !todosOpen && <div ref={messageListRef} className={`message-list${settingsOpen ? ' is-settings' : ' chat-reading-list'}`} tabIndex={-1} onScroll={reading.onScroll} aria-live={settingsOpen ? undefined : 'polite'}>
        {settingsOpen && (
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
            onModeChange={setMode}
            onBaseUrlChange={value => { setBaseUrl(value); setApiKey('') }}
            onCredentialChange={setApiKey}
            onLocalBaseUrlChange={value => { setLocalBaseUrl(value); setLocalApiKey('') }}
            onLocalApiKeyChange={setLocalApiKey}
            onLocalModelChange={setLocalModel}
            onSubmit={submitSettings}
          />
        )}

        {!settingsOpen && <div ref={reading.contentRef} className="chat-message-feed">
        {messages.length === 0 && (
          configured
            ? (
                <div className="empty-state">
                  <img className="empty-cat" src={petPreview} alt="" aria-hidden="true" draggable={false} />
                  <h2>当前会话还没有消息</h2>
                  <p>可以询问已有待办，或告诉我需要记录的事情。</p>
                </div>
              )
            : (
                <div className="empty-state">
                  <img className="empty-cat" src={petPreview} alt="" aria-hidden="true" draggable={false} />
                  <h2>连接助手服务后开始对话</h2>
                  <p>连接后将恢复服务端会话；当前没有可显示的历史消息。</p>
                  <button className="configure-button" type="button" onClick={openSettings}>配置助手服务</button>
                </div>
              )
        )}

        {messages.map(message => (
          <article key={message.id} className={`message message-${message.role}`}>
            {message.role === 'assistant' && (
              <span className="message-avatar assistant-message-avatar" aria-hidden="true"><img src={petPreview} alt="" /></span>
            )}
            <div className="message-content">
              <span className="message-author">{message.role === 'user' ? '你' : '橘伴'}</span>
              <div className="message-bubble">
                {message.content ? <MessageContent content={message.content} /> : (message.pending && <span className="message-pending"><LoaderCircle className="spinner" aria-hidden="true" />橘伴正在思考…</span>)}
              </div>
              {message.role === 'assistant' && tools.filter(tool => tool.run_id === message.runId).map(tool => {
                const presentation = presentTool(tool)
                return (
                  <div className="agent-tool-result" key={tool.id} role="status">
                    <strong>{presentation.name} · {presentation.status}</strong>
                    {tool.error && <p>{tool.error}</p>}
                    {presentation.text && <p>{presentation.text}</p>}
                  </div>
                )
              })}
              <span className="message-time">
                {formatMessageTime(message.createdAt)}
                {message.role === 'user' && <CheckCheck aria-label="已发送" />}
              </span>
            </div>
            {message.role === 'user' && <span className="message-avatar user-message-avatar" aria-hidden="true"><UserRound /></span>}
          </article>
        ))}
        </div>}
      </div>}
      {reading.showLatest && <button className="chat-latest-button" type="button" onClick={reading.returnToLatest}><ArrowDown aria-hidden="true" />回到最新</button>}

      </div>}

      {!todosOpen && error && <div className={`inline-error${expanded ? '' : ' compact-error'}`} role="alert">{error}</div>}
    </ChatBubbleFrame>
  )
}
