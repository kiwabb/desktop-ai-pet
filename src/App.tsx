import { markMotionDiagnostic } from './lib/motion-diagnostics'
import { getFrameVisualBounds } from './components/useFrameMorph'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { emit, emitTo, listen } from '@tauri-apps/api/event'
import { Menu } from '@tauri-apps/api/menu'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { flushSync } from 'react-dom'

import { ChatPanel, type UiMessage } from './components/ChatPanel'
import { PetStage } from './components/PetStage'
import { type AgentView, getAgentView, submitAgentRun } from './lib/agent'
import type { PetState } from './lib/pet-state'
import { usePetGroupDrag } from './lib/usePetGroupDrag'
import { createCompanionBehavior } from './lib/companion-behavior'
import { COMPANION_SIZES, DEFAULT_COMPANION_PREFERENCES, parsePanelViewport } from './lib/companion-preferences'
import type { CompanionPreferences, PanelViewport } from './lib/companion-preferences'
import { resolveCompanionAttachment } from './lib/companion-attachment'
import { projectConversationMessages } from './lib/conversation-presentation'
import { getAgentPetState } from './lib/pet-state'
import { CustomizationProvider, useCustomization } from './lib/useCustomization'
import './desktop-shell.css'

type ChatMode = 'closed' | 'compact' | 'expanded'

/** Due occurrences from every reminder source, prefixed so a todo reminder and
 * a memo review never share a key and each surfaces its own card. */
function reminderOccurrences(view: AgentView): string[] {
  return [
    ...(view.reminders ?? []).map(item => `todo:${item.id}:${item.remind_at}`),
    ...(view.memo_reviews ?? []).map(item => `memo:${item.id}:${item.review_at}`),
  ]
}

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
function waitForPanelViewport(viewport: { width: number; height: number }, latestViewport?: () => PanelViewport | null) {
  return new Promise<boolean>(resolve => {
    const matches = () => {
      const { width, height } = latestViewport?.() ?? viewport
      return Math.abs(window.innerWidth - width) <= 1 && Math.abs(window.innerHeight - height) <= 1
    }
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
  const customization = useCustomization()
  const [customizationRequest, setCustomizationRequest] = useState(0)
  const currentWindow = isTauri() ? getCurrentWindow() : null
  const isChatWindow = currentWindow?.label === 'chat'
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
  const [panelFocusRequest, setPanelFocusRequest] = useState(0)
  const [petState, setPetState] = useState<PetState>('idle')
  const [preferences, setPreferences] = useState(DEFAULT_COMPANION_PREFERENCES)
  const preferencesRef = useRef(preferences)
  const preferenceSavingRef = useRef(false)
  const [browserHidden, setBrowserHidden] = useState(false)
  const [browserMenuOpen, setBrowserMenuOpen] = useState(false)
  const [panelViewport, setPanelViewport] = useState<PanelViewport | null>(null)
  const panelViewportRef = useRef<{ revision: number; viewport: PanelViewport | null }>({ revision: 0, viewport: null })
  const hiddenRef = useRef(false)
  const visibilityEpochRef = useRef(0)
  const behaviorRef = useRef<ReturnType<typeof createCompanionBehavior> | null>(null)
  const chatModeRef = useRef<ChatMode>('closed')
  const modeTransitionRef = useRef(false)
  const remoteRequestsRef = useRef(0)
  const pendingCommitRef = useRef<(() => void) | undefined>(undefined)
  const pendingModeRef = useRef<ChatMode | null>(null)
  const modeWaitersRef = useRef<Array<{ resolve: () => void; reject: (cause: unknown) => void }>>([])
  const contextMenuBusyRef = useRef(false)
  const contextMenuMountedRef = useRef(true)
  const viewRef = useRef<AgentView | null>(null)
  const submittingRef = useRef(false)
  const pendingRef = useRef<{ id: string; text: string } | null>(null)
  const petStateRef = useRef<PetState>('idle')
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
    if (!isChatWindow) return
    let disposed = false
    const subscribed = listen('customization:open', () => { if (!disposed) setCustomizationRequest(value => value + 1) })
    return () => { disposed = true; void subscribed.then(unlisten => unlisten()) }
  }, [isChatWindow])

  useEffect(() => {
    if (!currentWindow) return
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
      if (isChatWindow) setMessages(previous => projectConversationMessages(view.snapshot.messages, runs, previous))
      setError(view.error ?? view.node_error ?? null)
      // Main owns autonomous reactions; chat emits only direct send feedback.
      // Historical assistant text must never mark a new run as already talking.
      if (!isChatWindow) {
        behaviorRef.current?.setActivity(getAgentPetState(view))
      }
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
      if (!isChatWindow) behaviorRef.current?.setActivity(event.payload)
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
    }
  }, [])

  useEffect(() => {
    if (!isTauri()) return
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
          if (hiddenRef.current && event.payload !== 'closed') return
          const previous = chatModeRef.current
          chatModeRef.current = event.payload
          setChatMode(event.payload)
          if (event.payload === 'closed') suppressCurrentReminders()
          if (previous !== event.payload && event.payload !== 'closed') behaviorRef.current?.wake()
        })
    return () => { void unlisten.then(stop => stop()) }
  }, [])

  useEffect(() => {
    contextMenuMountedRef.current = true
    return () => { contextMenuMountedRef.current = false }
  }, [])

  useEffect(() => {
    if (!browserMenuOpen) return
    const menu = document.querySelector<HTMLElement>('.companion-browser-menu')
    menu?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    return () => document.querySelector<HTMLButtonElement>('.companion-menu-button')?.focus({ preventScroll: true })
  }, [browserMenuOpen])

  async function requestChatMode(mode: ChatMode) {
    if (hiddenRef.current) throw new Error('桌宠已隐藏')
    const visibilityEpoch = visibilityEpochRef.current
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
          if (visibilityEpoch !== visibilityEpochRef.current || hiddenRef.current) { reject(new Error('桌宠已隐藏')); return }
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
      reminderOccurrences(current).forEach(key => shownRemindersRef.current.occurrences.add(key))
  }

  useEffect(() => {
    if (isChatWindow) return
    const behavior = createCompanionBehavior(updatePetState, {
      setTimeout: (callback, delay) => window.setTimeout(callback, delay),
      clearTimeout: handle => window.clearTimeout(handle),
    })
    behaviorRef.current = behavior
    behavior.setActivity(getAgentPetState(viewRef.current))
    return () => { behavior.dispose(); behaviorRef.current = null }
  }, [])

  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    const applyPreferences = (next: CompanionPreferences) => {
      if (disposed) return
      preferencesRef.current = next
      setPreferences(next)
    }
    const unlisten = listen<CompanionPreferences>('companion:preferences-changed', event => applyPreferences(event.payload))
    void unlisten.then(() => invoke<CompanionPreferences>('get_companion_preferences')).then(applyPreferences).catch(() => {
      if (!disposed && !isChatWindow) setPanelError('无法读取桌宠偏好，请从菜单重试。')
    })
    const actionErrors = listen<string>('companion:error', event => {
      if (!disposed && !isChatWindow) setPanelError(event.payload.includes('偏好已保存')
        ? '偏好已保存，菜单栏状态未刷新，请重新选择一次。'
        : '桌宠操作未完成，请从菜单重试。')
    })
    const visibility = listen<boolean>('companion:visibility-changed', event => {
      hiddenRef.current = !event.payload
      visibilityEpochRef.current += 1
      if (event.payload) { behaviorRef.current?.wake(); return }
      suppressCurrentReminders()
      pendingModeRef.current = null
      pendingCommitRef.current = undefined
      modeWaitersRef.current.splice(0).forEach(waiter => waiter.reject(new Error('桌宠已隐藏')))
      flushSync(() => {
        chatModeRef.current = 'closed'
        setChatMode('closed')
        setPanelPreparing(false)
        setPanelEntering(false)
      })
    })
    return () => { disposed = true; void unlisten.then(stop => stop()); void visibility.then(stop => stop()); void actionErrors.then(stop => stop()) }
  }, [])

  useEffect(() => {
    // The main window routes reminders to the dedicated chat surface.
    if (isChatWindow || !status || hiddenRef.current) return
    if (shownRemindersRef.current.generation !== status.generation) {
      shownRemindersRef.current = { generation: status.generation, occurrences: new Set() }
      reminderRetryAfterRef.current = 0
    }
    const seen = shownRemindersRef.current.occurrences
    const occurrences = reminderOccurrences(status)
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
      if (!reminderOccurrences(current).some(key => !seen.has(key))) return
      void changePetChatMode('expanded').then(() => {
        if (chatModeRef.current === 'expanded' && viewRef.current?.generation === status.generation)
          occurrences.forEach(key => seen.add(key))
      }).catch(() => {
        if (viewRef.current?.generation !== status.generation) return
        reminderRetryAfterRef.current = Date.now() + 15_000
        setError('未能展开提醒，请点“聊一会”重试。')
        setReminderRetry(value => value + 1)
      })
    }, Math.max(0, reminderRetryAfterRef.current - Date.now()))
    return () => window.clearTimeout(timer)
  }, [status, chatMode, modeTransitioning, reminderRetry])

  useEffect(() => {
    if (!isChatWindow) return
    let disposed = false
    const unlisten = listen<unknown>('pet-panel:viewport-changed', event => {
      const visibilityEpoch = visibilityEpochRef.current
      let revision = panelViewportRef.current.revision
      const current = () => !disposed && !hiddenRef.current && chatModeRef.current !== 'closed' && visibilityEpoch === visibilityEpochRef.current && revision === panelViewportRef.current.revision
      void (async () => {
        const received = receivePanelViewport(event.payload)
        revision = received.revision
        const ready = await waitForPanelViewport(received.viewport)
        if (!current()) return
        if (!ready) throw new Error('显示区域尚未完成更新')
        flushSync(() => setPanelViewport(received.viewport))
        await waitForWindowPaint()
        // Moving only the compact body's top does not notify ResizeObserver.
        if (current()) await publishChatHitBounds()
      })().catch(() => { if (current()) setError('显示区域更新失败，请收起后重新打开对话。') })
    })
    return () => { disposed = true; void unlisten.then(stop => stop()) }
  }, [])

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
    // Entrance changes only transforms. Its bounded class cleanup restores
    // the final interactive rect even when an animation event is suspended.
    const classes = new MutationObserver(() => report())
    classes.observe(frame, { attributes: true, attributeFilter: ['class'] })
    const onMorphBounds = (event: Event) => report((event as CustomEvent<{ x: number; y: number; width: number; height: number }>).detail)
    frame.addEventListener('chat-frame-bounds', onMorphBounds)
    observer.observe(frame)
    return () => { observer.disconnect(); classes.disconnect(); frame.removeEventListener('chat-frame-bounds', onMorphBounds) }
  }, [])

  function receivePanelViewport(payload: unknown, commandRevision?: number) {
    const viewport = parsePanelViewport(payload)
    if (!viewport) throw new Error('无效的面板显示区域')
    const latest = panelViewportRef.current
    // A native move event received while the opening command was in flight
    // owns newer geometry. Its later command reply cannot put the body back.
    if (commandRevision !== undefined && latest.revision !== commandRevision && latest.viewport)
      return { revision: latest.revision, viewport: latest.viewport }
    const received = { revision: latest.revision + 1, viewport }
    panelViewportRef.current = received
    return received
  }

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
    if (!isTauri()) {
      flushSync(() => { chatModeRef.current = mode; setChatMode(mode); commitPage?.() })
      return
    }
    if (!isChatWindow) return requestChatMode(mode)
    if (modeTransitionRef.current) {
      pendingModeRef.current = mode
      pendingCommitRef.current = commitPage
      return new Promise<void>((resolve, reject) => modeWaitersRef.current.push({ resolve, reject }))
    }
    modeTransitionRef.current = true
    const previousMode = chatModeRef.current
    const visibilityEpoch = visibilityEpochRef.current
    const assertVisibleIntent = () => {
      if (hiddenRef.current || visibilityEpoch !== visibilityEpochRef.current) throw new Error('桌宠已隐藏')
    }
    let transitionCommitted = false
    try {
      if (mode !== 'closed') assertVisibleIntent()
      if (previousMode === mode) {
        if (commitPage) flushSync(commitPage)
        // The page is committed even if restoring native focus fails. Keep
        // this command serialized with a subsequent close or mode change.
        transitionCommitted = true
        if (mode !== 'closed') {
          assertVisibleIntent()
          await invoke<void>('show_chat_window')
          assertVisibleIntent()
          flushSync(() => setPanelFocusRequest(request => request + 1))
        }
        return
      }

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
        assertVisibleIntent()
        markMotionDiagnostic('route:open-prepare')
        flushSync(() => {
          setPanelPreparing(true)
          chatModeRef.current = mode
          setChatMode(mode)
        })
        // A hidden WKWebView need not deliver RAF or resize notifications.
        // Prepare native geometry, commit visible content, then reveal before
        // observing its viewport. No paint opportunity is an IPC prerequisite.
        markMotionDiagnostic('route:native-mode-start')
        const viewportRevision = panelViewportRef.current.revision
        const viewportPayload = await invoke<unknown>('set_pet_chat_mode', { mode })
        assertVisibleIntent()
        const received = receivePanelViewport(viewportPayload, viewportRevision)
        flushSync(() => {
          setPanelViewport(received.viewport)
          setPanelPreparing(false)
          setPanelEntering(false)
          commitPage?.()
        })
        await invoke<void>('show_chat_window')
        assertVisibleIntent()
        // Cosmetic only: ready/show/focus never waits for this animation.
        flushSync(() => setPanelEntering(true))
        const viewportReady = await waitForPanelViewport(received.viewport, () => panelViewportRef.current.viewport)
        assertVisibleIntent()
        if (!viewportReady) throw new Error('显示区域尚未就绪，请重试。')
        flushSync(() => setPanelViewport(panelViewportRef.current.viewport))
        await publishChatHitBounds()
        assertVisibleIntent()
        flushSync(() => {
          setModeTransitioning(false)
          setPanelFocusRequest(request => request + 1)
        })
        await emitTo('main', 'pet-panel:committed', mode)
        transitionCommitted = true
        return
      }

      // Every mode shares the work-area-fitted backing prepared while hidden.
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
      assertVisibleIntent()
      markMotionDiagnostic('route:morph-hit-bounds')
      await publishChatHitBounds()
      assertVisibleIntent()
      await emitTo('main', 'pet-panel:committed', mode)
    }
    catch (cause) {
      if (previousMode === 'closed' && mode !== 'closed' && !transitionCommitted) {
        await invoke<void>('set_pet_chat_mode', { mode: 'closed' }).catch(() => {})
      }
      markMotionDiagnostic('route:change-error', { kind: cause instanceof Error ? cause.name : 'unknown' })
      setError('切换面板失败，请重试。')
      throw cause
    }
    finally {
      if (!transitionCommitted)
        flushSync(() => {
          // A closed panel is pre-mounted before native resize. Restore that
          // provisional mode on failure so reminders remain eligible to retry.
          chatModeRef.current = hiddenRef.current ? 'closed' : previousMode
          setChatMode(chatModeRef.current)
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
    if (remoteRequestsRef.current > 0) return
    behaviorRef.current?.wake()
    setPanelError(null)
    setBrowserMenuOpen(false)
    await changePetChatMode(chatModeRef.current === 'closed' ? 'compact' : chatModeRef.current)
  }

  async function openCustomization() {
    await openChatWindow()
    if (isTauri()) await emitTo('chat', 'customization:open')
    else setCustomizationRequest(value => value + 1)
  }

  async function changeChatExpanded(expanded: boolean, commitPage?: () => void) {
    await changePetChatMode(expanded ? 'expanded' : 'compact', commitPage)
  }

  async function closeChatWindow() {
    suppressCurrentReminders()
    await changePetChatMode('closed')
  }

  async function saveCompanionPreferences(next: CompanionPreferences) {
    if (preferenceSavingRef.current) return
    preferenceSavingRef.current = true
    setPanelError(null)
    try {
      const saved = isTauri() ? await invoke<CompanionPreferences>('set_companion_preferences', { preferences: next }) : next
      preferencesRef.current = saved
      setPreferences(saved)
    } catch { setPanelError('偏好未保存，请重新选择。') }
    finally { preferenceSavingRef.current = false }
  }

  function toggleRest() {
    const behavior = behaviorRef.current
    if (behavior?.isResting()) behavior.wake()
    else behavior?.rest()
    setBrowserMenuOpen(false)
  }

  async function runCompanionAction(command: 'hide_companion' | 'reset_pet_position' | 'quit_app') {
    setPanelError(null)
    setBrowserMenuOpen(false)
    if (!isTauri()) {
      if (command === 'hide_companion') { setBrowserHidden(true); chatModeRef.current = 'closed'; setChatMode('closed') }
      else setPanelError(command === 'quit_app' ? '浏览器预览请关闭此标签页。' : '浏览器预览无法移动桌面窗口。')
      return
    }
    try { await invoke<void>(command) }
    catch { setPanelError('操作未完成，请从桌宠菜单重试。') }
  }

  async function openPetContextMenu() {
    if (isChatWindow) return
    if (!currentWindow) { setBrowserMenuOpen(value => !value); return }
    if (contextMenuBusyRef.current) return
    contextMenuBusyRef.current = true
    let menu: Menu | null = null
    try {
      const current = preferencesRef.current
      menu = await Menu.new({ items: [
        { id: 'chat', text: '聊一会', action: () => { void openChatWindow().catch(() => {}) } },
        { id: 'customization', text: '定制桌宠', action: () => { void openCustomization().catch(() => setPanelError('定制页面未打开，请重试。')) } },
        { id: 'rest', text: behaviorRef.current?.isResting() ? '叫醒白猫' : '让它休息', action: toggleRest },
        { item: 'Separator' },
        { id: 'size', text: '桌宠大小', items: COMPANION_SIZES.map(size => ({ id: `size-${size.scale}`, text: size.label, checked: current.scale === size.scale, action: () => { void saveCompanionPreferences({ ...preferencesRef.current, scale: size.scale }) } })) },
        { id: 'pin', text: '始终置顶', checked: current.alwaysOnTop, action: () => { void saveCompanionPreferences({ ...preferencesRef.current, alwaysOnTop: !preferencesRef.current.alwaysOnTop }) } },
        { id: 'hide', text: '隐藏桌宠（菜单栏可找回）', action: () => { void runCompanionAction('hide_companion') } },
        { id: 'reset-position', text: '重置位置', action: () => { void runCompanionAction('reset_pet_position') } },
        { item: 'Separator' },
        { id: 'quit-app', text: '退出橘伴', action: () => { void runCompanionAction('quit_app') } },
      ] })
      if (!contextMenuMountedRef.current) return
      // Tauri's macOS popup holds the webview resource table until NSMenu's
      // nested loop returns. Resource.close destroys a menu; it cannot dismiss
      // one. Keep creation, popup and disposal in one exclusive operation.
      await menu.popup(undefined, currentWindow)
    } catch {
      if (contextMenuMountedRef.current) setPanelError('菜单未打开，请重试。')
    } finally {
      // Unmount only marks the host inactive. The popup owner releases its
      // resource after settlement, never concurrently from effect cleanup.
      try { await menu?.close() }
      catch { console.error('桌宠菜单资源清理失败') }
      finally { contextMenuBusyRef.current = false }
    }
  }

  function updatePetState(nextState: PetState) {
    if (petStateRef.current === nextState) return
    petStateRef.current = nextState
    setPetState(nextState)
  }

  function handlePetInteract() {
    setPanelError(null)
    behaviorRef.current?.interact()
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
    if (isTauri()) void emit('pet:state', 'thinking')
    setAcceptedRequestId(null)
    const accepted = (async () => {
      try {
        await submitAgentRun(pending.id, content)
      }
      catch (cause) {
        setStreaming(false)
        if (isTauri()) void emit('pet:state', 'error')
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

  const attachment = isChatWindow ? resolveCompanionAttachment(panelViewport, chatMode === 'expanded', customization.active?.preset.theme?.design?.radius) : null
  const attachmentStyle: CSSProperties & { [key: `--${string}`]: string } = attachment ? {
    '--companion-panel-x': `${attachment.frame.x}px`,
    '--companion-panel-y': `${attachment.frame.y}px`,
    '--companion-panel-width': `${attachment.frame.width}px`,
    '--companion-panel-height': `${attachment.frame.height}px`,
    '--companion-origin-y': `${attachment.originY}px`,
  } : {}
  const silhouette = chatMode !== 'closed' && !panelPreparing ? attachment?.silhouette : null
  const panel = (
    <main ref={chatHostRef} data-panel-side={panelViewport?.side ?? 'left'} style={attachmentStyle} className={`desktop-pet-app companion-chat-host pet-chat-${chatMode === 'expanded' ? 'expanded' : 'compact'}${attachment ? ' has-pet-anchor' : ''}`} {...headerDrag}>
      {silhouette && <svg className="companion-panel-silhouette" aria-hidden="true" focusable="false" viewBox={`0 0 ${silhouette.width} ${silhouette.height}`} style={{ transformOrigin: `${silhouette.originX}px ${silhouette.originY}px` }}>
        {customization.active?.preset.theme?.design && <defs><linearGradient id="companion-material-fill" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={attachment!.frame.y} y2={attachment!.frame.y + attachment!.frame.height}><stop offset="0" stopColor="var(--companion-material-top)" /><stop offset="0.4" stopColor="var(--companion-surface)" /><stop offset="1" stopColor="var(--companion-material-bottom)" /></linearGradient></defs>}
        <path d={silhouette.path} fill={customization.active?.preset.theme?.design ? 'url(#companion-material-fill)' : undefined} />
      </svg>}
      <ChatPanel
        customizationRequest={customizationRequest}
        appearance="companion"
        expanded={chatMode === 'expanded'}
        visible={chatMode !== 'closed' && !panelPreparing}
        animateEntrance={panelEntering}
        focusRequest={panelFocusRequest}
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
  if (isChatWindow) return panel

  return (
    <main className={`desktop-pet-app companion-host pet-shell pet-chat-closed${isTauri() ? '' : ' is-browser-preview'}`} style={isTauri() ? undefined : { width: 232 * preferences.scale, height: 340 * preferences.scale }}>
      {browserHidden ? <div className="companion-browser-recovery"><p>浏览器预览已隐藏</p><button type="button" onClick={() => { setBrowserHidden(false); behaviorRef.current?.wake() }}>显示白猫</button></div> : <>
        <PetStage
          panelOpen={chatMode !== 'closed'}
          opening={modeTransitioning}
          petState={petState}
          actionError={panelError || customization.error}
          customPet={customization.active}
          reply={null}
          mode="companion"
          onPetInteract={handlePetInteract}
          onPetWake={() => behaviorRef.current?.wake()}
          onToggleChat={() => void openChatWindow().catch(() => {})}
          onContextMenu={() => void openPetContextMenu()}
        />
        {browserMenuOpen && <div className="companion-browser-menu" role="dialog" aria-label="桌宠菜单（浏览器预览）" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setBrowserMenuOpen(false) } }}>
          <button type="button" onClick={() => void openChatWindow()}>聊一会</button>
          <button type="button" onClick={() => void openCustomization()}>定制桌宠</button>
          <button type="button" onClick={toggleRest}>{petState === 'sleeping' ? '叫醒白猫' : '让它休息'}</button>
          <div className="companion-size-choices" aria-label="桌宠大小">{COMPANION_SIZES.map(size => <button key={size.scale} type="button" aria-pressed={preferences.scale === size.scale} onClick={() => void saveCompanionPreferences({ ...preferences, scale: size.scale })}>{size.label}</button>)}</div>
          <button type="button" onClick={() => void runCompanionAction('hide_companion')}>隐藏预览</button>
          <button type="button" onClick={() => setBrowserMenuOpen(false)}>关闭菜单</button>
        </div>}
        {!isTauri() && chatMode !== 'closed' && <div className="companion-browser-panel">{panel}</div>}
      </>}
    </main>
  )
}

export default function CustomizedApp() { return <CustomizationProvider><App /></CustomizationProvider> }
