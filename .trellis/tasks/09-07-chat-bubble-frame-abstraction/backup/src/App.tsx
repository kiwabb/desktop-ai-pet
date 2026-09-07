import { invoke, isTauri } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { Menu } from '@tauri-apps/api/menu'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { ChatPanel, type UiMessage } from './components/ChatPanel'
import { PetStage } from './components/PetStage'
import { type AiStatus, type AiStreamEvent, getAiStatus, streamChat } from './lib/ai'
import type { PetState } from './lib/pet-state'

const SYSTEM_MESSAGE = {
  role: 'system' as const,
  content: '你是桌面小助手“橘伴”。回答自然、简洁、友善。先解决用户的问题，不要假装执行没有执行的操作。',
}

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
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [messages, setMessages] = useState<UiMessage[]>([])
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
  const activeRequestRef = useRef<string | null>(null)
  const bubbleRequestRef = useRef<string | null>(null)
  const bubbleTimerRef = useRef<number | null>(null)
  const petStateRef = useRef<PetState>('idle')
  const stateTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const refreshStatus = () => getAiStatus().then(setStatus).catch(() => {
      setStatus({ configured: false, model: null, endpoint: null, source: null })
    })

    const unlistenFocus = currentWindow.onFocusChanged(({ payload: focused }) => {
      if (focused)
        void refreshStatus()
    })

    const unlistenPromise = listen<AiStreamEvent>('ai:stream', event => {
      const payload = event.payload

      if (!isChatWindow) {
        if (payload.kind === 'chunk') {
          if (bubbleRequestRef.current !== payload.requestId) {
            bubbleRequestRef.current = payload.requestId
            setPetReply(payload.content)
          }
          else {
            setPetReply(current => `${current ?? ''}${payload.content}`.slice(-140))
          }
        }
        if (payload.kind === 'done' && bubbleRequestRef.current === payload.requestId) {
          bubbleRequestRef.current = null
          if (bubbleTimerRef.current)
            window.clearTimeout(bubbleTimerRef.current)
          bubbleTimerRef.current = window.setTimeout(() => setPetReply(null), 8000)
        }
      }

      if (payload.requestId !== activeRequestRef.current)
        return

      if (payload.kind === 'chunk') {
        updatePetState('talking')
        setMessages(current => current.map(message => (
          message.id === payload.requestId
            ? { ...message, content: message.content + payload.content, pending: false }
            : message
        )))
      }

      if (payload.kind === 'done') {
        activeRequestRef.current = null
        setStreaming(false)
        updatePetState('happy')
        window.setTimeout(() => updatePetState('idle'), 900)
      }
    })

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
        flushSync(() => setModeTransitioning(false))
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

  async function handleSend(content: string) {
    const requestId = crypto.randomUUID()
    const createdAt = Date.now()
    const userMessage: UiMessage = { id: crypto.randomUUID(), role: 'user', content, createdAt }
    const assistantMessage: UiMessage = { id: requestId, role: 'assistant', content: '', pending: true, createdAt }
    const history = messages
      .filter(message => message.content)
      .map(({ role, content }) => ({ role, content }))

    activeRequestRef.current = requestId
    setError(null)
    setStreaming(true)
    updatePetState('thinking')
    setMessages(current => [...current, userMessage, assistantMessage])

    try {
      await streamChat({
        requestId,
        messages: [SYSTEM_MESSAGE, ...history, { role: 'user', content }],
      })
    }
    catch (cause) {
      activeRequestRef.current = null
      setStreaming(false)
      updatePetState('error')
      setMessages(current => current.filter(message => message.id !== requestId))
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  if (isChatWindow) {
    return (
      <main className={`desktop-pet-app chat-window-app ${chatExpanded ? 'chat-expanded' : 'chat-compact'}`}>
        <ChatPanel
          expanded={chatExpanded}
          status={status}
          messages={messages}
          streaming={streaming}
          error={error}
          onStatusChange={setStatus}
          onClose={() => void closeChatWindow()}
          onExpandedChange={expanded => void changeChatExpanded(expanded)}
          onSend={handleSend}
        />
      </main>
    )
  }

  return (
    <main className={`desktop-pet-app pet-shell pet-chat-${chatMode}${modeTransitioning ? ' pet-chat-resizing' : ''}${panelEntering ? ' pet-chat-animate-in' : ''}`}>
      {chatMode !== 'closed' && (
        <>
          <ChatPanel
            attached
            expanded={chatMode === 'expanded'}
            entering={panelEntering}
            status={status}
            messages={messages}
            streaming={streaming}
            error={error}
            onStatusChange={setStatus}
            onClose={() => void closeChatWindow()}
            onExpandedChange={expanded => void changeChatExpanded(expanded)}
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
