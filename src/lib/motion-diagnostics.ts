import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'

export type MotionDiagnosticMode = 'normal' | 'no-shadows' | 'translate-only' | 'none'
const protocol = 'phase-v5'
const enabled = import.meta.env.DEV || import.meta.env.MODE === 'motion-diagnostic'
let mode: MotionDiagnosticMode = 'normal'
let requestId: string | null = null
let windowLabel = ''
interface DiagnosticMark { name: string; now: number; epoch: number }
let marks: DiagnosticMark[] | null = null
let armedTransition: (() => void) | null = null

export function motionDiagnosticMode(): MotionDiagnosticMode { return enabled ? mode : 'normal' }
export function markMotionDiagnostic(name: string, details?: Record<string, string | number | boolean>) {
  if (!enabled) return
  // Seed the passive sample synchronously in this document, before the route
  // marker (and the real route work following it) is allowed to proceed.
  if (name === 'route:change-enter') armedTransition?.()
  const value = { name, now: performance.now(), epoch: Date.now(), details }
  if (marks && marks.length < 64) marks.push(value)
  if (requestId && name.startsWith('route:')) {
    void emit('pet:motion-diagnostic-route', { ...value, id: requestId, window: windowLabel }).catch(() => {})
  }
}
interface Request { id: string; mode: MotionDiagnosticMode; action: 'none' | 'open' | 'todo' | 'back' | 'settings' | 'close'; armOnNextTransition?: boolean; phase: 'apply' | 'run' | 'cancel'; targetLabel: string }
let installed = false

/** Explicit development instrumentation. Never installed in a normal build. */
export async function installMotionDiagnostics() {
  if (!enabled || installed) return
  installed = true
  const style = document.createElement('style')
  style.textContent = `
    html[data-pet-motion-diagnostic="no-shadows"] *,
    html[data-pet-motion-diagnostic="no-shadows"] *::before,
    html[data-pet-motion-diagnostic="no-shadows"] *::after {
      filter: none !important; -webkit-filter: none !important;
      backdrop-filter: none !important; -webkit-backdrop-filter: none !important;
      box-shadow: none !important; text-shadow: none !important;
    }
    html[data-pet-motion-diagnostic="none"] *,
    html[data-pet-motion-diagnostic="none"] *::before,
    html[data-pet-motion-diagnostic="none"] *::after {
      animation: none !important; transition: none !important;
    }`
  document.head.append(style)
  let busy = false
  let activeProbe: { id: string; cancel: (reason: string) => void } | null = null
  const label = getCurrentWindow().label
  windowLabel = label
  const report = (value: object) => emit('pet:motion-diagnostic-report', value)
  const handle = async (request: Request) => {
    if (request.targetLabel !== label) return
    if (!['normal', 'no-shadows', 'translate-only', 'none'].includes(request.mode)) return
    const base = { protocol, id: request.id, mode: request.mode, action: request.action, window: label,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      epoch: Date.now(), timeOrigin: performance.timeOrigin, now: performance.now() }
    if (request.armOnNextTransition !== undefined && (typeof request.armOnNextTransition !== 'boolean' || request.mode !== 'normal' || request.action !== 'none')) {
      await (request.phase === 'apply' ? emit('pet:motion-diagnostic-applied', { ...base, error: 'invalid-arm-request' }) : report({ ...base, error: 'invalid-arm-request' }))
      return
    }
    if (request.phase === 'cancel') {
      if (activeProbe?.id === request.id) activeProbe.cancel('diagnostic-cancelled')
      if (requestId === request.id) requestId = null
      return
    }
    if (request.phase === 'apply' && activeProbe && activeProbe.id !== request.id) activeProbe.cancel('diagnostic-replaced')
    if (busy || document.querySelector('[data-frame-morphing="true"]')) {
      await (request.phase === 'apply' ? emit('pet:motion-diagnostic-applied', { ...base, error: 'transition-or-probe-busy' }) : report({ ...base, error: 'transition-or-probe-busy' }))
      return
    }
    if (request.phase === 'apply') {
      requestId = request.id
      mode = request.mode
      document.documentElement.dataset.petMotionDiagnostic = mode
      if (mode === 'none') document.getAnimations().forEach(animation => animation.cancel())
      await emit('pet:motion-diagnostic-applied', { ...base })
      return
    }
    if (request.id !== requestId || request.mode !== mode) { await report({ ...base, error: 'mode-not-applied' }); return }
    busy = true
    const collectedMarks: DiagnosticMark[] = []
    const intervals: number[] = []
    let raf = 0, timer = 0, last = 0
    let rafSeedNow: number | null = null
    let settled = false
    const finish = (error?: string) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      cancelAnimationFrame(raf)
      if (armedTransition === startSafely) armedTransition = null
      if (activeProbe?.id === request.id) activeProbe = null
      marks = null
      busy = false
      if (request.armOnNextTransition && requestId === request.id) requestId = null
      const result = { ...base, ...(request.armOnNextTransition ? { armOnNextTransition: true } : {}),
        completedEpoch: Date.now(), completedNow: performance.now(), rafSeedNow, marks: collectedMarks, rafIntervals: intervals }
      try {
        const filteredShell = document.querySelector('.chat-bubble-shell [filter]')
        void report({ ...result, ...(error ? { error } : {}),
          shellFilter: filteredShell ? getComputedStyle(filteredShell).filter : null,
          stillMorphing: Boolean(document.querySelector('[data-frame-morphing="true"]')) }).catch(() => {})
      } catch {
        void report({ ...result, error: error ?? 'diagnostic-handler-failed' }).catch(() => {})
      }
    }
    const sample = (now: number) => {
      if (settled) return
      if (intervals.length < 240) intervals.push(now - last)
      last = now
      try { raf = requestAnimationFrame(sample) }
      catch { finish('diagnostic-handler-failed') }
    }
    const start = () => {
      if (settled || rafSeedNow !== null) return
      window.clearTimeout(timer)
      if (armedTransition === startSafely) armedTransition = null
      rafSeedNow = performance.now()
      last = rafSeedNow
      base.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      marks = collectedMarks
      markMotionDiagnostic('request')
      const selectors = {
        open: '[aria-label="点击白猫打开对话"]',
        todo: '.chat-panel:not(.is-hidden) button[aria-label="查看待办列表"]',
        back: '.chat-panel:not(.is-hidden) button[aria-label="返回聊天"]',
        settings: '.chat-panel:not(.is-hidden) button[aria-label="配置助手服务"]',
        close: '.chat-panel:not(.is-hidden) button[aria-label="收起对话"]',
      }
      if (request.action !== 'none') {
        const button = document.querySelector<HTMLElement>(selectors[request.action])
        if (!button || (button instanceof HTMLButtonElement && button.disabled)) {
          finish('action-control-unavailable'); return
        }
        markMotionDiagnostic('click')
        button.click() // The existing real React route, including native mode acknowledgement.
      }
      raf = requestAnimationFrame(sample)
      timer = window.setTimeout(() => finish(), request.armOnNextTransition ? 1500 : 1000)
    }
    function startSafely() {
      try { start() }
      catch { finish('diagnostic-handler-failed') }
    }
    activeProbe = { id: request.id, cancel: finish }
    if (request.armOnNextTransition) {
      armedTransition = startSafely
      timer = window.setTimeout(() => finish('transition-arm-timeout'), 30_000)
    } else {
      startSafely()
    }
  }
  window.addEventListener('pagehide', () => activeProbe?.cancel('diagnostic-cancelled'))
  // Readiness is emitted only after the real Tauri listener is installed.
  await listen<Request>('pet:motion-diagnostic-command', event => {
    void handle(event.payload).catch(() => {
      if (activeProbe?.id === event.payload.id) {
        activeProbe.cancel('diagnostic-handler-failed')
        return
      }
      const value = { id: event.payload.id, window: label, mode: event.payload.mode, error: 'diagnostic-handler-failed' }
      void (event.payload.phase === 'apply' ? emit('pet:motion-diagnostic-applied', value) : report(value)).catch(() => {})
    })
  })
  await emit('pet:motion-diagnostic-ready', { window: label, protocol, epoch: Date.now(),
    isSecureContext: window.isSecureContext, randomUUID: typeof window.crypto?.randomUUID,
    assets: [...document.scripts].filter(script => script.src).map(script => new URL(script.src).pathname).slice(0, 8) })
}
