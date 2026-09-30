import { ArrowUp, Bell, ClipboardList, FileText, Lightbulb, LoaderCircle, Send } from 'lucide-react'
import { useCallback, useLayoutEffect } from 'react'
import type { FormEvent, RefObject } from 'react'
import type { AgentView } from '../lib/agent'
import { shouldSubmitComposer } from '../lib/chat-interaction'
import { composerAvailability } from '../lib/conversation-presentation'

export interface ComposerSelection {
  value: string
  start: number
  end: number
  direction: 'forward' | 'backward' | 'none'
}

interface ChatComposerProps {
  draft: string
  expanded: boolean
  visible: boolean
  streaming: boolean
  status: AgentView | null
  companion?: boolean
  connectionNotice?: { text: string; action: boolean }
  showQuickPrompts?: boolean
  showAvailability?: boolean
  inputRef: RefObject<HTMLTextAreaElement | null>
  selectionRef: RefObject<ComposerSelection | null>
  compositionRef: RefObject<boolean>
  compositionEndedAtRef: RefObject<number>
  onDraftChange: (value: string) => void
  onSubmit: (event: FormEvent) => void
  onOpenSettings: () => void
  onQuickPrompt: (prompt: string) => void
}

export function ChatComposer({ draft, expanded, visible, streaming, status, companion = false, connectionNotice, showQuickPrompts = !expanded, showAvailability = true, inputRef, selectionRef, compositionRef, compositionEndedAtRef, onDraftChange, onSubmit, onOpenSettings, onQuickPrompt }: ChatComposerProps) {
  const availability = composerAvailability(status, streaming)
  const showHint = (showAvailability && Boolean(availability.reason)) || (expanded && !availability.reason)
  const sendDisabled = streaming || !draft.trim() || !status?.configured || status.connection !== 'connected' || !status.model_configured
  const ready = status?.configured && status.connection === 'connected' && status.model_configured
  const notice = showAvailability ? connectionNotice ?? (!ready ? { text: availability.reason, action: availability.action } : undefined) : undefined
  const inputDescription = companion
    ? `${notice ? 'composer-connection ' : ''}composer-hint`
    : showHint ? 'composer-hint' : undefined

  function bindInput(input: HTMLTextAreaElement | null) {
    const previous = inputRef.current
    if (!input && previous) {
      selectionRef.current = {
        value: previous.value,
        start: previous.selectionStart,
        end: previous.selectionEnd,
        direction: previous.selectionDirection,
      }
    }
    inputRef.current = input
    if (!input) return
    const selection = selectionRef.current
    selectionRef.current = null
    if (selection?.value === input.value)
      input.setSelectionRange(selection.start, selection.end, selection.direction)
  }

  // Secondary pages unmount the composer. Capture its last DOM selection at
  // detach, then restore it once on remount only for the unchanged draft.
  const attachInput = useCallback(bindInput, [inputRef, selectionRef])

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input || !visible) return
    function resize() {
      if (!input) return
      input.style.height = 'auto'
      const max = Number.parseFloat(getComputedStyle(input).maxHeight)
      input.style.height = `${Math.min(input.scrollHeight, max)}px`
    }
    resize()
    let lastWidth = input.clientWidth
    const observer = new ResizeObserver(() => {
      if (input.clientWidth === lastWidth) return
      lastWidth = input.clientWidth
      resize()
    })
    observer.observe(input)
    return () => observer.disconnect()
  }, [draft, expanded, visible, inputRef])

  return <>
    <form className="composer" onSubmit={onSubmit}>
      <label className="sr-only" htmlFor="chat-input">发送给橘伴</label>
      {companion && notice && <div className="composer-connection">
        <p id="composer-connection">{notice.text}</p>
        {notice.action && <button type="button" onClick={onOpenSettings}>连接设置</button>}
      </div>}
      <div className="composer-row">
        <textarea
          ref={attachInput}
          id="chat-input"
          aria-describedby={inputDescription}
          value={draft}
          rows={1}
          placeholder={streaming ? '先写下下一条…' : ready ? '写下想聊的事…' : '先写下来，连接后发送…'}
          onChange={event => onDraftChange(event.target.value)}
          onCompositionStart={() => { compositionRef.current = true }}
          onCompositionEnd={event => { compositionRef.current = false; compositionEndedAtRef.current = event.timeStamp }}
          onKeyDown={event => {
            if (shouldSubmitComposer({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode, compositionActive: compositionRef.current, timeStamp: event.timeStamp, compositionEndedAt: compositionEndedAtRef.current })) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
        />
        {companion ? <div className="composer-actions">
          <span className="composer-shortcut" id="composer-hint">{streaming ? '正在回复，可先写下一条' : ready ? 'Enter 发送 · Shift + Enter 换行' : '可先写下想聊的事 · Shift + Enter 换行'}</span>
          <button className="send-button" type="submit" aria-label={streaming ? '正在回复' : '发送消息'} title={streaming ? '正在回复' : '发送消息'} aria-describedby={notice ? 'composer-connection' : undefined} disabled={sendDisabled}>
            {streaming ? <LoaderCircle className="spinner" aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
          </button>
        </div> : <button className="send-button" type="submit" aria-label={streaming ? '正在回复' : '发送消息'} title={availability.reason || '发送消息'} disabled={sendDisabled}>
          {streaming ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Send className="send-plane" aria-hidden="true" />}
        </button>}
      </div>
      {!companion && showHint && <div className="composer-hint" id="composer-hint"><span>{availability.reason || 'Enter 发送 · Shift + Enter 换行'}</span>{availability.action && <button type="button" onClick={onOpenSettings}>连接设置</button>}</div>}
    </form>
    {showQuickPrompts && <ChatQuickPrompts onQuickPrompt={onQuickPrompt} />}
  </>
}

export function ChatQuickPrompts({ onQuickPrompt, compact = false }: { onQuickPrompt: (prompt: string) => void; compact?: boolean }) {
  return <div className="quick-prompts" aria-label="快捷提问">
      <button type="button" onClick={() => onQuickPrompt('帮我记件事：')}><ClipboardList aria-hidden="true" />帮我记件事</button>
      {!compact && <button type="button" onClick={() => onQuickPrompt('提醒我别忘：')}><Bell aria-hidden="true" />提醒我别忘</button>}
      <button type="button" onClick={() => onQuickPrompt('陪我理理思路：')}><Lightbulb aria-hidden="true" />陪我理理思路</button>
      {!compact && <button type="button" onClick={() => onQuickPrompt('帮我整理文档：')}><FileText aria-hidden="true" />帮我整理文档</button>}
  </div>
}
