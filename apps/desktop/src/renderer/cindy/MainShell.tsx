import {
  ArrowUp,
  Bot,
  Cat,
  CircleAlert,
  CircleStop,
  MessageSquare,
  PanelLeft,
  PawPrint,
  Plus,
  Settings2,
  Sparkles,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type {
  AgentRunEvent,
  AgentRunRecordEvent,
  AgentRunSettledEvent,
} from '../../shared/agent-runtime'
import { FadeSwitcher } from './FadeSwitcher'
import './MainShell.css'

type MainPanel = 'chat' | 'settings'
type RunPhase = 'idle' | 'submitting' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed'
type MessageRole = 'user' | 'assistant'

interface DisplayMessage {
  id: string
  role: MessageRole
  content: string
}

interface ActiveRun {
  sessionId: string
  runId: string
  requestId: string
}

const SESSION_STORAGE_KEY = 'desktop-ai-pet.electron.session-id.v1'

function stableSessionId(): string {
  try {
    const existing = window.localStorage.getItem(SESSION_STORAGE_KEY)
    if (existing) return existing
    const created = `electron-session-${crypto.randomUUID()}`
    window.localStorage.setItem(SESSION_STORAGE_KEY, created)
    return created
  } catch {
    return 'electron-session-memory'
  }
}

function readableRunState(phase: RunPhase): string {
  switch (phase) {
    case 'submitting': return '正在提交'
    case 'running': return '正在工作'
    case 'cancelling': return '正在停止'
    case 'completed': return '已完成'
    case 'cancelled': return '已停止'
    case 'failed': return '执行失败'
    default: return '等待输入'
  }
}

function recordText(event: AgentRunRecordEvent): string | null {
  const record = event.record
  const direct = [record.delta, record.text, record.content]
  for (const candidate of direct) {
    const text = textFromValue(candidate)
    if (text) return text
  }

  const message = record.message
  if (message && typeof message === 'object') {
    const messageRecord = message as Record<string, unknown>
    for (const candidate of [messageRecord.delta, messageRecord.text, messageRecord.content]) {
      const text = textFromValue(candidate)
      if (text) return text
    }
  }
  return null
}

function textFromValue(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return null

  const text = value
    .map((item) => {
      if (typeof item === 'string') return item
      if (!item || typeof item !== 'object') return ''
      const entry = item as Record<string, unknown>
      if (entry.type !== undefined && entry.type !== 'text' && entry.type !== 'text_delta') return ''
      return typeof entry.text === 'string' ? entry.text : typeof entry.delta === 'string' ? entry.delta : ''
    })
    .join('')
  return text || null
}

function mergeStreamText(previous: string, next: string): string {
  if (!previous) return next
  if (!next || next === previous) return previous
  if (next.startsWith(previous)) return next
  return `${previous}${next}`
}

function runMatches(event: AgentRunEvent, run: ActiveRun | null): boolean {
  return Boolean(run && event.sessionId === run.sessionId && event.runId === run.runId && event.requestId === run.requestId)
}

function settledPhase(event: AgentRunSettledEvent): RunPhase {
  if (event.outcome === 'completed') return 'completed'
  if (event.outcome === 'cancelled') return 'cancelled'
  return 'failed'
}

function userFacingRuntimeError(error: string | null): string {
  if (!error) return 'Pi 运行未完成，请检查运行时配置。'
  const normalized = error.toLowerCase()
  if (normalized.includes('no api key found') || normalized.includes('api key') || normalized.includes('use /login')) {
    return 'Pi 已启动，但当前模型没有 API Key；请先登录或配置对应的 provider。'
  }
  if (normalized.includes('timed out') || normalized.includes('timeout')) {
    return 'Pi 请求超时，请检查模型配置和网络后重试。'
  }
  if (error.startsWith('Pi process exited')) return 'Pi 运行进程已退出，请检查 Pi 安装和配置。'
  return 'Pi 未能完成这次请求，请检查配置后重试。'
}

export function MainShell() {
  const bridge = window.desktop
  const sessionId = useMemo(stableSessionId, [])
  const [panel, setPanel] = useState<MainPanel>('chat')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [phase, setPhase] = useState<RunPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const activeRunRef = useRef<ActiveRun | null>(null)
  const assistantMessageIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!bridge) return

    return bridge.onRunEvent((event) => {
      const active = activeRunRef.current
      if (!runMatches(event, active)) return

      if (event.type === 'run.accepted') {
        setPhase('running')
        return
      }
      if (event.type === 'run.record') {
        setPhase('running')
        const text = recordText(event)
        if (!text) return

        setMessages((current) => {
          const assistantId = assistantMessageIdRef.current ?? `assistant-${event.runId}`
          assistantMessageIdRef.current = assistantId
          const existing = current.find((message) => message.id === assistantId)
          if (existing) {
            return current.map((message) => message.id === assistantId
              ? { ...message, content: mergeStreamText(message.content, text) }
              : message)
          }
          return [...current, { id: assistantId, role: 'assistant', content: text }]
        })
        return
      }
      if (event.type === 'run.cancel_requested') {
        setPhase('cancelling')
        return
      }

      setPhase(settledPhase(event))
      if (event.error) setError(userFacingRuntimeError(event.error))
      activeRunRef.current = null
    })
  }, [bridge])

  function submit(): void {
    const prompt = draft.trim()
    if (!prompt || !bridge || activeRunRef.current) return

    const run: ActiveRun = {
      sessionId,
      runId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
    }
    activeRunRef.current = run
    assistantMessageIdRef.current = null
    setError(null)
    setPhase('submitting')
    setMessages((current) => [...current, { id: `user-${run.runId}`, role: 'user', content: prompt }])
    setDraft('')

    void bridge.submitRun({ ...run, prompt }).catch((cause: unknown) => {
      if (activeRunRef.current?.runId !== run.runId) return
      activeRunRef.current = null
      setPhase('failed')
      setError(userFacingRuntimeError(cause instanceof Error ? cause.message : null))
    })
  }

  function cancel(): void {
    const run = activeRunRef.current
    if (!bridge || !run || phase === 'cancelling') return
    setPhase('cancelling')
    void bridge.cancelRun({ sessionId: run.sessionId, runId: run.runId }).catch(() => {
      if (activeRunRef.current?.runId !== run.runId) return
      setPhase('running')
      setError('停止请求未被接受，请稍后重试。')
    })
  }

  function startNewConversation(): void {
    if (activeRunRef.current) return
    setMessages([])
    setError(null)
    setPhase('idle')
    setPanel('chat')
  }

  const isBusy = phase === 'submitting' || phase === 'running' || phase === 'cancelling'
  const bridgeReady = Boolean(bridge)

  return (
    <main className={`cindy-shell${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}>
      <aside className="cindy-sidebar">
        <div className="cindy-brand">
          <div className="brand-mark" aria-hidden="true"><Sparkles size={16} /></div>
          {!sidebarCollapsed && <div><strong>橘伴</strong><span>Electron workspace</span></div>}
        </div>
        <button className="sidebar-new" type="button" onClick={startNewConversation} disabled={isBusy}>
          <Plus size={16} aria-hidden="true" />
          {!sidebarCollapsed && <span>新建对话</span>}
        </button>
        <nav className="sidebar-nav" aria-label="主导航">
          <button className={panel === 'chat' ? 'nav-item is-active' : 'nav-item'} type="button" onClick={() => setPanel('chat')}>
            <MessageSquare size={16} aria-hidden="true" />
            {!sidebarCollapsed && <span>对话</span>}
          </button>
          <button className={panel === 'settings' ? 'nav-item is-active' : 'nav-item'} type="button" onClick={() => setPanel('settings')}>
            <Settings2 size={16} aria-hidden="true" />
            {!sidebarCollapsed && <span>设置</span>}
          </button>
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-pet-card">
          <div className="pet-card-icon" aria-hidden="true"><PawPrint size={16} /></div>
          {!sidebarCollapsed && <div><strong>白猫桌宠</strong><span>{isBusy ? '正在陪你工作' : '独立窗口已就绪'}</span></div>}
          {!sidebarCollapsed && <button className="icon-button" type="button" onClick={() => void bridge?.openPet()} aria-label="打开桌宠"><Cat size={15} /></button>}
        </div>
        <button className="sidebar-collapse" type="button" onClick={() => setSidebarCollapsed((value) => !value)} aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}>
          <PanelLeft size={16} aria-hidden="true" />
        </button>
      </aside>

      <section className="cindy-main">
        <header className="cindy-header">
          <div className="header-context"><Bot size={17} aria-hidden="true" /><span>{panel === 'chat' ? '本地助手' : '工作区设置'}</span></div>
          <div className="header-actions">
            <span className={`run-chip is-${phase}`}><span className="run-dot" aria-hidden="true" />{readableRunState(phase)}</span>
            <button className="header-pet-button" type="button" onClick={() => void bridge?.openPet()}><Cat size={15} aria-hidden="true" />桌宠</button>
          </div>
        </header>

        <FadeSwitcher key={panel}>
          {panel === 'chat'
            ? <ChatView
                bridgeReady={bridgeReady}
                draft={draft}
                error={error}
                isBusy={isBusy}
                messages={messages}
                phase={phase}
                onCancel={cancel}
                onDraftChange={setDraft}
                onOpenSettings={() => setPanel('settings')}
                onSubmit={submit}
              />
            : <SettingsView bridgeReady={bridgeReady} runtimeError={error} onHidePet={() => void bridge?.hidePet()} onOpenPet={() => void bridge?.openPet()} />}
        </FadeSwitcher>
      </section>
    </main>
  )
}

interface ChatViewProps {
  bridgeReady: boolean
  draft: string
  error: string | null
  isBusy: boolean
  messages: DisplayMessage[]
  phase: RunPhase
  onCancel: () => void
  onDraftChange: (value: string) => void
  onOpenSettings: () => void
  onSubmit: () => void
}

function ChatView({ bridgeReady, draft, error, isBusy, messages, phase, onCancel, onDraftChange, onOpenSettings, onSubmit }: ChatViewProps) {
  return <div className="chat-view">
    <div className="chat-intro">
      <div className="intro-orbit" aria-hidden="true"><Sparkles size={20} /></div>
      <p className="eyebrow">PERSONAL WORKSPACE</p>
      <h1>把想法交给我，<em>慢慢做。</em></h1>
      <p className="intro-copy">这是 Electron 主窗口。对话运行由主进程持有，桌宠只是独立的状态陪伴。</p>
      {!bridgeReady && <div className="bridge-warning"><CircleAlert size={16} aria-hidden="true" /><span>当前页面未连接 Electron preload，无法提交真实任务。</span></div>}
      {bridgeReady && phase === 'idle' && messages.length === 0 && <div className="quick-prompts"><span>可以从这里开始</span><button type="button" onClick={() => onDraftChange('帮我梳理一下今天最重要的三件事')}>梳理今天</button><button type="button" onClick={() => onDraftChange('把这个想法整理成一个可执行的计划')}>整理计划</button></div>}
    </div>
    <div className="conversation" aria-live="polite">
      {messages.length === 0
        ? <div className="conversation-empty"><MessageSquare size={20} aria-hidden="true" /><span>发送后，真实的 Pi 运行记录会出现在这里。</span></div>
        : messages.map((message) => <article className={`message is-${message.role}`} key={message.id}><div className="message-avatar" aria-hidden="true">{message.role === 'user' ? '你' : <Sparkles size={14} />}</div><div className="message-body"><span className="message-role">{message.role === 'user' ? '你' : '橘伴'}</span><p>{message.content}</p></div></article>)}
      {error && <div className="error-callout" role="alert"><CircleAlert size={16} aria-hidden="true" /><span>{error}</span><button type="button" onClick={onOpenSettings}>检查设置</button></div>}
    </div>
    <form className="composer-card" onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
      <textarea value={draft} onChange={(event) => onDraftChange(event.target.value)} disabled={isBusy} placeholder={isBusy ? '任务运行中…' : '写下你想做的事…'} rows={2} aria-label="消息输入" />
      <div className="composer-footer"><span>Enter 发送 · Shift + Enter 换行</span>{isBusy ? <button className="send-button is-stop" type="button" onClick={onCancel}><CircleStop size={16} aria-hidden="true" />停止</button> : <button className="send-button" type="submit" disabled={!draft.trim() || !bridgeReady}><span>发送</span><ArrowUp size={16} aria-hidden="true" /></button>}</div>
    </form>
  </div>
}

function SettingsView({ bridgeReady, runtimeError, onHidePet, onOpenPet }: { bridgeReady: boolean; runtimeError: string | null; onHidePet: () => void; onOpenPet: () => void }) {
  return <div className="settings-view"><div className="settings-heading"><p className="eyebrow">WORKSPACE SETTINGS</p><h1>让工作区保持轻盈。</h1><p>这一页只管理 Electron 窗口和桌宠，不会读取或显示模型密钥。</p></div><div className="settings-grid"><section className="setting-card"><div className="setting-icon"><Cat size={18} aria-hidden="true" /></div><div><h2>独立桌宠</h2><p>桌宠窗口拥有自己的生命周期。隐藏它不会中断主窗口里的任务。</p><div className="setting-actions"><button type="button" onClick={onOpenPet}>打开桌宠</button><button type="button" onClick={onHidePet}>隐藏桌宠</button></div></div></section><section className="setting-card"><div className="setting-icon"><Bot size={18} aria-hidden="true" /></div><div><h2>Pi 运行边界</h2><p>{bridgeReady ? '主窗口已经连接到 Electron preload；模型未配置时会显示真实失败状态。' : '未连接 Electron preload，当前页面只适合做静态检查。'}</p>{runtimeError && <p className="setting-error">最近一次运行：{runtimeError}</p>}<span className={`setting-status ${bridgeReady ? 'is-ready' : ''}`}><span aria-hidden="true" />{bridgeReady ? 'Electron bridge 已连接' : '等待 Electron bridge'}</span></div></section></div></div>
}
