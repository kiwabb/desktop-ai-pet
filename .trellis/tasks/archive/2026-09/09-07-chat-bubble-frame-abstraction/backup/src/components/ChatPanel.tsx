import { BarChart3, CheckCheck, ChevronDown, FileText, Lightbulb, LoaderCircle, Mic, Paperclip, PawPrint, Pin, RefreshCw, Save, Send, Settings2, ShieldCheck, Sparkles, UserRound, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'

import { listAiModels, saveAiSettings } from '../lib/ai'
import type { AiStatus, ChatMessage } from '../lib/ai'
import { ChatBubbleFrame } from './ChatBubbleFrame'
import { ReferenceSparkle } from './ReferenceIllustrations'
const petPreview = '/pets/white-cat-v2/idle.png'

export interface UiMessage extends ChatMessage {
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
  entering?: boolean
  status: AiStatus | null
  messages: UiMessage[]
  streaming: boolean
  error: string | null
  onStatusChange: (status: AiStatus) => void
  onClose: () => void
  onExpandedChange: (expanded: boolean) => void
  onSend: (content: string) => Promise<void>
}

export function ChatPanel({ attached = false, expanded, entering = true, status, messages, streaming, error, onStatusChange, onClose, onExpandedChange, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1')
  const [model, setModel] = useState('gpt-4.1-mini')
  const [apiKey, setApiKey] = useState('')
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [modelsOpen, setModelsOpen] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const messageEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!expanded) {
      setSettingsOpen(false)
      setModelsOpen(false)
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
      setBaseUrl(status.endpoint.replace(/\/chat\/completions\/?$/, ''))
    if (status?.model)
      setModel(status.model)
  }, [status])

  async function submitSettings(event: FormEvent) {
    event.preventDefault()
    setSavingSettings(true)
    setSettingsError(null)
    try {
      const nextStatus = await saveAiSettings({ baseUrl, apiKey, model })
      onStatusChange(nextStatus)
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

  async function loadModels() {
    setLoadingModels(true)
    setSettingsError(null)
    try {
      const models = await listAiModels({ baseUrl, apiKey })
      setModelOptions(models)
      setModelsOpen(true)
      if (!model.trim() || !models.includes(model))
        setModel(models[0])
    }
    catch (cause) {
      setModelOptions([])
      setSettingsError(cause instanceof Error ? cause.message : String(cause))
    }
    finally {
      setLoadingModels(false)
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

    setDraft('')
    if (expanded) {
      await onSend(content)
      return
    }

    void onSend(content)
    onClose()
  }

  function openSettings() {
    if (settingsOpen) {
      setSettingsOpen(false)
      onExpandedChange(false)
      return
    }
    if (!expanded)
      onExpandedChange(true)
    setSettingsOpen(true)
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
      attached={attached}
      expanded={expanded}
      entering={entering}
      title={settingsOpen ? 'AI 设置' : expanded ? '和橘伴聊天' : '想聊点什么？'}
      subtitle={expanded ? configured ? '已连接真实 AI 服务' : 'AI 服务未配置' : '我随时都在，陪你聊天、解答问题、生成内容~'}
      contentKind={settingsOpen ? 'settings' : 'chat'}
      actions={(
        <>
          <button className={`icon-button${settingsOpen ? ' is-active' : ''}`} type="button" aria-label={settingsOpen ? '返回对话' : '配置 AI 服务'} onClick={openSettings}>
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
    >

      {expanded && <div className="message-list" aria-live="polite">
        {settingsOpen && (
          <form className="settings-form" onSubmit={submitSettings}>
            <span className="settings-mark"><ShieldCheck aria-hidden="true" /></span>
            <div>
              <h2>连接真实 AI</h2>
              <p>API Key 保存在仅当前用户可读的本地配置中，不再访问 macOS 钥匙串。</p>
            </div>
            <label>
              服务地址
              <input type="url" value={baseUrl} required placeholder="https://api.openai.com/v1" onChange={event => setBaseUrl(event.target.value)} />
            </label>
            <label>
              API Key
              <input
                type="password"
                value={apiKey}
                required={!configured || status?.source === 'environment'}
                autoComplete="off"
                placeholder={status?.source === 'local_file' ? '留空则继续使用已保存 Key' : '保存在本机私有配置中'}
                onChange={event => setApiKey(event.target.value)}
              />
            </label>
            <div className="settings-field model-field">
              <span className="field-label-row">
                <label htmlFor="model-input">模型</label>
                <button
                  className="load-models-button"
                  type="button"
                  disabled={loadingModels || !baseUrl.trim() || (!apiKey.trim() && !configured)}
                  onClick={() => void loadModels()}
                >
                  {loadingModels ? <LoaderCircle className="spinner" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
                  {loadingModels ? '正在获取' : '获取模型列表'}
                </button>
              </span>
              <div className="model-input-row">
                <input
                  id="model-input"
                  value={model}
                  required
                  placeholder="输入或选择模型"
                  aria-controls={modelOptions.length > 0 ? 'model-options' : undefined}
                  aria-expanded={modelOptions.length > 0 ? modelsOpen : undefined}
                  onChange={event => setModel(event.target.value)}
                />
                {modelOptions.length > 0 && (
                  <button
                    className="toggle-models-button"
                    type="button"
                    aria-label={modelsOpen ? '收起模型列表' : `展开全部 ${modelOptions.length} 个模型`}
                    aria-expanded={modelsOpen}
                    onClick={() => setModelsOpen(current => !current)}
                  >
                    <ChevronDown className={modelsOpen ? 'is-open' : undefined} aria-hidden="true" />
                  </button>
                )}
              </div>
              {modelOptions.length > 0 && (
                <>
                  <span className="model-count">已获取 {modelOptions.length} 个模型，可滚动查看全部，也可以手工输入</span>
                  {modelsOpen && (
                    <div id="model-options" className="model-options" role="listbox" aria-label="可用模型">
                      {modelOptions.map(option => (
                        <button
                          key={option}
                          className={option === model ? 'is-selected' : undefined}
                          type="button"
                          role="option"
                          aria-selected={option === model}
                          title={option}
                          onClick={() => {
                            setModel(option)
                            setModelsOpen(false)
                          }}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
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
                <div className="empty-state empty-state-welcome">
                  <div className="welcome-row">
                    <span className="message-avatar welcome-avatar" aria-hidden="true"><img src={petPreview} alt="" /></span>
                    <div className="welcome-content">
                      <div className="welcome-name-row"><strong>橘伴</strong><span>AI 陪伴中</span></div>
                      <div className="welcome-bubble">嗨～有什么想和我聊聊的吗？</div>
                      <time>{formatMessageTime()}</time>
                    </div>
                    <PawPrint className="welcome-paw" aria-hidden="true" />
                  </div>
                  <p>直接输入就好，我会在这里陪着你。</p>
                </div>
              )
            : (
                <div className="empty-state">
                  <span className="empty-eyebrow">需要连接 AI</span>
                  <h2>连接真实 AI 后开始对话</h2>
                  <p>配置真实的 OpenAI-compatible 服务后即可对话。不会生成假回复。</p>
                  <button className="configure-button" type="button" onClick={() => setSettingsOpen(true)}>配置 AI 服务</button>
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

      {error && <div className={`inline-error${expanded ? '' : ' compact-error'}`} role="alert">{error}</div>}

      {!settingsOpen && <form className="composer" onSubmit={submit}>
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
            disabled={streaming || !draft.trim()}
          >
            {streaming
              ? <LoaderCircle className="spinner" aria-hidden="true" />
              : <Send className="send-plane" aria-hidden="true" />}
          </button>
        </div>
      </form>}

      {!expanded && !settingsOpen && (
        <div className="quick-prompts" aria-label="快捷提问">
          <button type="button" onClick={() => applyQuickPrompt('帮我分析一下：')}><Lightbulb aria-hidden="true" />帮我分析</button>
          <button type="button" onClick={() => applyQuickPrompt('帮我生成一份文档：')}><FileText aria-hidden="true" />生成文档</button>
          <button type="button" onClick={() => applyQuickPrompt('帮我做数据分析：')}><BarChart3 aria-hidden="true" />数据分析</button>
          <button type="button" onClick={() => applyQuickPrompt('给我一些创意灵感：')}><Sparkles aria-hidden="true" />创意灵感</button>
        </div>
      )}
    </ChatBubbleFrame>
  )
}
