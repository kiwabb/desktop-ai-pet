import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import { describe, expect, it } from 'vitest'
import type { AgentView } from '../lib/agent'
import { ChatPanel } from './ChatPanel'
import { ChatComposer } from './ChatComposer'

// Isolated render inputs only: these never reach a service or persisted state.
const connected: AgentView = {
  generation: 1, revision: 1, mode: 'server', reminders: [], reminder_error: null, todo_revision: 0,
  memo_reviews: [], memo_review_error: null, memo_revision: 0, configured: true,
  endpoint: 'https://service.invalid', connection: 'connected', node_connected: true, node_error: null,
  model: 'isolated-model', model_configured: true, error: null, server_endpoint: 'https://service.invalid', server_has_token: true,
  local_endpoint: null, local_model: null, local_has_key: false,
  snapshot: { session_id: 'isolated-render', seq: 0, messages: [], tool_calls: [], runs: [] },
}

function render(overrides: Partial<ComponentProps<typeof ChatPanel>> = {}) {
  return renderToStaticMarkup(<ChatPanel appearance="companion" expanded={false} status={connected} messages={[]} tools={[]}
    streaming={false} error={null} acceptedRequestId={null} onClose={() => {}} onExpandedChange={() => {}}
    onSend={() => { throw new Error('Static render must not send') }} {...overrides} />)
}

describe('companion conversation surface (static rendering)', () => {
  it('does not present pending restoration as an empty conversation, while keeping the draft editable', () => {
    for (const status of [null, { ...connected, connection: 'connecting' as const, snapshot: { ...connected.snapshot, session_id: '' } }]) {
      const html = render({ status })
      expect(html).toContain('正在恢复对话…')
      expect(html).not.toContain('我在呀，慢慢说。')
      expect(html).not.toContain('class="quick-prompts"')
      expect(html).not.toContain('class="composer-connection"')
      expect(html).toMatch(/aria-label="发送消息"[^>]*disabled=""/)
      expect(html).toContain('id="chat-input"')
      expect(html).not.toMatch(/<textarea[^>]*disabled/)
    }
  })

  it('distinguishes unavailable history from a restored empty session without duplicating the recovery notice', () => {
    const html = render({ status: { ...connected, mode: 'local', connection: 'disconnected', error: 'isolated storage failure', snapshot: { ...connected.snapshot, session_id: '' } }, error: 'isolated storage failure' })
    expect(html).toContain('对话暂未恢复')
    expect(html.split('本地对话暂未恢复，请重新打开橘伴后重试。')).toHaveLength(2)
    expect(html).not.toContain('我在呀，慢慢说。')
    expect(html).not.toContain('正在恢复对话…')
    expect(html).not.toContain('isolated storage failure')
    expect(html).not.toContain('class="composer-connection"')
  })

  it('retains restored messages and the real empty state when a known session reconnects', () => {
    const status = { ...connected, connection: 'connecting' as const }
    expect(render({ status })).toContain('我在呀，慢慢说。')
    const html = render({ status, messages: [{ id: 'restored', role: 'user', content: '隔离的已恢复消息' }] })
    expect(html).toContain('隔离的已恢复消息')
    expect(html).not.toContain('正在恢复对话…')
    expect(html).toContain('正在连接，连接恢复后即可发送。')
  })

  it('shows the current compact turn and pending reply in the visible reading surface', () => {
    const html = render({ streaming: true, messages: [
      { id: 'q', role: 'user', content: '隔离检查的新消息', runId: 'r' },
      { id: 'a', role: 'assistant', content: '', pending: true, runId: 'r' },
    ] })
    expect(html).toContain('is-compact is-companion')
    expect(html).toContain('<div class="chat-content-with-reminders">')
    expect(html).toContain('隔离检查的新消息')
    expect(html.match(/正在想…/g)).toHaveLength(1)
    expect(html).toContain('aria-label="展开阅读"')
    expect(html).not.toContain('assistant-paw-badge')
    expect(html).not.toContain('chat-bubble-shell')
    expect(html).not.toContain('class="quick-prompts"')
  })

  it('keeps compact history bounded and gives an explicit larger reading entry', () => {
    const html = render({ messages: Array.from({ length: 1000 }, (_, index) => ({ id: `${index}`, role: 'user', content: `隔离消息 ${index}` })) })
    expect(html.match(/<article\b/g)).toHaveLength(40)
    expect(html).toContain('展开阅读')
    expect(html).toContain('隔离消息 999')
    expect(html).not.toContain('隔离消息 959<')
  })

  it('keeps all utilities and actionable settings available while offline', () => {
    const html = render({ status: { ...connected, connection: 'disconnected' } })
    expect(html).toContain('<nav class="chat-navigation" aria-label="助手功能">')
    for (const label of ['聊天', '查看待办列表', '查看备忘录', '配置助手服务']) {
      expect(html).toContain(`type="button" aria-label="${label}"`)
    }
    expect(html).toMatch(/aria-label="发送消息"[^>]*disabled=""/)
    expect(html).toContain('连接设置')
    const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'))
    expect(nav).toContain('aria-label="聊天" aria-current="page"')
    expect(nav).not.toContain('配置助手服务')
  })

  it('shows streamed text, tool activity and failure without hiding the composer', () => {
    const html = render({ error: '这次发送未被接受，请重试。', messages: [
      { id: 'a', role: 'assistant', content: '隔离检查的流式内容', pending: true, runId: 'r' },
    ], tools: [{ id: 'tool', run_id: 'r', name: 'todo_list', status: 'running', result: null, error: null }] })
    expect(html).toContain('隔离检查的流式内容')
    expect(html).toContain('agent-tool-result is-running')
    expect(html).toContain('role="alert"')
    expect(html).toContain('这次发送未被接受，请重试。')
    expect(html).toContain('id="chat-input"')
  })

  it('keeps the empty invitation and two draft suggestions apart from connection state', () => {
    const html = render()
    expect(html).toContain('我在呀，慢慢说。')
    expect(html).toContain('<h2>我在呀，慢慢说。</h2>')
    expect(html).toContain('帮我记件事')
    expect(html).toContain('陪我理理思路')
    expect(html).not.toContain('提醒我别忘')
    expect(html).not.toContain('帮我整理文档')
    expect(render({ expanded: true })).toContain('想到什么就先写下来，晚点聊也没关系。')
  })

  it('presents one actionable offline explanation and leaves the draft editable', () => {
    const html = render({ status: { ...connected, connection: 'disconnected', error: '原始连接失败' }, error: '原始连接失败' })
    expect(html.match(/>连接已断开，恢复连接后可发送。</g)).toHaveLength(1)
    expect(html).not.toContain('原始连接失败')
    expect(html).not.toContain('inline-error')
    expect(html).not.toContain('class="composer-hint"')
    expect(html).toContain('class="quick-prompts"')
    expect(html).toContain('class="composer-connection"')
    expect(html).toContain('aria-describedby="composer-connection composer-hint"')
    expect(html).toContain('placeholder="先写下来，连接后发送…"')
    expect(html).not.toContain('橘伴在听')
    expect(html).toContain('class="composer-actions"')
    expect(html).toContain('可先写下想聊的事 · Shift + Enter 换行')
    expect(html).not.toContain('Enter 发送')
    expect(html).not.toContain('草稿已保留')
    expect(html).toContain('lucide-arrow-up')
    expect(html).toMatch(/<textarea[^>]*id="chat-input"/)
    expect(html).not.toMatch(/<textarea[^>]*disabled/)
  })

  it('keeps an actual send or window failure visible while the connection is unavailable', () => {
    const html = render({ status: { ...connected, connection: 'disconnected' }, error: '这次发送未被接受，请重试。' })
    expect(html).toContain('class="inline-error compact-error" role="alert"')
    expect(html).toContain('这次发送未被接受，请重试。')
    expect(html).toContain('连接已断开，恢复连接后可发送。')
  })

  it('only advertises sending when a configured model is connected, including with a nonempty draft', () => {
    for (const status of [connected, { ...connected, connection: 'disconnected' as const }, { ...connected, model_configured: false }]) {
      const html = renderToStaticMarkup(<ChatComposer draft="尚未发送的内容" expanded={false} visible streaming={false} status={status} companion
        inputRef={{ current: null }} selectionRef={{ current: null }} compositionRef={{ current: false }} compositionEndedAtRef={{ current: -Infinity }}
        onDraftChange={() => {}} onSubmit={() => { throw new Error('Static render must not send') }} onOpenSettings={() => {}} onQuickPrompt={() => {}} />)
      const available = status.connection === 'connected' && status.model_configured
      expect(html.includes('Enter 发送')).toBe(available)
      expect(/aria-label="发送消息"[^>]*disabled=""/.test(html)).toBe(!available)
      expect(html).toContain('尚未发送的内容')
      expect(html).not.toContain('草稿已保留')
      expect(html).not.toMatch(/<textarea[^>]*disabled/)
    }
  })

  it('preserves known safe connection reasons once by the composer without raw endpoint details', () => {
    for (const [raw, expected] of [
      ['HTTP401 https://provider.invalid?key=unit-secret', '验证未通过，请检查设置中的地址和凭证。'],
      ['HTTP404 https://provider.invalid?key=unit-secret', '服务未找到请求的接口或资源，请检查服务地址。'],
    ]) {
      const html = render({ status: { ...connected, connection: 'disconnected', error: raw }, error: raw })
      expect(html.split(expected)).toHaveLength(2)
      expect(html).toContain('class="composer-connection"')
      expect(html).not.toContain('连接已断开，恢复连接后可发送。')
      expect(html).not.toContain('unit-secret')
      expect(html).not.toContain('provider.invalid')
      expect(html).not.toContain('inline-error')
    }
  })

  it('does not swallow a device error when no unavailable-connection notice is rendered', () => {
    const html = render({ status: { ...connected, node_error: '设备连接失败，请重试。' }, error: '设备连接失败，请重试。' })
    expect(html).toContain('class="inline-error compact-error" role="alert"')
    expect(html).toContain('设备连接失败，请重试。')
    expect(html).not.toContain('class="composer-connection"')
  })

  it('keeps both sync failures inspectable in one summary without empty reminder bands', () => {
    const html = render({ expanded: true, status: { ...connected, reminder_error: 'HTTP401', memo_review_error: 'isolated sync failure' } })
    expect(html.match(/class="reminder-sync-notice"/g)).toHaveLength(1)
    expect(html).toContain('提醒同步遇到问题')
    expect(html).toContain('验证未通过，请检查设置中的地址和凭证。')
    expect(html).toContain('回顾暂未同步，连接恢复后会自动重试。')
    expect(html).not.toContain('class="todo-reminders"')
  })

  it('retains the legacy frame appearance for existing reference callers', () => {
    const html = render({ appearance: 'attached', attached: true })
    expect(html).toContain('assistant-paw-badge')
    expect(html).toContain('chat-content-with-reminders" hidden=""')
    expect(html).toContain('class="quick-prompts"')
  })
})
