import { invoke, isTauri } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { Menu } from '@tauri-apps/api/menu'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { ChatPanel, type UiMessage } from './components/ChatPanel'
import { PetStage } from './components/PetStage'
import { type AgentView, getAgentView, submitAgentRun } from './lib/agent'
import type { PetState } from './lib/pet-state'

type ChatMode = 'closed' | 'compact' | 'expanded'

function waitForWindowPaint() {
  return new Promise<void>(resolve => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => window.setTimeout(resolve, 0))
    })
  })
}

function App() {
  const currentWindow = getCurrentWindow()
  const isChatWindow = currentWindow.label === 'chat'
  const [status, setStatus] = useState<AgentView | null>(null)
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [acceptedRequestId, setAcceptedRequestId] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chatExpanded, setChatExpanded] = useState(false)
  const [chatMode, setChatMode] = useState<ChatMode>('closed')
  const [modeTransitioning, setModeTransitioning] = useState(false)
  const [panelEntering, setPanelEntering] = useState(false)
  const [petState, setPetState] = useState<PetState>('idle')
  const [petReply, setPetReply] = useState<string | null>(null)
  const chatModeRef = useRef<ChatMode>('closed')
  const modeTransitionRef = useRef(false)
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
    if (!isChatWindow)
      return
    const unlistenMode = listen<boolean>('chat:mode', event => setChatExpanded(event.payload))
    return () => {
      unlistenMode.then(unlisten => unlisten())
    }
  }, [])

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
    // Only the main pet window expands. The hidden standalone chat stays hidden.
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

  async function changePetChatMode(mode: ChatMode) {
    if (modeTransitionRef.current || chatModeRef.current === mode)
      return

    modeTransitionRef.current = true
    const previousMode = chatModeRef.current
    let transitionCommitted = false
    try {
      // Keep the current cat layer visible and anchored while AppKit changes
      // the native panel size. The final mode and the panel are committed
      // together after the resize, so no intermediate stretched/blank frame
      // can leak to the desktop.
      flushSync(() => setModeTransitioning(true))

      if (mode === 'closed') {
        // Shrink the native surface only after the shared cat layer is ready;
        // the panel disappears while the cat remains visually fixed.
        setPanelEntering(false)
        flushSync(() => {
          chatModeRef.current = mode
          setChatMode(mode)
        })
        await invoke('set_pet_chat_mode', { mode })
        // Keep the resize guard through the first WKWebView paint at the new
        // native size. Releasing it as soon as the command returns exposes a
        // stale backing frame and reads as a white/transparent flash.
        await waitForWindowPaint()
        flushSync(() => setModeTransitioning(false))
        transitionCommitted = true
        return
      }

      if (previousMode === 'closed') {
        // Mount the panel into the compact surface and paint it once while
        // the native window is still small — the panel sits off-frame and
        // stays invisible. Only then do AppKit and React commit the resize
        // together: the panel appears with a fully laid-out first frame and
        // no flash of an unstyled intermediate surface.
        flushSync(() => {
          chatModeRef.current = mode
          setChatMode(mode)
        })
        await new Promise<void>(resolve =>
          requestAnimationFrame(() => setTimeout(resolve, 0))
        )
        await invoke('set_pet_chat_mode', { mode })
        await waitForWindowPaint()
        // Reveal the final layout and start its entrance in the same commit;
        // there is no intermediate frame with an empty expanded surface.
        flushSync(() => {
          setModeTransitioning(false)
          setPanelEntering(true)
        })
        transitionCommitted = true
        return
      }

      await invoke('set_pet_chat_mode', { mode })
      await waitForWindowPaint()
      flushSync(() => {
        chatModeRef.current = mode
        setChatMode(mode)
        setModeTransitioning(false)
      })
      transitionCommitted = true
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
      modeTransitionRef.current = false
    }
  }

  async function openChatWindow() {
    if (isChatWindow) {
      await emit('chat:mode', false)
      await invoke('show_chat_window')
      return
    }
    await changePetChatMode('compact')
  }

  async function changeChatExpanded(expanded: boolean) {
    setChatExpanded(expanded)
    if (!isChatWindow) {
      await changePetChatMode(expanded ? 'expanded' : 'compact')
      return
    }
    await invoke('set_chat_window_expanded', { expanded })
  }

  async function closeChatWindow() {
    // Closing suppresses this occurrence for this process, even if it remains due.
    const current = viewRef.current
    if (current && shownRemindersRef.current.generation === current.generation)
      (current.reminders ?? []).forEach(item => shownRemindersRef.current.occurrences.add(`${item.id}:${item.remind_at}`))
    if (isChatWindow) {
      await currentWindow.hide()
      return
    }
    setChatExpanded(false)
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
      <main className={`desktop-pet-app chat-window-app ${chatExpanded ? 'chat-expanded' : 'chat-compact'}`}>
        <ChatPanel
          expanded={chatExpanded}
          status={status}
          messages={messages}
          tools={status?.snapshot.tool_calls ?? []}
          streaming={streaming}
          error={error}
          onClose={() => void closeChatWindow()}
          onExpandedChange={expanded => void changeChatExpanded(expanded)}
          acceptedRequestId={acceptedRequestId}
          onSend={handleSend}
        />
      </main>
    )
  }

  return (
    <main className={`desktop-pet-app pet-shell pet-chat-${chatMode}${modeTransitioning ? ' pet-chat-resizing' : ''}`}>
      {chatMode !== 'closed' && (
        <>
          <ChatPanel
            attached
            expanded={chatMode === 'expanded'}
            visible={!modeTransitioning}
            animateEntrance={panelEntering}
            status={status}
            messages={messages}
            tools={status?.snapshot.tool_calls ?? []}
            streaming={streaming}
            error={error}
            onClose={() => void closeChatWindow()}
            onExpandedChange={expanded => void changeChatExpanded(expanded)}
            acceptedRequestId={acceptedRequestId}
            onSend={handleSend}
          />
        </>
      )}
      <PetStage
        petState={petState}
        reply={petReply}
        // Every window mode shares the approved reference cat. Expanding the
        // settings panel must change only the panel, never the pet artwork.
        mode="reference-closed"
        onPetInteract={handlePetInteract}
        onToggleChat={() => void openChatWindow()}
        onContextMenu={() => void openPetContextMenu()}
      />
    </main>
  )
}

export default App
