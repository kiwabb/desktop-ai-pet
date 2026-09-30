import type { AgentMessage, AgentRun, AgentView, ToolCall } from './agent'

export interface UiMessage {
  role: 'user' | 'assistant'
  content: string
  runId?: string | null
  id: string
  pending?: boolean
  createdAt?: number
  runStatus?: AgentRun['status']
  runError?: string | null
}

export const HISTORY_PAGE_SIZE = 40

/** Full native snapshots have fresh identities. Reuse unchanged view models so
 * a token only reparses its own Markdown, never the entire conversation. */
export function projectConversationMessages(messages: AgentMessage[], runs: AgentRun[], previous: UiMessage[] = []): UiMessage[] {
  const previousById = new Map(previous.map(message => [message.id, message]))
  const runsById = new Map(runs.map(run => [run.id, run]))
  const projected = messages.map(message => {
    const run = message.run_id ? runsById.get(message.run_id) : undefined
    const old = previousById.get(message.id)
    const created = Date.parse(message.created_at)
    const next: UiMessage = {
      id: message.id, role: message.role, content: message.content,
      runId: message.run_id, createdAt: Number.isFinite(created) ? created : undefined,
      pending: message.role === 'assistant' && (run?.status === 'queued' || run?.status === 'running'),
      runStatus: run?.status, runError: run?.error ?? null,
    }
    return old && old.role === next.role && old.content === next.content && old.runId === next.runId
      && old.createdAt === next.createdAt && old.pending === next.pending
      && old.runStatus === next.runStatus && old.runError === next.runError ? old : next
  })
  return projected.length === previous.length && projected.every((message, index) => message === previous[index]) ? previous : projected
}

function equalResult(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => equalResult(value, right[index]))
  const a = Object.entries(left)
  const b = new Map(Object.entries(right))
  return a.length === b.size && a.every(([key, value]) => b.has(key) && equalResult(value, b.get(key)))
}

export function projectConversationTools(tools: ToolCall[], previous: ToolCall[] = []): ToolCall[] {
  const oldById = new Map(previous.map(tool => [tool.id, tool]))
  const next = tools.map(tool => {
    const old = oldById.get(tool.id)
    return old && old.run_id === tool.run_id && old.name === tool.name && old.status === tool.status
      && old.error === tool.error && equalResult(old.result, tool.result) ? old : tool
  })
  return next.length === previous.length && next.every((tool, index) => tool === previous[index]) ? previous : next
}

export function indexToolsByRun(tools: ToolCall[], previous = new Map<string, ToolCall[]>()): Map<string, ToolCall[]> {
  const next = new Map<string, ToolCall[]>()
  for (const tool of tools) {
    const list = next.get(tool.run_id)
    if (list) list.push(tool)
    else next.set(tool.run_id, [tool])
  }
  for (const [run, list] of next) {
    const old = previous.get(run)
    if (old?.length === list.length && list.every((tool, index) => old[index] === tool)) next.set(run, old)
  }
  return next
}

/** Widen the window to keep a user's question with its assistant/tool result. */
export function historyStart(messages: UiMessage[], count: number) {
  let start = Math.max(0, messages.length - count)
  const runId = messages[start]?.runId
  if (runId) while (start > 0 && messages[start - 1].runId === runId) start--
  return start
}

/** Keep provider details in the run record; expose known, actionable causes. */
function runFailureReason(message: UiMessage): string {
  const error = message.runError ?? ''
  if (/服务已停止/.test(error)) return '助手服务已停止，这次回复已中断。'
  if (/HTTP\s*(401|403)\b|认证失败|验证未通过/.test(error)) return '模型服务验证未通过，请检查连接设置中的凭证。'
  if (/HTTP\s*404\b/.test(error)) return '模型服务未找到请求的接口或模型，请检查服务地址和模型名称。'
  if (/HTTP\s*429\b/.test(error)) return '模型服务的调用额度或频率已受限，请检查额度或稍后再试。'
  if (/HTTP\s*5\d\d\b/.test(error)) return '模型服务暂时不可用，请稍后再试。'
  if (/超时/.test(error)) return '这次回复等待超时，请稍后再试。'
  if (/步数上限/.test(error)) return '这次请求需要的处理步骤过多，请拆成几个较小的请求。'
  if (/无法连接模型服务|模型服务连接失败/.test(error)) return '无法连接模型服务，请检查服务地址和运行状态。'
  return message.runStatus === 'interrupted' ? '这次回复已中断。' : '这次回复未能完成。'
}

export function terminalMessageLabel(message: UiMessage, toolCount: number): string | null {
  if (message.role !== 'assistant' || message.pending) return null
  if (message.runStatus === 'failed' || message.runStatus === 'interrupted') {
    const resultGuidance = toolCount > 0 ? '请先核对上方的执行记录，确认结果后再操作；橘伴不会自动重试。' : ''
    return runFailureReason(message) + resultGuidance
  }
  if (message.content.trim() || toolCount > 0) return null
  return '这次没有收到文字回复，你可以重新描述问题。'
}

export function composerAvailability(status: AgentView | null, streaming: boolean) {
  if (!status) return { reason: '正在读取助手状态…', action: false }
  if (!status.configured) return { reason: '连接助手后即可发送，草稿会为你保留。', action: true }
  if (status.connection !== 'connected') return { reason: status.connection === 'connecting' ? '正在连接，连接恢复后即可发送。' : '连接已断开，恢复连接后可发送。', action: true }
  if (!status.model_configured) return { reason: '还没有可用模型，请先完成连接设置。', action: true }
  return { reason: streaming ? '橘伴正在回复，你可以先写下一条。' : '', action: false }
}

export function conversationAnnouncement(messages: UiMessage[], tools: ToolCall[]) {
  const latest = messages.at(-1)
  if (!latest) return ''
  if (latest.pending) {
    const tool = tools.find(item => item.run_id === latest.runId && item.status === 'running')
    return tool ? '橘伴正在处理你的请求。' : '橘伴正在回复。'
  }
  if (latest.runStatus === 'failed') return '这次回复未完成，请查看消息中的说明。'
  if (latest.runStatus === 'interrupted') return latest.runId && tools.some(tool => tool.run_id === latest.runId)
    ? '这次回复已中断，请先核对执行记录。' : '这次回复已中断。'
  return latest.role === 'assistant' ? '橘伴的回复已完成。' : '消息已发送。'
}
