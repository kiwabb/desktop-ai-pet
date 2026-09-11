import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'

export type MotionDiagnosticMode = 'normal' | 'no-shadows' | 'translate-only' | 'none'
const protocol = 'phase-v4'
const enabled = import.meta.env.DEV || import.meta.env.MODE === 'motion-diagnostic'
let mode: MotionDiagnosticMode = 'normal'
let requestId: string | null = null
let windowLabel = ''
let marks: { name: string; now: number; epoch: number }[] | null = null

export function motionDiagnosticMode(): MotionDiagnosticMode { return enabled ? mode : 'normal' }
export function markMotionDiagnostic(name: string, details?: Record<string, string | number | boolean>) {
  if (!enabled) return
  const value = { name, now: performance.now(), epoch: Date.now(), details }
  if (marks && marks.length < 64) marks.push(value)
  if (requestId && name.startsWith('route:')) {
    void emit('pet:motion-diagnostic-route', { ...value, id: requestId, window: windowLabel })
  }
}
interface Request { id: string; mode: MotionDiagnosticMode; action: 'none' | 'open' | 'todo' | 'back' | 'settings' | 'close'; phase: 'apply' | 'run'; targetLabel: string }
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
  const label = getCurrentWindow().label
  windowLabel = label
  const report = (value: object) => emit('pet:motion-diagnostic-report', value)
  const handle = async (request: Request) => {
    if (request.targetLabel !== label) return
    if (!['normal', 'no-shadows', 'translate-only', 'none'].includes(request.mode)) return
    const base = { protocol, id: request.id, mode: request.mode, action: request.action, window: label,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      epoch: Date.now(), timeOrigin: performance.timeOrigin, now: performance.now() }
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
    if (request.mode !== mode) { await report({ ...base, error: 'mode-not-applied' }); return }
    busy = true
    marks = []
    const intervals: number[] = []
    let raf = 0, last = performance.now()
    const sample = (now: number) => {
      if (intervals.length < 240) intervals.push(now - last)
      last = now
      raf = requestAnimationFrame(sample)
    }
    try {
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
          await report({ ...base, error: 'action-control-unavailable' }); return
        }
        markMotionDiagnostic('click')
        button.click() // The existing real React route, including native mode acknowledgement.
      }
      raf = requestAnimationFrame(sample)
      await new Promise(resolve => window.setTimeout(resolve, 1000))
      cancelAnimationFrame(raf)
      await report({ ...base, completedEpoch: Date.now(), completedNow: performance.now(), marks,
        rafIntervals: intervals, shellFilter: document.querySelector('.chat-bubble-shell [filter]') ? getComputedStyle(document.querySelector('.chat-bubble-shell [filter]')!).filter : null, stillMorphing: Boolean(document.querySelector('[data-frame-morphing="true"]')) })
    } finally {
      cancelAnimationFrame(raf)
      marks = null
      busy = false
    }
  }
  // Readiness is emitted only after the real Tauri listener is installed.
  await listen<Request>('pet:motion-diagnostic-command', event => {
    void handle(event.payload).catch(() => {
      const value = { id: event.payload.id, window: label, mode: event.payload.mode, error: 'diagnostic-handler-failed' }
      void (event.payload.phase === 'apply' ? emit('pet:motion-diagnostic-applied', value) : report(value))
    })
  })
  await emit('pet:motion-diagnostic-ready', { window: label, protocol, epoch: Date.now(),
    isSecureContext: window.isSecureContext, randomUUID: typeof window.crypto?.randomUUID,
    assets: [...document.scripts].filter(script => script.src).map(script => new URL(script.src).pathname).slice(0, 8) })
}
