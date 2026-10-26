import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import type { AgentView } from '../lib/agent'
import { AssistantSettings } from './AssistantSettings'

const noop = () => {}
function props(overrides: Partial<ComponentProps<typeof AssistantSettings>> = {}): ComponentProps<typeof AssistantSettings> {
  return { status: null, mode: 'server', baseUrl: '', credential: '', localBaseUrl: '', localApiKey: '', localModel: '', saving: false, error: null,
    onModeChange: noop, onBaseUrlChange: noop, onCredentialChange: noop, onLocalBaseUrlChange: noop, onLocalApiKeyChange: noop, onLocalModelChange: noop, onSubmit: noop, ...overrides }
}
const serverStatus: AgentView = {
  generation: 1, revision: 1, mode: 'server', reminders: [], reminder_error: null, todo_revision: 0, memo_reviews: [], memo_review_error: null, memo_revision: 0, configured: true,
  endpoint: 'https://service.invalid', connection: 'disconnected', node_connected: false, node_error: null,
  model: 'server-model', model_configured: true, error: null, server_endpoint: 'https://service.invalid', server_has_token: true,
  local_endpoint: null, local_model: null, local_has_key: false, snapshot: { session_id: 'unit-only', seq: 0, messages: [], tool_calls: [], runs: [] },
}

describe('settings presentation contracts (static rendering only)', () => {
  it('locks the entire editable form during a save', () => {
    const html = renderToStaticMarkup(<AssistantSettings {...props({ saving: true })} />)
    expect(html.match(/<form\b/g)).toHaveLength(1)
    expect(html).toMatch(/<fieldset[^>]*disabled=""/)
    expect(html).toContain('正在保存…')
  })

  it('uses editing mode for help and saved mode for actual connection', () => {
    const html = renderToStaticMarkup(<AssistantSettings {...props({ mode: 'local', status: serverStatus })} />)
    expect(html).toContain('单机模式怎么设置？')
    expect(html).toContain('服务端模式')
    expect(html).toContain('https://service.invalid')
    expect(html).toContain('连接断了，正在重连')
  })

  it('retains a saved result without claiming the service connected', () => {
    const html = renderToStaticMarkup(<AssistantSettings {...props({ status: serverStatus, success: '设置已保存', onReturnToChat: noop })} />)
    expect(html).toContain('设置已保存')
    expect(html).toContain('连接断了，正在重连')
    expect(html).toContain('返回聊天')
  })

  it('renders raw save and connection 404 errors as settings guidance without exposing details', () => {
    const rawError = 'HTTP404 https://provider.invalid/v1/models?key=unit-only-secret'
    const html = renderToStaticMarkup(<AssistantSettings {...props({ error: rawError, status: { ...serverStatus, error: rawError } })} />)
    expect(html.match(/服务未找到请求的接口或资源，请检查服务地址。/g)).toHaveLength(2)
    expect(html).not.toContain('这项待办已不存在')
    expect(html).not.toContain('unit-only-secret')
    expect(html).not.toContain('provider.invalid')
  })

  it('does not turn a settings conflict into reminder or completed-todo guidance', () => {
    const html = renderToStaticMarkup(<AssistantSettings {...props({ error: 'HTTP 409 操作已完成', status: { ...serverStatus, node_error: 'HTTP 409' } })} />)
    expect(html).toContain('设置未保存，请检查填写内容后重试。')
    expect(html).toContain('连接暂不可用，请检查服务是否运行，以及地址和凭证。')
    expect(html).not.toContain('提醒已在其他地方修改')
    expect(html).not.toContain('这项待办已经完成')
  })

  it('does not claim local readiness while its connection is unavailable', () => {
    const localStatus = { ...serverStatus, mode: 'local' as const }
    const disconnected = renderToStaticMarkup(<AssistantSettings {...props({ mode: 'local', status: localStatus })} />)
    expect(disconnected).toContain('本机助手暂不可用，请检查连接')
    expect(disconnected).not.toContain('本机已就绪')
    const connecting = renderToStaticMarkup(<AssistantSettings {...props({ mode: 'local', status: { ...localStatus, connection: 'connecting' } })} />)
    expect(connecting).toContain('正在连接本机助手')
    expect(connecting).not.toContain('本机已就绪')
    const connected = renderToStaticMarkup(<AssistantSettings {...props({ mode: 'local', status: { ...localStatus, connection: 'connected' } })} />)
    expect(connected).toContain('本机已就绪，等待对话')
  })
})
