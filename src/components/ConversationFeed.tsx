import { Check, CheckCheck, ChevronDown, CircleAlert, History, LoaderCircle, MessageCircle } from 'lucide-react'
import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ToolCall } from '../lib/agent'
import { historyStart, indexToolsByRun, terminalMessageLabel } from '../lib/conversation-presentation'
import type { UiMessage } from '../lib/conversation-presentation'
import { presentTool } from '../lib/tool-presentation'
import { watchRowEntrance } from '../lib/row-entrance'
import { MessageContent } from './MessageContent'

const noTools: ToolCall[] = []
const timeFormat = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
const exactTimeFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })

const ToolResult = memo(function ToolResult({ tool }: { tool: ToolCall }) {
  const presentation = presentTool(tool)
  const uncertain = presentation.status === '结果待确认'
  const problem = tool.status === 'failed' || tool.status === 'needs_reconciliation' || uncertain
  const Icon = tool.status === 'running' ? LoaderCircle : problem ? CircleAlert : Check
  const summary = tool.error || presentation.text || (tool.status === 'running' ? '正在处理…' : problem ? '执行结果尚未确认，请先核对。' : '执行记录已保存。')
  const lengthy = summary.length > 140 || summary.includes('\n')
  return <div className={`agent-tool-result is-${problem ? 'attention' : tool.status}`}>
    <div className="tool-result-heading"><Icon className={tool.status === 'running' ? 'spinner' : undefined} aria-hidden="true" /><strong>{presentation.name}</strong><span>{presentation.status}</span></div>
    {lengthy ? <details className="tool-result-details" onKeyDown={event => {
      if (event.key !== 'Escape' || !event.currentTarget.open) return
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.open = false
      event.currentTarget.querySelector('summary')?.focus()
    }}><summary><span>{summary.split('\n')[0]}</span><ChevronDown aria-hidden="true" /><span className="sr-only">展开完整结果</span></summary><p>{summary}</p></details> : <p>{summary}</p>}
    {problem && !tool.error && !uncertain && <p className="tool-result-guidance">请核对已有结果后再操作，橘伴不会自动重复执行。</p>}
  </div>
})

const MessageRow = memo(function MessageRow({ message, tools, animate, companion, pairedReply }: { message: UiMessage; tools: ToolCall[]; animate: boolean; companion: boolean; pairedReply: boolean }) {
  // Only the mount can start an entrance. New tokens and parent animate hints
  // must not restart a settled row or extend the original cleanup deadline.
  const [entering, setEntering] = useState(animate)
  const rowRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (!entering) return
    const row = rowRef.current
    if (!row) { setEntering(false); return }
    return watchRowEntrance(row, 'conversation-arrive', () => setEntering(false))
  }, [entering])
  const terminal = terminalMessageLabel(message, tools.length)
  const hasText = message.content.trim().length > 0
  const pending = message.role === 'assistant' && message.pending
  const progress = pending ? tools.some(tool => tool.status === 'running') ? '正在处理…' : hasText ? '正在回复…' : '正在想…' : null
  const exactTime = message.createdAt !== undefined ? exactTimeFormat.format(message.createdAt) : ''
  return <article ref={rowRef} className={`message message-${message.role}${pairedReply ? ' has-paired-reply' : ''}${entering ? ' is-new' : ''}`} aria-label={message.role === 'user' ? '你的消息' : '橘伴的回复'}>
    <div className="message-content">
      <div className="message-meta"><span className={companion && message.role === 'user' ? 'sr-only' : 'message-author'}>{message.role === 'user' ? '你' : '橘伴'}</span>{exactTime && <time className="message-time" dateTime={new Date(message.createdAt ?? 0).toISOString()} title={exactTime} aria-label={exactTime}>{timeFormat.format(message.createdAt)}</time>}{progress && <span className="message-progress">{progress}</span>}{message.role === 'user' && (companion ? <span className="sr-only">已发送</span> : <CheckCheck aria-label="已发送" />)}</div>
      {hasText && <div className="message-bubble"><MessageContent content={message.content} /></div>}
      {!hasText && pending && tools.length === 0 && <div className="message-pending" aria-hidden="true"><span className="typing-dots"><span /><span /><span /></span></div>}
      {tools.length > 0 && <div className="message-tools" aria-label="执行结果">{tools.map(tool => <ToolResult key={tool.id} tool={tool} />)}</div>}
      {terminal && <p className={`message-outcome${message.runStatus === 'failed' || message.runStatus === 'interrupted' ? ' is-attention' : ''}`}><CircleAlert aria-hidden="true" /><span>{terminal}</span></p>}
    </div>
  </article>
})

interface ConversationFeedProps {
  messages: UiMessage[]
  tools: ToolCall[]
  count: number
  configured: boolean
  companion?: boolean
  compact?: boolean
  emptyActions?: ReactNode
  onLoadEarlier: () => void
  onOpenSettings: () => void
}

interface HistoryWindow { firstId: string | null; start: number; count: number }

/** Appends and token updates keep the anchor at the same index. Only a displaced
 * or removed ID needs a history scan; run boundaries still own the final start. */
export function resolveHistoryWindow(messages: UiMessage[], count: number, previous: HistoryWindow | null): HistoryWindow {
  const previousStart = previous?.firstId == null ? -1
    : messages[previous.start]?.id === previous.firstId ? previous.start
      : messages.findIndex(message => message.id === previous.firstId)
  const start = previousStart < 0 ? historyStart(messages, count)
    : historyStart(messages, messages.length - previousStart + Math.max(0, count - (previous?.count ?? count)))
  return { firstId: messages[start]?.id ?? null, start, count }
}

export function ConversationFeed({ messages, tools, count, configured, companion = false, compact = false, emptyActions, onLoadEarlier, onOpenSettings }: ConversationFeedProps) {
  const [originalIds] = useState(() => new Set(messages.map(message => message.id)))
  const windowRef = useRef<HistoryWindow | null>(null)
  const priorIndex = useRef(new Map<string, ToolCall[]>())
  const byRun = useMemo(() => {
    const next = indexToolsByRun(tools, priorIndex.current)
    priorIndex.current = next
    return next
  }, [tools])
  windowRef.current = resolveHistoryWindow(messages, count, windowRef.current)
  const { start } = windowRef.current
  const currentRun = messages.at(-1)?.pending ? messages.at(-1)?.runId : null
  return <>
    {start > 0 && <button className="chat-history-button" type="button" onClick={onLoadEarlier}><History aria-hidden="true" />{compact ? '展开阅读' : '查看更早的消息'}<span>{start} 条</span></button>}
    {messages.length === 0 && <div className="empty-state">
      {companion ? <div className="companion-greeting">
        <h2>我在呀，慢慢说。</h2>
        {!compact && <p>想到什么就先写下来，晚点聊也没关系。</p>}
      </div> : <>
        {!compact && <><MessageCircle className="empty-state-mark" aria-hidden="true" /><h2>{configured ? '想记的事，慢慢说。' : '让橘伴开始倾听'}</h2></>}
        <p>{compact ? configured ? '想聊什么，慢慢说。' : '先连接助手，就能开始对话。' : configured ? '这里会留下我们的对话。可以整理想法，也可以记下一件待办。' : '先连接你的助手，之后就能聊天、记事和安排提醒。'}</p>
        {!configured && <button className="configure-button" type="button" onClick={onOpenSettings}>连接设置</button>}
      </>}
      {emptyActions}
    </div>}
    {messages.slice(start).map((message, index) => {
      const next = messages[start + index + 1]
      const pairedReply = message.role === 'user' && Boolean(message.runId) && next?.role === 'assistant' && next.runId === message.runId
      return <MessageRow key={message.id} message={message} tools={message.role === 'assistant' && message.runId ? byRun.get(message.runId) ?? noTools : noTools} companion={companion} pairedReply={pairedReply} animate={Boolean(currentRun && message.runId === currentRun && !originalIds.has(message.id))} />
    })}
  </>
}
