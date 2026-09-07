import { ArrowLeft, ClipboardList, BarChart3, CheckCheck, FileText, Lightbulb, LoaderCircle, Mic, Paperclip, Pin, Save, Send, Settings2, ShieldCheck, Sparkles, UserRound, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'

import { connectionLabel, saveAgentSettings } from '../lib/agent'
import type { AgentView, ToolCall } from '../lib/agent'
import { todoToolEffectsFingerprint, todoToolPresentation } from '../lib/todo-tool-presentation'
import { ChatBubbleFrame } from './ChatBubbleFrame'
import type { ChatBubbleTailConfig } from './ChatBubbleFrame'
import { TodoList } from './TodoList'
import { TodoReminders } from './TodoReminders'
import { ReferenceSparkle } from './ReferenceIllustrations'
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
  status: AgentView | null
  messages: UiMessage[]
  tools: ToolCall[]
  streaming: boolean
  error: string | null
  onClose: () => void
  onExpandedChange: (expanded: boolean) => void
  acceptedRequestId: string | null
  onSend: (content: string) => { requestId: string; accepted: Promise<void> }
}

export function ChatPanel({ attached = false, expanded, visible = true, animateEntrance = false, tail, status, messages, tools, streaming, error, onClose, onExpandedChange, acceptedRequestId, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [todosOpen, setTodosOpen] = useState(false)
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:18081')
  const [apiKey, setApiKey] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const submittedDraftRef = useRef<{ content: string; requestId: string } | null>(null)
  const messageEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // Model tools do not advance the native direct-write revision. Track their
  // confirmed effects separately, keeping streamed message updates inert here.
  const todoRefreshKey = JSON.stringify([status?.generation ?? 0, status?.snapshot.session_id ?? null, status?.todo_revision ?? 0, todoToolEffectsFingerprint(tools)])
  const lastTodoRefreshKeyRef = useRef(todoRefreshKey)
  const [todoRefreshVersion, setTodoRefreshVersion] = useState(0)

  useEffect(() => {
    if (lastTodoRefreshKeyRef.current === todoRefreshKey) return
    lastTodoRefreshKeyRef.current = todoRefreshKey
    setTodoRefreshVersion(version => version + 1)
  }, [todoRefreshKey])

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const submitted = submittedDraftRef.current
    if (submitted && acceptedRequestId === submitted.requestId) {
      setDraft(current => current === submitted.content ? '' : current)
      submittedDraftRef.current = null
    }
  }, [acceptedRequestId])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // The host pre-mounts the panel hidden (inert) while AppKit resizes the
  // native surface, so the mount-time focus above is swallowed. Refocus the
  // composer as soon as the frame becomes visible/interactive again.
  useEffect(() => {
    if (visible)
      window.requestAnimationFrame(() => inputRef.current?.focus())
  }, [visible])

  useEffect(() => {
    if (!expanded) {
      setSettingsOpen(false)
      setTodosOpen(false)
      window.requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [expanded])

  useEffect(() => {
    const focusComposer = () => window.requestAnimationFrame(() => inputRef.current?.focus())
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape')
        onClose()
    }
    window.addEventListener('focus', focusComposer)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('focus', focusComposer)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose])

  const configured = status?.configured === true

  useEffect(() => {
    if (status?.endpoint)
      setBaseUrl(status.endpoint)
  }, [status])

  async function submitSettings(event: FormEvent) {
    event.preventDefault()
    setSavingSettings(true)
    setSettingsError(null)
    try {
      await saveAgentSettings(baseUrl, apiKey)
      setApiKey('')
      setSettingsOpen(false)
      onExpandedChange(false)
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
    if (!content || streaming)
      return

    if (!configured) {
      openSettings()
      return
    }

    if (status?.connection !== 'connected' || !status.model_configured) return
    const request = onSend(content)
    submittedDraftRef.current = { content, requestId: request.requestId }
    try {
      await request.accepted
      setDraft(current => current === content ? '' : current)
      submittedDraftRef.current = null
      // Keep the existing conversation visible while the server accepts and streams.
      if (!expanded) onExpandedChange(true)
    }
    catch {
      // App owns the visible error. Preserve the draft for an idempotent retry.
    }
  }

  function openSettings() {
    setTodosOpen(false)
    if (settingsOpen) {
      setSettingsOpen(false)
      onExpandedChange(false)
      return
    }
    if (!expanded)
      onExpandedChange(true)
    setSettingsOpen(true)
  }

  function toggleTodos() {
    setSettingsOpen(false)
    if (!expanded) onExpandedChange(true)
    setTodosOpen(current => !current)
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
      draggable
      title={todosOpen ? '待办列表' : settingsOpen ? '助手连接设置' : expanded ? '和橘伴聊天' : '想聊点什么？'}
      subtitle={connectionLabel(status)}
      actions={(
        <>
          <button className={`icon-button${todosOpen ? ' is-active' : ''}`} type="button" aria-label={todosOpen ? '返回聊天' : '查看待办列表'} title={todosOpen ? '返回聊天' : '待办列表'} onClick={toggleTodos}>
            {todosOpen ? <ArrowLeft aria-hidden="true" /> : <ClipboardList aria-hidden="true" />}
          </button>
          <button className={`icon-button${settingsOpen ? ' is-active' : ''}`} type="button" aria-label={settingsOpen ? '返回对话' : '配置助手服务'} onClick={openSettings}>
            <Settings2 aria-hidden="true" />
          </button>
          {!settingsOpen && (
            <span className="pin-indicator" role="img" aria-label="桌宠已置顶" title="桌宠已置顶">
              <Pin aria-hidden="true" />
            </span>
          )}
          <button className="icon-button" type="button" aria-label="收起对话" onClick={onClose}>
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
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
              />
              <button className="composer-tool" type="button" aria-label="添加附件，暂未开放" title="附件功能即将支持" disabled>
                <Paperclip aria-hidden="true" />
              </button>
              <span className="composer-divider" aria-hidden="true" />
              <button className="composer-tool" type="button" aria-label="语音输入，暂未开放" title="语音输入即将支持" disabled>
                <Mic aria-hidden="true" />
              </button>
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
      {expanded && !todosOpen && <div className={`message-list${settingsOpen ? ' is-settings' : ''}`} aria-live="polite">
        {settingsOpen && (
          <form className="settings-form" onSubmit={submitSettings}>
            <span className="settings-mark"><ShieldCheck aria-hidden="true" /></span>
            <div>
              <h2>连接助手服务</h2>
              <p>填入助手服务地址和设备凭证。模型由服务端配置，设备凭证保存在本机私有文件中。</p>
            </div>
            <label>
              服务地址
              <input type="url" value={baseUrl} required placeholder="https://assistant.example.com" onChange={event => { setBaseUrl(event.target.value); setApiKey('') }} />
            </label>
            <label>
              设备凭证
              <input
                type="password"
                value={apiKey}
                required={!configured || baseUrl.replace(/\/$/, '') !== status?.endpoint}
                autoComplete="off"
                placeholder={configured && baseUrl.replace(/\/$/, '') === status?.endpoint ? '留空继续使用当前设备凭证' : '输入该服务签发的设备凭证'}
                onChange={event => setApiKey(event.target.value)}
              />
            </label>
            <p>{connectionLabel(status)}{status?.model ? ` · ${status.model}` : ''}</p>
            {settingsError && <div className="settings-error" role="alert">{settingsError}</div>}
            <button className="save-settings-button" type="submit" disabled={savingSettings}>
              {savingSettings ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Save aria-hidden="true" />}
              {savingSettings ? '正在保存' : '保存并连接'}
            </button>
          </form>
        )}

        {!settingsOpen && messages.length === 0 && (
          configured
            ? (
                <div className="empty-state">
                  <h2>当前会话还没有消息</h2>
                  <p>可以询问已有待办，或告诉我需要记录的事情。</p>
                </div>
              )
            : (
                <div className="empty-state">
                  <span className="empty-eyebrow">需要连接助手</span>
                  <h2>连接助手服务后开始对话</h2>
                  <p>连接后将恢复服务端会话；当前没有可显示的历史消息。</p>
                  <button className="configure-button" type="button" onClick={() => setSettingsOpen(true)}>配置助手服务</button>
                </div>
              )
        )}

        {!settingsOpen && messages.map(message => (
          <article key={message.id} className={`message message-${message.role}`}>
            {message.role === 'assistant' && (
              <span className="message-avatar assistant-message-avatar" aria-hidden="true"><img src={petPreview} alt="" /></span>
            )}
            <div className="message-content">
              <span className="message-author">{message.role === 'user' ? '你' : '橘伴'}</span>
              <div className="message-bubble">
                {message.content || (message.pending && <LoaderCircle className="spinner" aria-label="正在生成回复" />)}
              </div>
              {message.role === 'assistant' && tools.filter(tool => tool.run_id === message.runId).map(tool => {
                const presentation = todoToolPresentation(tool)
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
        <div ref={messageEndRef} />
      </div>}

      </div>}

      {!todosOpen && error && <div className={`inline-error${expanded ? '' : ' compact-error'}`} role="alert">{error}</div>}
    </ChatBubbleFrame>
  )
}
