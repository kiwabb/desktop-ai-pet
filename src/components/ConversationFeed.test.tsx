import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConversationFeed, resolveHistoryWindow } from './ConversationFeed'
import type { UiMessage } from '../lib/conversation-presentation'
import type { ToolCall } from '../lib/agent'
import '../lib/tool-plugins'

function render(messages: UiMessage[], tools: ToolCall[] = []) {
  return renderToStaticMarkup(<ConversationFeed messages={messages} tools={tools} count={40} configured onLoadEarlier={() => {}} onOpenSettings={() => {}} />)
}

describe('conversation feed rendering', () => {
  it('renders a terminal explanation instead of an empty bubble', () => {
    const markup = render([{ id: 'empty', role: 'assistant', content: '', runStatus: 'completed' }])
    expect(markup).toContain('没有收到文字回复')
    expect(markup).not.toContain('class="message-bubble"')
    expect(markup).not.toContain('<time')
  })

  it('bounds history DOM while keeping earlier content reachable', () => {
    const history: UiMessage[] = Array.from({ length: 1000 }, (_, index) => ({ id: String(index), role: 'user', content: `测试 ${index}` }))
    const markup = render(history)
    expect(markup.match(/<article/g)).toHaveLength(40)
    expect(markup).toContain('查看更早的消息')
    expect(markup).not.toContain('is-new')
    expect(markup).not.toContain('aria-live')
  })

  it('does not replay arrivals when existing pending messages mount from a restored snapshot (isolated SSR)', () => {
    const pending: UiMessage[] = [
      { id: 'question', role: 'user', content: '测试消息', runId: 'run' },
      { id: 'answer', role: 'assistant', content: '', runId: 'run', pending: true },
    ]
    expect(render(pending)).not.toContain('is-new')
    // This is a fresh mount with later snapshot content, not a mounted token
    // update simulation: recovery must still treat these IDs as existing rows.
    expect(render([pending[0], { ...pending[1], content: '已接收的部分内容' }])).not.toContain('is-new')
  })

  it('waits for the first token with a quiet typing indicator instead of a spinner', () => {
    const markup = render([
      { id: 'question', role: 'user', content: '测试消息', runId: 'run' },
      { id: 'answer', role: 'assistant', content: '', runId: 'run', pending: true },
    ])
    expect(markup.match(/正在想…/g)).toHaveLength(1)
    expect(markup).toContain('class="message-pending" aria-hidden="true"')
    expect(markup).toContain('typing-dots')
    expect(markup).not.toContain('橘伴正在思考')
    expect(markup).not.toContain('spinner')
  })

  it('keeps a message-local progress cue from waiting through partial text without another live region', () => {
    const answer: UiMessage = { id: 'answer', role: 'assistant', content: '', runId: 'run', pending: true, runStatus: 'running' }
    expect(render([answer])).toContain('class="message-progress">正在想…')
    const partial = render([{ ...answer, content: '先整理一个小区域' }])
    expect(partial).toContain('class="message-progress">正在回复…')
    expect(partial).toContain('先整理一个小区域')
    expect(partial).not.toContain('typing-dots')
    expect(partial).not.toContain('aria-live')
  })

  it('uses the current reply’s actual tool activity and keeps waiting after a tool completes', () => {
    const answer: UiMessage = { id: 'answer', role: 'assistant', content: '我先查看记录。', runId: 'run', pending: true }
    const tool: ToolCall = { id: 'call', run_id: 'run', name: 'todo_list', status: 'running', result: null, error: null }
    expect(render([answer], [tool])).toContain('class="message-progress">正在处理…')
    expect(render([answer], [{ ...tool, status: 'completed', result: { items: [] } }])).toContain('class="message-progress">正在回复…')
    expect(render([answer], [{ ...tool, run_id: 'older-run' }])).toContain('class="message-progress">正在回复…')
  })

  it.each(['completed', 'failed', 'interrupted'] as const)('removes running cues when a partial reply becomes %s', runStatus => {
    const markup = render([{ id: 'answer', role: 'assistant', content: '保留已经收到的内容', runId: 'run', pending: false, runStatus }])
    expect(markup).toContain('保留已经收到的内容')
    expect(markup).not.toContain('message-progress')
    expect(markup).not.toContain('typing-dots')
    if (runStatus !== 'completed') expect(markup).toContain('message-outcome is-attention')
  })

  it('groups only an adjacent question and reply belonging to the same known run', () => {
    const question: UiMessage = { id: 'question', role: 'user', content: '问题', runId: 'run' }
    const answer: UiMessage = { id: 'answer', role: 'assistant', content: '回答', runId: 'run' }
    expect(render([question, answer]).match(/has-paired-reply/g)).toHaveLength(1)
    expect(render([question, { ...answer, runId: 'other-run' }])).not.toContain('has-paired-reply')
    expect(render([{ ...question, runId: null }, { ...answer, runId: null }])).not.toContain('has-paired-reply')
    expect(render([question, { ...question, id: 'other-question', runId: 'other-run' }, answer])).not.toContain('has-paired-reply')
  })

  it('keeps completed operations visible when a run fails after executing tools', () => {
    const markup = renderToStaticMarkup(<ConversationFeed messages={[{ id: 'answer', role: 'assistant', content: '', runId: 'run', runStatus: 'failed', runError: '测试中断' }]} tools={[{ id: 'call', run_id: 'run', name: 'todo_create', status: 'completed', result: { item: { title: '测试记录' } }, error: null }]} count={40} configured onLoadEarlier={() => {}} onOpenSettings={() => {}} />)
    expect(markup).toContain('已记录：测试记录')
    expect(markup).toContain('这次回复未能完成')
    expect(markup).toContain('核对上方的执行记录')
    expect(markup).not.toContain('测试中断')
    expect(markup.indexOf('已记录：测试记录')).toBeLessThan(markup.indexOf('核对上方的执行记录'))
    expect(markup).not.toContain('class="message-bubble"')
  })
})

describe('history anchor lookup (isolated arrays)', () => {
  const history = (length: number, prefix = ''): UiMessage[] => Array.from({ length }, (_, index) => ({ id: `${prefix}${index}`, role: 'user', content: `isolated ${index}` }))
  function forbidPrefix(messages: UiMessage[], before: number) {
    return new Proxy(messages, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property) && Number(property) < before)
          throw new Error(`Unrelated historical prefix read at ${property}`)
        return Reflect.get(target, property, receiver)
      },
    })
  }

  it('does not revisit unrelated prefixes on initial window, unchanged history, tokens or appends', () => {
    const messages = history(1000)
    const initial = resolveHistoryWindow(forbidPrefix(messages, 960), 40, null)
    expect(initial).toEqual({ firstId: '960', start: 960, count: 40 })
    expect(resolveHistoryWindow(forbidPrefix(messages, 960), 40, initial)).toEqual(initial)
    const updated = [...messages.slice(0, -1), { ...messages[999], content: 'new isolated token' }]
    expect(resolveHistoryWindow(forbidPrefix(updated, 960), 40, initial)).toEqual(initial)
    expect(resolveHistoryWindow(forbidPrefix([...updated, ...history(2, 'new-')], 960), 40, initial)).toEqual(initial)
  })

  it('finds the existing ID after prepend or prefix removal', () => {
    const messages = history(100)
    const initial = resolveHistoryWindow(messages, 40, null)
    const prepended = [...history(20, 'older-'), ...messages]
    const moved = resolveHistoryWindow(prepended, 40, initial)
    expect(moved).toEqual({ firstId: '60', start: 80, count: 40 })
    expect(resolveHistoryWindow(prepended.slice(5), 40, moved)).toEqual({ firstId: '60', start: 75, count: 40 })
  })

  it('falls back to the recent window when the anchor disappears or the snapshot is replaced', () => {
    const messages = history(100)
    const initial = resolveHistoryWindow(messages, 40, null)
    expect(resolveHistoryWindow(messages.filter(message => message.id !== '60'), 40, initial)).toEqual({ firstId: '59', start: 59, count: 40 })
    expect(resolveHistoryWindow(history(70, 'replacement-'), 40, initial)).toEqual({ firstId: 'replacement-30', start: 30, count: 40 })
    const empty = resolveHistoryWindow([], 40, initial)
    expect(empty).toEqual({ firstId: null, start: 0, count: 40 })
    expect(resolveHistoryWindow(messages, 40, empty)).toEqual(initial)
    // A keyed session remount supplies no previous window, even with reused IDs.
    expect(resolveHistoryWindow(messages, 40, null)).toEqual(initial)
  })

  it('keeps run-boundary widening when earlier-history access increases the count', () => {
    const messages = history(8).map((message, index) => ({ ...message, runId: `run-${Math.floor(index / 2)}` }))
    const initial = resolveHistoryWindow(messages, 3, null)
    expect(initial).toEqual({ firstId: '4', start: 4, count: 3 })
    const earlier = resolveHistoryWindow(messages, 5, initial)
    expect(earlier).toEqual({ firstId: '2', start: 2, count: 5 })
    expect(resolveHistoryWindow([...messages, ...history(2, 'new-')], 5, earlier)).toEqual(earlier)
  })
})
