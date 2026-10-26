import { describe, expect, it } from 'vitest'
import type { AgentMessage, AgentRun, ToolCall } from './agent'
import { composerAvailability, conversationAnnouncement, historyStart, indexToolsByRun, projectConversationMessages, projectConversationTools, terminalMessageLabel } from './conversation-presentation'
import type { UiMessage } from './conversation-presentation'

const messages: AgentMessage[] = [
  { id: 'question', role: 'user', content: '测试问题', created_at: '2026-09-14T08:00:00Z', run_id: 'run' },
  { id: 'answer', role: 'assistant', content: '', created_at: '2026-09-14T08:00:01Z', run_id: 'run' },
]
const run: AgentRun = { id: 'run', request_id: 'request', status: 'running', error: null }
const tool: ToolCall = { id: 'call', run_id: 'run', name: 'todo_create', status: 'completed', result: { item: { id: 'test', title: '测试待办' } }, error: null }

describe('conversation projection', () => {
  it('reuses every unchanged history message when one streamed answer changes', () => {
    const initial = projectConversationMessages(messages, [run])
    const repeated = projectConversationMessages(structuredClone(messages), [{ ...run }], initial)
    expect(repeated).toBe(initial)
    const token = projectConversationMessages([messages[0], { ...messages[1], content: '测试回答' }], [run], repeated)
    expect(token[0]).toBe(initial[0])
    expect(token[1]).not.toBe(initial[1])
    expect(token[1].pending).toBe(true)
  })

  it('keeps each historical run failure and updates its own row on terminal transition', () => {
    const initial = projectConversationMessages(messages, [run])
    const failed = projectConversationMessages(messages, [{ ...run, status: 'failed', error: '测试失败说明' }], initial)
    expect(failed[1].pending).toBe(false)
    expect(failed[1].runError).toBe('测试失败说明')
    expect(terminalMessageLabel(failed[1], 1)).toContain('这次回复未能完成')
    expect(terminalMessageLabel(failed[1], 1)).toContain('核对上方的执行记录')
    expect(terminalMessageLabel(failed[1], 1)).not.toContain('测试失败说明')
  })

  it('never fabricates a time for missing or malformed timestamps', () => {
    const result = projectConversationMessages([{ ...messages[0], created_at: 'invalid' }], [run])
    expect(result[0].createdAt).toBeUndefined()
  })

  it('reuses semantic tool results across new native object identities', () => {
    const first = projectConversationTools([tool])
    expect(projectConversationTools(structuredClone(first), first)).toBe(first)
    const changed = projectConversationTools([{ ...tool, result: { item: { id: 'test', title: '修改后的测试待办' } } }], first)
    expect(changed[0]).not.toBe(first[0])
    const index = indexToolsByRun(first)
    expect(indexToolsByRun(first, index).get('run')).toBe(index.get('run'))
  })
})

describe('history and truthful terminal states', () => {
  it('explains provider failures without inventing tool results or exposing raw details', () => {
    const failed: UiMessage = { id: 'failed', role: 'assistant', content: '', runStatus: 'failed', runError: '模型服务返回 HTTP 404，已保存的工具结果保留' }
    expect(terminalMessageLabel(failed, 0)).toBe('模型服务未找到请求的接口或模型，请检查服务地址和模型名称。')
    const withTools = terminalMessageLabel(failed, 1)
    expect(withTools).toContain('核对上方的执行记录')
    expect(withTools).not.toContain('已保存')
    expect(terminalMessageLabel({ ...failed, runError: 'internal detail: private-value' }, 0)).toBe('这次回复未能完成。')
  })

  it.each([
    ['模型服务返回 HTTP 401', '验证未通过'],
    ['模型服务返回 HTTP 403', '验证未通过'],
    ['模型服务返回 HTTP 429', '调用额度或频率'],
    ['模型服务返回 HTTP 503', '暂时不可用'],
    ['任务执行超时，已保存的工具结果保留', '等待超时'],
    ['已达到工具推理步数上限', '拆成几个较小的请求'],
    ['无法连接模型服务，请检查服务端模型地址和服务状态', '检查服务地址和运行状态'],
  ])('preserves the actionable cause of %s', (runError, guidance) => {
    const label = terminalMessageLabel({ id: 'failed', role: 'assistant', content: '', runStatus: 'failed', runError }, 0)
    expect(label).toContain(guidance)
    expect(label).not.toContain('工具结果保留')
  })

  it('only announces execution records belonging to the interrupted run', () => {
    const stopped: UiMessage = { id: 'stopped', role: 'assistant', content: '', runId: 'stopped-run', runStatus: 'interrupted', runError: '服务已停止，已保存的工具结果保留' }
    expect(terminalMessageLabel(stopped, 0)).toBe('助手服务已停止，这次回复已中断。')
    expect(conversationAnnouncement([stopped], [tool])).toBe('这次回复已中断。')
    for (const status of ['completed', 'running', 'failed'] as const) {
      expect(conversationAnnouncement([stopped], [{ ...tool, run_id: 'stopped-run', status, result: null }])).toBe('这次回复已中断，请先核对执行记录。')
    }
  })

  it('bounds the initial history and keeps the first question with its answer', () => {
    const history: UiMessage[] = Array.from({ length: 101 }, (_, index) => ({ id: `m-${index}`, content: '', role: index % 2 === 0 ? 'user' : 'assistant', runId: `r-${Math.floor(index / 2)}` }))
    expect(historyStart(history, 40)).toBe(60)
    expect(historyStart(history, 80)).toBe(20)
    expect(historyStart(history, 200)).toBe(0)
  })

  it('shows a missing text outcome only without visible text or real tool results', () => {
    const blank: UiMessage = { id: 'blank', role: 'assistant', content: '  ', runStatus: 'completed' }
    expect(terminalMessageLabel(blank, 0)).toContain('没有收到文字回复')
    expect(terminalMessageLabel(blank, 1)).toBeNull()
    expect(terminalMessageLabel({ ...blank, content: '真实返回内容' }, 0)).toBeNull()
    expect(terminalMessageLabel({ ...blank, pending: true }, 0)).toBeNull()
    expect(terminalMessageLabel({ ...blank, runStatus: 'interrupted' }, 1)).toContain('不会自动重试')
  })

  it('announces state changes rather than every token', () => {
    const first = projectConversationMessages(messages, [run])
    const next = projectConversationMessages([messages[0], { ...messages[1], content: '更多内容' }], [run])
    expect(conversationAnnouncement(first, [])).toBe(conversationAnnouncement(next, []))
    expect(conversationAnnouncement(projectConversationMessages(messages, [{ ...run, status: 'failed' }]), [])).toContain('未完成')
    expect(composerAvailability(null, false).reason).toContain('读取助手状态')
  })
})
