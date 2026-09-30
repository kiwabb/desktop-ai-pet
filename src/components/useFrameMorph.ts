import { markMotionDiagnostic, motionDiagnosticMode } from '../lib/motion-diagnostics'
import { motionDuration, MOTION_EASE_OUT } from '../lib/motion'
import { useLayoutEffect, useRef } from 'react'
import type { ChatBubbleDockConfig } from './pet-shell-geometry'
import type { RefObject } from 'react'

export interface FrameGeometry { width: number; height: number; dockShift: number }
interface FrameRect { x: number; y: number; width: number; height: number }

/** Total compact↔expanded morph budget: a bounded paint-settle wait (two
 * chained rAFs, ~2 frames) under full ghost cover, then a fully overlapped
 * crossfade (ghost160ms out / destination240ms in, shared start). */
export const FRAME_MORPH_MS = 240
/** Reduced-motion crossfade: opacity only, no transform. */
const FRAME_MORPH_REDUCED_MS = 140
const FRAME_MORPH_SETTLE_GRACE_MS = 80

/** The real frame commits its final geometry at transition start, so its own
 * bounds are the authoritative interactive rect for the whole dissolve. */
export function getFrameVisualBounds(root: HTMLElement) {
  return root.getBoundingClientRect()
}

let cloneId = 0
/** SVG resource references stay inside each clone; never resolve into React's SVG. */
function isolatedClone(source: SVGSVGElement) {
  const svg = source.cloneNode(true) as SVGSVGElement
  const prefix = `ghost-${++cloneId}-`
  const ids = new Map([...svg.querySelectorAll('[id]')].map(node => [node.id, prefix + node.id]))
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    for (const attr of [...element.attributes]) {
      let value = attr.value
      if (attr.name === 'id') value = ids.get(value) ?? value
      else for (const [id, replacement] of ids) {
        value = value.replaceAll(`url(#${id})`, `url(#${replacement})`)
        if (value === `#${id}`) value = `#${replacement}`
      }
      element.setAttribute(attr.name, value)
    }
  }
  return svg
}

/** Dock platform-center transform origin shared by the outgoing ghost's
 * contraction and the incoming shell's grow, so both scale toward the same
 * painted point. Contract around the dock's painted platform center (the
 * artwork ellipse at 1220,868 in ChatBubbleShell), mapped through the dock
 * transform. The translate components alone are the artwork origin — offscreen
 * up-left — and anchoring the scale there would drag the "stationary" dock
 * ~37/26px during the fade, breaking the fixed-dock contract. */
function dockAnchorOrigin(svg: SVGSVGElement) {
  const dockTransform = svg.querySelector('[data-shell-dock]')?.getAttribute('transform')
  const dockAnchor = dockTransform?.match(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/)
  return dockAnchor
    ? `${Number(dockAnchor[1]) + 1220 * Number(dockAnchor[3])}px ${Number(dockAnchor[2]) + 868 * Number(dockAnchor[3])}px`
    : '100% 100%'
}

/** WKWebView only GPU-composites transform/opacity, so the variant change is a
 * crossfade dissolve: a static ghost of the FROM shell covers the transition
 * while the already-committed TO shell and its content fade in. No path/clip/
 * geometry animation remains on the transition path. The dissolve only starts
 * after the committed frame has painted (two chained rAFs + webfonts), so a
 * long synchronous commit can no longer consume the ghost's fade and open a
 * blank window; until then the ghost stays fully opaque over pinned-invisible
 * destination nodes. */
export function useFrameMorph(rootRef: RefObject<HTMLElement | null>, variant: string, visible: boolean, enabled: boolean, onFrame: (geometry: FrameGeometry) => void, dock: ChatBubbleDockConfig = {}) {
  const previousRef = useRef<{ variant: string; rect: FrameRect } | null>(null)
  const activeRef = useRef<{ cancel: () => void } | null>(null)
  const morphingRef = useRef(false)
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const measured = root.getBoundingClientRect()
    const to = { x: measured.x, y: measured.y, width: measured.width, height: measured.height }
    const previous = previousRef.current
    const from = previous?.rect ?? to
    activeRef.current?.cancel()
    activeRef.current = null
    previousRef.current = visible ? { variant, rect: to } : null
    const diagnostic = motionDiagnosticMode()
    markMotionDiagnostic('layout-effect')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const shouldAnimate = visible && enabled && previous && previous.variant !== variant && getComputedStyle(root).position === 'absolute'
    onFrame({ width: to.width, height: to.height, dockShift: 0 })
    // Read the FROM shell before React flushes the onFrame state above: the
    // committed DOM still carries the previous geometry until that flush.
    const svg = root.querySelector<SVGSVGElement>('.chat-bubble-shell')
    if (!shouldAnimate || !svg || diagnostic === 'none') { markMotionDiagnostic('direct-commit'); return }
    if (diagnostic === 'translate-only') {
      // Diagnostic contrast: destination shell/content snap to their final
      // geometry; only foreground content/paw translate.
      const nodes = [root.querySelector('.chat-panel-surface'), root.querySelector('.assistant-paw-badge')]
      const animations = nodes.flatMap(node => node ? [node.animate([
        { transform: 'translateY(6px)' }, { transform: 'translateY(0px)' },
      ], { duration: FRAME_MORPH_MS, easing: 'cubic-bezier(.2,.75,.25,1)' })] : [])
      markMotionDiagnostic('translate-start')
      void Promise.all(animations.map(animation => animation.finished)).then(() => markMotionDiagnostic('translate-end'), () => markMotionDiagnostic('translate-cancel'))
      return () => animations.forEach(animation => animation.cancel())
    }
    morphingRef.current = true
    root.dataset.frameMorphing = 'true'
    const surface = root.querySelector<HTMLElement>('.chat-panel-surface')
    // Static ghost of the FROM shell, pinned over the old rect. The source
    // SVG's -1px inset cancels its parent's 1px border; this fixed overlay
    // uses viewport coordinates and has no parent border. The clone drops the
    // drop-shadow filter: a static filter on a fading, scaled layer forces
    // offscreen raster re-evaluation per frame in WebKit.
    const ghost = document.createElement('div')
    ghost.className = 'chat-shell-ghost'
    Object.assign(ghost.style, { position: 'fixed', left: `${from.x}px`, top: `${from.y}px`, pointerEvents: 'none', zIndex: '0' })
    const shell = isolatedClone(svg)
    shell.style.visibility = ''
    Object.assign(shell.style, { display: 'block', overflow: 'visible', maxWidth: 'none' })
    for (const node of shell.querySelectorAll('[filter]')) node.removeAttribute('filter')
    ghost.append(shell)
    root.append(ghost)
    // The ghost contracts toward the dock's painted platform center via the
    // shared anchor computation; the clone still carries the FROM geometry.
    ghost.style.transformOrigin = dockAnchorOrigin(shell)
    const notify = (rect: FrameRect) => root.dispatchEvent(new CustomEvent('chat-frame-bounds', { bubbles: true, detail: rect }))
    // Pin the freshly committed real shell/surface invisibly beneath the
    // opaque ghost until the commit has actually painted. Starting the
    // crossfade at layout-effect time let a long synchronous commit consume
    // the ghost's fade while the real frame was still near opacity 0 — the
    // observed blank window. The pins restore on start, finish and cancel.
    const pinned: Array<HTMLElement | SVGElement> = []
    for (const node of [svg, surface] as const) {
      if (!node) continue
      node.style.opacity = '0'
      pinned.push(node)
    }
    const unpin = () => pinned.forEach(node => { node.style.opacity = '' })
    let stopped = false
    let settled = false
    let rafDone = false
    let settleRaf = 0
    let settleTimer = 0
    let finishWatchdog = 0
    let motion: Animation[] = []
    const cancel = () => {
      if (stopped) return
      stopped = true
      markMotionDiagnostic('morph-cleanup')
      window.cancelAnimationFrame(settleRaf)
      window.clearTimeout(settleTimer)
      window.clearTimeout(finishWatchdog)
      motion.forEach(animation => animation.cancel())
      unpin()
      svg.style.transformOrigin = ''
      ghost.remove()
      delete root.dataset.frameMorphing
      morphingRef.current = false
    }
    const finish = (mark: string) => {
      if (stopped) return
      markMotionDiagnostic(mark)
      cancel()
      activeRef.current = null
      notify(to)
    }
    const start = () => {
      if (stopped || settled) return
      settled = true
      window.clearTimeout(settleTimer)
      markMotionDiagnostic('morph-settled')
      // The incoming shell grows in from its own dock platform center — the
      // same computation the ghost's contraction uses, read from the live
      // shell now that the committed destination geometry has painted. The
      // origin restores with the rest of the cleanup.
      if (!reduced) svg.style.transformOrigin = dockAnchorOrigin(svg)
      const incomingDuration = reduced ? FRAME_MORPH_REDUCED_MS : motionDuration(root, 'slow', FRAME_MORPH_MS)
      const outgoingDuration = reduced ? FRAME_MORPH_REDUCED_MS : motionDuration(root, 'exit', 160)
      const fadeIn = { duration: incomingDuration, easing: MOTION_EASE_OUT, fill: 'both' as FillMode }
      motion = [
        // The outgoing shell dissolves and slightly contracts toward the dock
        // anchor on the standard curve; reduced motion keeps an opacity-only
        // crossfade. Both fades share one start and fully overlap — no delay,
        // no dead window.
        ghost.animate(reduced ? [
          { opacity: 1 }, { opacity: 0 },
        ] : [
          { opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.95)' },
        ], { duration: outgoingDuration, easing: reduced ? 'ease-in-out' : 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'both' }),
        // The incoming shell grows from .96 toward the same dock anchor on an
        // emphasized ease-out — fast start, gentle settle. The frame root
        // itself never scales: layout already committed at final geometry.
        svg.animate(reduced ? [
          { opacity: 0 }, { opacity: 1 },
        ] : [
          { opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'scale(1)' },
        ], fadeIn),
        ...(surface ? [surface.animate(reduced ? [
          { opacity: 0 }, { opacity: 1 },
        ] : [
          { opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0px)' },
        ], fadeIn)] : []),
      ]
      // One shared timeline: identical explicit startTimes keep all three in sync.
      const startTime = document.timeline.currentTime
      if (startTime != null) for (const animation of motion) animation.startTime = startTime
      // WAAPI effects win over the inline pins from their first frame, so the
      // pins can drop immediately; finish/cancel then restore with no flash.
      unpin()
      markMotionDiagnostic('morph-start')
      // An occluded WKWebView suspends the document animation timeline while
      // timers keep firing: the fades would stay frozen at their first frame
      // and the morph would never settle. Bound it — on timeout, cancel()
      // restores the unpinned destination and the ghost simply lifts, ending
      // in the committed final state.
      finishWatchdog = window.setTimeout(() => finish('morph-watchdog'), Math.max(incomingDuration, outgoingDuration) + FRAME_MORPH_SETTLE_GRACE_MS)
      void Promise.all(motion.map(animation => animation.finished)).then(() => finish('morph-end'), () => { /* cancel() already owns cleanup on cancellation */ })
    }
    // Wait for the committed frame to paint before dissolving: two chained
    // rAFs after the commit, plus pending webfonts when observable. rAF can
    // stall on an occluded/backgrounded WebView, so the ghost-cover window
    // stays bounded and the destination can never remain pinned invisible.
    const fontSet: FontFaceSet | undefined = typeof document.fonts === 'undefined' ? undefined : document.fonts
    let fontsReady = !fontSet
    const maybeStart = () => { if (rafDone && fontsReady) start() }
    if (fontSet) void fontSet.ready.then(
      () => { fontsReady = true; maybeStart() },
      () => { fontsReady = true; maybeStart() },
    )
    settleRaf = window.requestAnimationFrame(() => {
      if (stopped) return
      settleRaf = window.requestAnimationFrame(() => { if (!stopped) { rafDone = true; maybeStart() } })
    })
    settleTimer = window.setTimeout(() => {
      // No paint callbacks means a known-unready animation timeline. Reveal the
      // already committed destination now instead of starting frozen WAAPI.
      if (!rafDone) finish('morph-paint-timeout')
      else start() // Preserve the bounded font wait once both RAFs arrived.
    }, 200)
    activeRef.current = { cancel }
    notify(from)
    markMotionDiagnostic('morph-created')
  }, [rootRef, variant, visible, enabled, onFrame, dock.offsetX, dock.offsetY, dock.scale, dock.preserveScale])
  useLayoutEffect(() => () => { activeRef.current?.cancel(); activeRef.current = null }, [])
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const resized = () => {
      activeRef.current?.cancel()
      activeRef.current = null
      if (previousRef.current) {
        const rect = root.getBoundingClientRect()
        previousRef.current.rect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }
    }
    root.addEventListener('chat-frame-viewport-resize', resized)
    return () => root.removeEventListener('chat-frame-viewport-resize', resized)
  }, [rootRef])
  return morphingRef
}
