import { markMotionDiagnostic } from './lib/motion-diagnostics'
import { getFrameVisualBounds } from './components/useFrameMorph'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { emit, emitTo, listen } from '@tauri-apps/api/event'
import { Menu } from '@tauri-apps/api/menu'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { ChatPanel, type UiMessage } from './components/ChatPanel'
import { PetStage } from './components/PetStage'
import { type AgentView, getAgentView, submitAgentRun } from './lib/agent'
import type { PetState } from './lib/pet-state'
import { usePetGroupDrag } from './lib/usePetGroupDrag'
import { getPetLiveStatus } from './lib/pet-live-status'

type ChatMode = 'closed' | 'compact' | 'expanded'

function waitForWindowPaint() {
  // RAF provides a paint opportunity, not acknowledgement from AppKit.
  return new Promise<void>(resolve => {
    let first = 0
    let second = 0
    const finish = () => {
      window.clearTimeout(timeout)
      window.cancelAnimationFrame(first)
      window.cancelAnimationFrame(second)
      resolve()
    }
    const timeout = window.setTimeout(finish, 120)
    first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(finish)
    })
  })
}

/** Observe WKWebView's CSS viewport, independently of the native command reply. */
function waitForPanelViewport(mode: 'compact' | 'expanded', fixedBacking = true) {
  // Both views share one stable native backing; only the inner scene changes.
  const [width, height] = fixedBacking || mode === 'expanded' ? [940, 760] : [713, 401]
  return new Promise<boolean>(resolve => {
    const matches = () => Math.abs(window.innerWidth - width) <= 1 && Math.abs(window.innerHeight - height) <= 1
    const finish = (ready: boolean) => {
      window.clearTimeout(timeout)
      window.removeEventListener('resize', resized)
      resolve(ready)
    }
    const resized = () => { if (matches()) finish(true) }
    const timeout = window.setTimeout(() => finish(matches()), 600)
    window.addEventListener('resize', resized)
    resized()
  })
}

function App() {
  const currentWindow = getCurrentWindow()
  const isChatWindow = currentWindow.label === 'chat'
  const stableChatBacking = navigator.platform.toLowerCase().includes('mac')
  const [status, setStatus] = useState<AgentView | null>(null)
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [acceptedRequestId, setAcceptedRequestId] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [panelError, setPanelError] = useState<string | null>(null)
  const [chatMode, setChatMode] = useState<ChatMode>('closed')
  const [modeTransitioning, setModeTransitioning] = useState(false)
  const [panelEntering, setPanelEntering] = useState(false)
  const [panelPreparing, setPanelPreparing] = useState(false)
  const [petState, setPetState] = useState<PetState>('idle')
  const [petReply, setPetReply] = useState<string | null>(null)
  const chatModeRef = useRef<ChatMode>('closed')
  const modeTransitionRef = useRef(false)
  const remoteRequestsRef = useRef(0)
  const pendingCommitRef = useRef<(() => void) | undefined>(undefined)
  const pendingModeRef = useRef<ChatMode | null>(null)
  const modeWaitersRef = useRef<Array<{ resolve: () => void; reject: (cause: unknown) => void }>>([])
  const contextMenuPromiseRef = useRef<Promise<Menu> | null>(null)
  const viewRef = useRef<AgentView | null>(null)
  const submittingRef = useRef(false)
  const pendingRef = useRef<{ id: string; text: string } | null>(null)
  const bubbleTimerRef = useRef<number | null>(null)
  const petStateRef = useRef<PetState>('idle')
  const stateTimerRef = useRef<number | null>(null)
  const shownRemindersRef = useRef<{ generation: number; occurrences: Set<string> }>({ generation: -1, occurrences: new Set() })
  const reminderRetryAfterRef = useRef(0)
  const [reminderRetry, setReminderRetry] = useState(0)
  const chatHostRef = useRef<HTMLElement>(null)
  const hitBoundsQueueRef = useRef<{ pending: { x: number; y: number; width: number; height: number } | null; running: Promise<void> | null }>({ pending: null, running: null })
  const headerDrag = usePetGroupDrag({
    canStart: target => isChatWindow && !modeTransitionRef.current && !!target.closest('[data-tauri-drag-region]') && !target.closest('button, input, textarea, a'),
    onError: () => setError('无法拖动桌宠，请重试。'),
  })

  useEffect(() => {
    let disposed = false
    const applyView = (view: AgentView) => {
      if (disposed) return
      const old = viewRef.current
      if (old && (view.generation < old.generation || (view.generation === old.generation && view.revision < old.revision))) return
      viewRef.current = view
      setStatus(view)
      const runs = view.snapshot.runs
      if (old && old.generation !== view.generation) {
        pendingRef.current = null
        setAcceptedRequestId(null)
      }
      if (pendingRef.current && runs.some(run => run.request_id === pendingRef.current?.id)) {
        setAcceptedRequestId(pendingRef.current.id)
        pendingRef.current = null
      }
      const busy = runs.some(run => run.status === 'queued' || run.status === 'running')
      setStreaming(busy || submittingRef.current)
      setMessages(view.snapshot.messages.map(message => ({
        id: message.id, role: message.role, content: message.content,
        createdAt: Date.parse(message.created_at), runId: message.run_id,
        pending: message.role === 'assistant' && runs.some(run => run.id === message.run_id && (run.status === 'queued' || run.status === 'running')),
      })))
      const failed = runs.at(-1)
      setError(view.error ?? failed?.error ?? view.node_error ?? null)
      const latest = [...view.snapshot.messages].reverse().find(message => message.role === 'assistant' && message.content)
      if (!isChatWindow && latest && old && view.snapshot.seq > old.snapshot.seq) {
        setPetReply(latest.content.slice(-140))
        if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current)
        bubbleTimerRef.current = window.setTimeout(() => setPetReply(null), 8000)
      }
      updatePetState(view.error ? 'error' : busy ? latest?.content ? 'talking' : 'thinking' : 'idle')
    }
    const refreshStatus = () => getAgentView().then(applyView).catch(() => {
      if (!disposed) setError('无法读取助手连接状态')
    })
    const unlistenFocus = currentWindow.onFocusChanged(({ payload: focused }) => {
      if (focused) void refreshStatus()
    })
    // Install listener before loading the cached projection; revision rejects stale IPC replies.
    const unlistenPromise = listen<AgentView>('agent:view', event => applyView(event.payload))
    void unlistenPromise.then(refreshStatus)

    const unlistenPetState = listen<PetState>('pet:state', event => {
      petStateRef.current = event.payload
      setPetState(event.payload)
    })

    let positionTimer: number | null = null
    const unlistenMoved = isChatWindow
      ? Promise.resolve(() => {})
      : currentWindow.onMoved(({ payload }) => {
          if (positionTimer)
            window.clearTimeout(positionTimer)
          positionTimer = window.setTimeout(() => {
            void invoke('save_pet_position', { position: { x: payload.x, y: payload.y } })
          }, 350)
        })

    return () => {
      disposed = true
      unlistenPromise.then(unlisten => unlisten())
      unlistenPetState.then(unlisten => unlisten())
      unlistenFocus.then(unlisten => unlisten())
      unlistenMoved.then(unlisten => unlisten())
      if (positionTimer)
        window.clearTimeout(positionTimer)
      if (bubbleTimerRef.current)
        window.clearTimeout(bubbleTimerRef.current)
      if (stateTimerRef.current)
        window.clearTimeout(stateTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const unlisten = isChatWindow
      ? listen<{ id: string; mode: ChatMode }>('pet-panel:request', event => {
          markMotionDiagnostic('route:chat-request-received')
          const { id, mode } = event.payload
          void changePetChatMode(mode).then(
            () => emitTo('main', 'pet-panel:reply', { id, mode: chatModeRef.current }),
            () => emitTo('main', 'pet-panel:reply', { id, error: '切换面板失败，请重试。' }),
          )
        })
      : listen<ChatMode>('pet-panel:committed', event => {
          chatModeRef.current = event.payload
          setChatMode(event.payload)
          if (event.payload === 'closed') suppressCurrentReminders()
        })
    return () => { void unlisten.then(stop => stop()) }
  }, [])

  async function requestChatMode(mode: ChatMode) {
    markMotionDiagnostic('route:request-enter', { mode })
    const id = crypto.randomUUID()
    markMotionDiagnostic('route:request-id-created')
    setPanelError(null)
    remoteRequestsRef.current += 1
    modeTransitionRef.current = true
    setModeTransitioning(true)
    let stop: (() => void) | undefined
    let timer: number | undefined
    try {
      await new Promise<void>((resolve, reject) => {
        void listen<{ id: string; mode?: ChatMode; error?: string }>('pet-panel:reply', event => {
          if (event.payload.id !== id) return
          markMotionDiagnostic('route:request-reply', { error: Boolean(event.payload.error) })
          if (event.payload.error) reject(new Error(event.payload.error))
          else {
            if (event.payload.mode) {
              chatModeRef.current = event.payload.mode
              setChatMode(event.payload.mode)
            }
            resolve()
          }
        }).then(unlisten => {
          stop = unlisten
          timer = window.setTimeout(() => reject(new Error('聊天窗口未响应，请重试。')), 5000)
          markMotionDiagnostic('route:request-emitting')
          return emitTo('chat', 'pet-panel:request', { id, mode })
        }).catch(reject)
      })
    } catch (cause) {
      setPanelError(cause instanceof Error ? cause.message : '聊天窗口未响应，请重试。')
      throw cause
    } finally {
      stop?.()
      if (timer !== undefined) window.clearTimeout(timer)
      remoteRequestsRef.current -= 1
      modeTransitionRef.current = remoteRequestsRef.current > 0
      setModeTransitioning(modeTransitionRef.current)
    }
  }

  function suppressCurrentReminders() {
    const current = viewRef.current
    if (current && shownRemindersRef.current.generation === current.generation)
      (current.reminders ?? []).forEach(item => shownRemindersRef.current.occurrences.add(`${item.id}:${item.remind_at}`))
  }

  useEffect(() => {
    if (isChatWindow)
      return

    let cancelled = false
    let idleTimer: number | null = null
    const scheduleIdleAction = () => {
      idleTimer = window.setTimeout(() => {
        if (cancelled)
          return
        if (petStateRef.current !== 'idle') {
          scheduleIdleAction()
          return
        }

        const nextState: PetState = Math.random() > 0.28 ? 'curious' : 'sleeping'
        updatePetState(nextState)
        const duration = nextState === 'sleeping' ? 3200 : 1800
        stateTimerRef.current = window.setTimeout(() => {
          if (petStateRef.current === nextState)
            updatePetState('idle')
          scheduleIdleAction()
        }, duration)
      }, 7000 + Math.random() * 9000)
    }
    scheduleIdleAction()

    return () => {
      cancelled = true
      if (idleTimer)
        window.clearTimeout(idleTimer)
    }
  }, [])

  useEffect(() => {
    // The main window routes reminders to the dedicated chat surface.
    if (isChatWindow || !status) return
    if (shownRemindersRef.current.generation !== status.generation) {
      shownRemindersRef.current = { generation: status.generation, occurrences: new Set() }
      reminderRetryAfterRef.current = 0
    }
    const seen = shownRemindersRef.current.occurrences
    const occurrences = (status.reminders ?? []).map(item => `${item.id}:${item.remind_at}`)
    if (modeTransitioning || !occurrences.some(key => !seen.has(key))) return
    if (chatMode === 'expanded') {
      occurrences.forEach(key => seen.add(key))
      return
    }
    // Defer past an existing resize; mark only after a successful expansion.
    const timer = window.setTimeout(() => {
      const current = viewRef.current
      if (current?.generation !== status.generation || modeTransitionRef.current) return
      // A close or a confirmed write can suppress/remove the occurrence while
      // a failed native opening is waiting to retry.
      if (!(current.reminders ?? []).some(item => !seen.has(`${item.id}:${item.remind_at}`))) return
      void changePetChatMode('expanded').then(() => {
        if (chatModeRef.current === 'expanded' && viewRef.current?.generation === status.generation)
          occurrences.forEach(key => seen.add(key))
      }).catch(() => {
        if (viewRef.current?.generation !== status.generation) return
        reminderRetryAfterRef.current = Date.now() + 15_000
        setError('未能展开提醒，请点击桌宠查看。')
        setReminderRetry(value => value + 1)
      })
    }, Math.max(0, reminderRetryAfterRef.current - Date.now()))
    return () => window.clearTimeout(timer)
  }, [status, chatMode, modeTransitioning, reminderRetry])

  useEffect(() => {
    if (!isChatWindow) return
    const frame = chatHostRef.current?.querySelector('.chat-panel')
    if (!frame) return
    const report = (bounds?: { x: number; y: number; width: number; height: number }) => {
      void publishChatHitBounds(bounds).catch(() => setError('无法更新面板交互区域，请重试。'))
    }
    const observer = new ResizeObserver(() => {
      if (!(frame instanceof HTMLElement) || frame.dataset.frameMorphing !== 'true') report()
    })
    const onMorphBounds = (event: Event) => report((event as CustomEvent<{ x: number; y: number; width: number; height: number }>).detail)
    frame.addEventListener('chat-frame-bounds', onMorphBounds)
    observer.observe(frame)
    return () => { observer.disconnect(); frame.removeEventListener('chat-frame-bounds', onMorphBounds) }
  }, [])

  async function publishChatHitBounds(knownBounds?: { x: number; y: number; width: number; height: number }) {
    const frame = chatHostRef.current?.querySelector<HTMLElement>('.chat-panel')
    const rect = knownBounds ?? (frame ? getFrameVisualBounds(frame) : undefined)
    if (!rect) return
    const queue = hitBoundsQueueRef.current
    queue.pending = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    if (queue.running) return queue.running
    queue.running = (async () => {
      let latestFailure: { cause: unknown } | null = null
      try {
        while (queue.pending) {
          const bounds = queue.pending
          queue.pending = null
          try {
            await invoke('set_chat_hit_bounds', { bounds })
            latestFailure = null
          } catch (cause) {
            // Geometry is replaceable state: a newer successful write repairs
            // an intermediate failure. Only the latest outcome controls the
            // caller's commit; never loop by re-enqueuing a failed payload.
            latestFailure = { cause }
          }
        }
        if (latestFailure) throw latestFailure.cause
      } finally { queue.running = null }
    })()
    return queue.running
  }

  async function changePetChatMode(mode: ChatMode, commitPage?: () => void) {
    markMotionDiagnostic('route:change-enter', { mode, chat: isChatWindow })
    if (!isChatWindow) return requestChatMode(mode)
    if (modeTransitionRef.current) {
      pendingModeRef.current = mode
      pendingCommitRef.current = commitPage
      return new Promise<void>((resolve, reject) => modeWaitersRef.current.push({ resolve, reject }))
    }
    if (chatModeRef.current === mode) {
      if (commitPage) flushSync(commitPage)
      return
    }

    modeTransitionRef.current = true
    const previousMode = chatModeRef.current
    let transitionCommitted = false
    try {
      // Open-to-open changes keep the mounted shell visible. Native sizing is
      // serialized; entrance motion belongs only to a closed-to-open change.
      flushSync(() => {
        setModeTransitioning(true)
        setPanelEntering(false)
      })

      if (mode === 'closed') {
        // Hide only the chat window; keep its component tree and drafts mounted.
        setPanelEntering(false)
        flushSync(() => {
          chatModeRef.current = mode
          setChatMode(mode)
        })
        await invoke('set_pet_chat_mode', { mode })
        await emitTo('main', 'pet-panel:committed', mode)
        flushSync(() => setModeTransitioning(false))
        transitionCommitted = true
        return
      }

      if (previousMode === 'closed') {
        markMotionDiagnostic('route:open-prepare')
        flushSync(() => setPanelPreparing(true))
        // Mount the panel into the compact surface and paint it once while
        // the native window is still small — the panel sits off-frame and
        // stays invisible. Resize next, observe the CSS viewport, then reveal.
        // These steps prepare layout; only native capture can establish when
        // AppKit actually presents the new backing frame.
        flushSync(() => {
          chatModeRef.current = mode
          setChatMode(mode)
        })
        markMotionDiagnostic('route:wait-paint-start')
        await waitForWindowPaint()
        markMotionDiagnostic('route:native-mode-start')
        await invoke('set_pet_chat_mode', { mode })
        markMotionDiagnostic('route:native-mode-end', { width: window.innerWidth, height: window.innerHeight })
        markMotionDiagnostic('route:viewport-start')
        if (!await waitForPanelViewport(mode, stableChatBacking)) {
          markMotionDiagnostic('route:viewport-failed', { width: window.innerWidth, height: window.innerHeight })
          // A timer expiry is not readiness. Restore the native closed frame
          // before the existing failure path restores React's previous mode.
          await invoke('set_pet_chat_mode', { mode: 'closed' })
          throw new Error('桌宠窗口未在限定时间内完成尺寸更新')
        }
        markMotionDiagnostic('route:viewport-ready')
        await waitForWindowPaint()
        markMotionDiagnostic('route:hit-bounds-start')
        await publishChatHitBounds()
        markMotionDiagnostic('route:show-start')
        await invoke('show_chat_window')
        markMotionDiagnostic('route:show-end')
        // The main cat backing never resizes. Start the shell reveal only after
        // its independent native chat window has been shown.
        flushSync(() => {
          setModeTransitioning(false)
          setPanelPreparing(false)
          setPanelEntering(true)
          commitPage?.()
        })
        await emitTo('main', 'pet-panel:committed', mode)
        transitionCommitted = true
        return
      }

      // macOS keeps one backing; other platforms retain their bounded window.
      if (!stableChatBacking) await invoke('set_pet_chat_mode', { mode })
      // Open-to-open commits as ordinary async React state. A flushSync here
      // blocks the main thread for the whole destination render (measured
      // 72-98ms in a light repro; a real markdown message list is heavier),
      // freezing the old frame that the morph ghost is supposed to cover.
      // The ref stays synchronous so mode guards see the intent immediately.
      chatModeRef.current = mode
      setChatMode(mode)
      commitPage?.()
      setModeTransitioning(false)
      // Page and mode are already one committed UI state. A hit-region write
      // failure must report an error without rolling back only the mode.
      transitionCommitted = true
      // Publish interactive bounds and the commit acknowledgement only after
      // the destination has painted, so they reflect committed geometry.
      markMotionDiagnostic('route:morph-wait-paint')
      await waitForWindowPaint()
      markMotionDiagnostic('route:morph-hit-bounds')
      await publishChatHitBounds()
      await emitTo('main', 'pet-panel:committed', mode)
    }
    catch (cause) {
      markMotionDiagnostic('route:change-error', { kind: cause instanceof Error ? cause.name : 'unknown' })
      setError('切换面板失败，请重试。')
      throw cause
    }
    finally {
      if (!transitionCommitted)
        flushSync(() => {
          // A closed panel is pre-mounted before native resize. Restore that
          // provisional mode on failure so reminders remain eligible to retry.
          chatModeRef.current = previousMode
          setChatMode(previousMode)
          setModeTransitioning(false)
        })
      setPanelPreparing(false)
      modeTransitionRef.current = false
      const pending = pendingModeRef.current
      const pendingCommit = pendingCommitRef.current
      pendingCommitRef.current = undefined
      const waiters = modeWaitersRef.current.splice(0)
      pendingModeRef.current = null
      try {
        if (pending) await changePetChatMode(pending, pendingCommit)
        waiters.forEach(waiter => waiter.resolve())
      } catch (cause) {
        waiters.forEach(waiter => waiter.reject(cause))
        markMotionDiagnostic('route:change-error', { kind: cause instanceof Error ? cause.name : 'unknown' })
        setError('切换面板失败，请重试。')
      }
    }
  }

  async function openChatWindow() {
    await changePetChatMode(chatModeRef.current === 'closed' ? 'compact' : chatModeRef.current)
  }

  async function changeChatExpanded(expanded: boolean, commitPage?: () => void) {
    await changePetChatMode(expanded ? 'expanded' : 'compact', commitPage)
  }

  async function closeChatWindow() {
    suppressCurrentReminders()
    await changePetChatMode('closed')
  }

  async function openPetContextMenu() {
    if (isChatWindow || !isTauri())
      return

    if (!contextMenuPromiseRef.current) {
      const menuPromise = Menu.new({
        items: [
          {
            id: 'reset-position',
            text: '重置位置',
            action: () => {
              void invoke('reset_pet_position').catch(cause => {
                console.error('重置桌宠位置失败', cause)
              })
            },
          },
          {
            id: 'quit-app',
            text: '退出橘伴',
            action: () => {
              void invoke('quit_app').catch(cause => {
                console.error('退出橘伴失败', cause)
              })
            },
          },
        ],
      })
      contextMenuPromiseRef.current = menuPromise
    }

    try {
      const menu = await contextMenuPromiseRef.current
      await menu.popup(undefined, currentWindow)
    }
    catch (cause) {
      contextMenuPromiseRef.current = null
      console.error('打开桌宠右键菜单失败', cause)
    }
  }

  function updatePetState(nextState: PetState) {
    petStateRef.current = nextState
    setPetState(nextState)
    void emit('pet:state', nextState)
  }

  function handlePetInteract() {
    if (petStateRef.current === 'thinking' || petStateRef.current === 'talking')
      return
    if (stateTimerRef.current)
      window.clearTimeout(stateTimerRef.current)
    updatePetState('happy')
    stateTimerRef.current = window.setTimeout(() => {
      updatePetState('idle')
    }, 700)
  }

  function handleSend(content: string) {
    // A retry of an unacknowledged send keeps its request ID. Snapshot recovery
    // clears it only after the server confirms durable acceptance.
    const pending = pendingRef.current?.text === content
      ? pendingRef.current : { id: crypto.randomUUID(), text: content }
    pendingRef.current = pending
    submittingRef.current = true
    setError(null)
    setStreaming(true)
    updatePetState('thinking')
    setAcceptedRequestId(null)
    const accepted = (async () => {
      try {
        await submitAgentRun(pending.id, content)
      }
      catch (cause) {
        setStreaming(false)
        updatePetState('error')
        setError(cause instanceof Error ? cause.message : String(cause))
        throw cause
      }
      finally {
        submittingRef.current = false
        setStreaming(viewRef.current?.snapshot.runs.some(run => run.status === 'queued' || run.status === 'running') ?? false)
      }
    })()
    return { requestId: pending.id, accepted }
  }

  if (isChatWindow) {
    return (
      <main ref={chatHostRef} className={`desktop-pet-app pet-shell pet-chat-scene pet-chat-${chatMode === 'expanded' ? 'expanded' : 'compact'}`}
        {...headerDrag}>
        <ChatPanel
          attached
          expanded={chatMode === 'expanded'}
          visible={chatMode !== 'closed' && !panelPreparing}
          animateEntrance={panelEntering}
          status={status}
          messages={messages}
          tools={status?.snapshot.tool_calls ?? []}
          streaming={streaming}
          error={error}
          onClose={() => void closeChatWindow().catch(() => {})}
          onExpandedChange={changeChatExpanded}
          acceptedRequestId={acceptedRequestId}
          onSend={handleSend}
        />
      </main>
    )
  }

  return (
    <main className={`desktop-pet-app pet-shell pet-chat-closed${chatMode !== 'closed' ? ' pet-panel-visible' : ''}`}>
      <PetStage
        petState={petState}
        liveStatus={panelError ? { title: '打开失败', detail: '点击重试', tone: 'error', accessibleLabel: panelError } : getPetLiveStatus(status, petState)}
        reply={petReply}
        // Every window mode shares the approved reference cat. Expanding the
        // settings panel must change only the panel, never the pet artwork.
        mode="reference-closed"
        onPetInteract={handlePetInteract}
        onToggleChat={() => void openChatWindow().catch(cause => markMotionDiagnostic('route:open-error', { kind: cause instanceof Error ? cause.name : 'unknown' }))}
        onContextMenu={() => void openPetContextMenu()}
      />
    </main>
  )
}

export default App
