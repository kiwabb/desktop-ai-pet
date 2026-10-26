import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import { describe, expect, it } from 'vitest'
import type { AgentView } from '../lib/agent'
import { ChatComposer } from './ChatComposer'

// Isolated rendering inputs. No service, model, or persisted data is involved.
const connected: AgentView = {
  generation: 1, revision: 1, mode: 'server', reminders: [], reminder_error: null, todo_revision: 0,
  memo_reviews: [], memo_review_error: null, memo_revision: 0, configured: true,
  endpoint: 'https://service.invalid', connection: 'connected', node_connected: true, node_error: null,
  model: 'isolated-model', model_configured: true, error: null, server_endpoint: 'https://service.invalid', server_has_token: true,
  local_endpoint: null, local_model: null, local_has_key: false,
  snapshot: { session_id: 'isolated-composer', seq: 0, messages: [], tool_calls: [], runs: [] },
}

function render(overrides: Partial<ComponentProps<typeof ChatComposer>> = {}) {
  return renderToStaticMarkup(<ChatComposer draft="还没发送的草稿" expanded={false} visible streaming={false} status={connected} companion showQuickPrompts={false}
    inputRef={{ current: null }} selectionRef={{ current: null }} compositionRef={{ current: false }} compositionEndedAtRef={{ current: -Infinity }}
    onDraftChange={() => {}} onSubmit={() => { throw new Error('Static rendering must not send') }} onOpenSettings={() => {}} onQuickPrompt={() => {}} {...overrides} />)
}

describe('companion composer hint visibility (static rendering)', () => {
  it('keeps compact keyboard guidance accessible without reserving an action row', () => {
    const html = render()
    expect(html).toContain('class="composer-shortcut is-assistive" id="composer-hint"')
    expect(html).toContain('aria-describedby="composer-hint"')
    expect(html).toContain('Enter 发送 · Shift + Enter 换行')
    expect(html).not.toMatch(/aria-label="发送消息"[^>]*disabled/)
    expect(render({ expanded: true })).toContain('class="composer-shortcut" id="composer-hint"')
  })

  it.each([false, true])('retains one full offline reason and an editable draft when expanded=%s', expanded => {
    const reason = '验证未通过，请检查设置中的地址和凭证。'
    const html = render({ expanded, status: { ...connected, connection: 'disconnected' }, connectionNotice: { text: reason, action: true } })
    expect(html.split(reason)).toHaveLength(2)
    expect(html).toContain('连接设置')
    expect(html).toContain('class="composer-shortcut is-assistive" id="composer-hint"')
    expect(html).toContain('aria-describedby="composer-connection composer-hint"')
    expect(html).not.toContain('Enter 发送')
    expect(html).not.toMatch(/<textarea[^>]*disabled/)
    expect(html).toContain('还没发送的草稿')
    expect(html).toMatch(/aria-label="发送消息"[^>]*disabled/)
  })

  it('keeps the next draft writable during streaming and suppresses the send shortcut', () => {
    const html = render({ streaming: true })
    expect(html).toContain('class="composer-shortcut is-assistive" id="composer-hint"')
    expect(html).toContain('正在回复，可先写下一条')
    expect(html).not.toContain('Enter 发送')
    expect(html).not.toMatch(/<textarea[^>]*disabled/)
    expect(html).toMatch(/aria-label="正在回复"[^>]*disabled/)
    expect(render({ streaming: true, expanded: true })).toContain('class="composer-shortcut" id="composer-hint"')
  })
})
