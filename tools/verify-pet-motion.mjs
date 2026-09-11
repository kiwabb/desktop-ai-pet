import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import ts from 'typescript'
const source = readFileSync('src/App.tsx', 'utf8')
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'waitForWindowPaint')
assert.ok(fn)
const code = ts.transpile(fn.getText(ast), { target: ts.ScriptTarget.ES2022 })
for (const stalled of [false, true]) {
  const frames = new Map(), timers = new Map()
  let next = 0, completed = false
  const window = {
    requestAnimationFrame(callback) { frames.set(++next, callback); return next },
    cancelAnimationFrame(id) { frames.delete(id) },
    setTimeout(callback) { timers.set(++next, callback); return next },
    clearTimeout(id) { timers.delete(id) },
  }
  const wait = new Function('window', `${code}; return waitForWindowPaint`)(window)
  const pending = wait().then(() => { completed = true })
  if (stalled) [...timers.values()][0]()
  else {
    for (let pass = 0; pass < 2; pass++) {
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach(callback => callback())
    }
  }
  await pending
  assert.equal(completed, true)
  assert.equal(frames.size, 0)
  assert.equal(timers.size, 0)
}
assert.ok(source.includes('pendingModeRef.current = mode'))
assert.ok(source.includes("visible={chatMode !== 'closed' && !panelPreparing}"))
console.log('pet motion checks passed: actual paint wait resolves with frames or stalled RAF and cleans callbacks; source contracts only for visibility/queue')

function extractFunction(text, name) {
  const root = ts.createSourceFile('component.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let result
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node.getText(root)
    ts.forEachChild(node, visit)
  }
  visit(root)
  assert.ok(result, name)
  return ts.transpile(result, { target: ts.ScriptTarget.ES2022 })
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
function transitionHarness(viewportReady = true, publishBounds = async () => {}) {
  const calls = [], errors = [], commits = [], events = []
  let currentCommit = null
  const bindings = {
    markMotionDiagnostic: () => {},
    getFrameVisualBounds: frame => frame.getBoundingClientRect(),
    window: { innerWidth: 940, innerHeight: 760 },
    isChatWindow: true, stableChatBacking: true,
    emitTo: async (...args) => { events.push(['emit', ...args]) },
    publishChatHitBounds: async () => { events.push(['hit-bounds']); await publishBounds() },
    chatModeRef: { current: 'compact' }, modeTransitionRef: { current: false },
    pendingCommitRef: { current: undefined }, pendingModeRef: { current: null }, modeWaitersRef: { current: [] },
    flushSync: callback => { currentCommit = []; callback(); commits.push(currentCommit); currentCommit = null }, setModeTransitioning() {}, setPanelEntering() {},
    setPanelPreparing(value) { bindings.preparing = value }, setChatMode: mode => { events.push(['mode', mode]); currentCommit?.push(mode) }, setError: error => errors.push(error),
    waitForWindowPaint: async () => { events.push(['paint']) }, waitForPanelViewport: async () => viewportReady,
    invoke: (_command, { mode } = {}) => { const call = { mode, ...deferred() }; calls.push(call); return call.promise },
  }
  const change = new Function(...Object.keys(bindings), `${extractFunction(source, 'changePetChatMode')}; return changePetChatMode`)(...Object.values(bindings))
  return { change, calls, bindings, errors, commits, events, commitPage: () => { events.push(['page']); currentCommit?.push('settings') } }
}
{
  const h = transitionHarness()
  await h.change('expanded')
  assert.equal(h.calls.length, 0, 'open-to-open never resizes, hides or refocuses native backing')
  const close = h.change('closed')
  const failed = assert.rejects(close, /native failed/)
  h.calls[0].reject(new Error('native failed'))
  await failed
  assert.equal(h.bindings.chatModeRef.current, 'expanded')
  assert.equal(h.bindings.modeTransitionRef.current, false)
  const retry = h.change('closed')
  h.calls[1].resolve()
  await retry
  assert.equal(h.bindings.chatModeRef.current, 'closed')
}
{
  const h = transitionHarness()
  h.bindings.chatModeRef.current = 'closed'
  const first = h.change('compact')
  const intermediate = h.change('expanded')
  const last = h.change('closed')
  await tick()
  h.calls[0].resolve()
  await tick()
  h.calls[1].resolve()
  await tick()
  h.calls[2].resolve()
  await Promise.all([first, intermediate, last])
  assert.equal(h.bindings.chatModeRef.current, 'closed')
  assert.equal(h.bindings.modeWaitersRef.current.length, 0)
}
{
  const panel = readFileSync('src/components/ChatPanel.tsx', 'utf8')
  const expansion = deferred(), updates = []
  const bindings = {
    markMotionDiagnostic: () => {},
    getFrameVisualBounds: frame => frame.getBoundingClientRect(),
    settingsOpen: false, todosOpen: false, expanded: false,
    returnExpandedRef: { current: false }, pageIntentRef: { current: 0 },
    onExpandedChange: () => expansion.promise, onClose: () => updates.push('closed'),
    setTodosOpen: value => updates.push(['todos', value]),
    setSettingsOpen: value => updates.push(['settings', value]), returnToChat() {},
  }
  const handlers = new Function(...Object.keys(bindings), `${extractFunction(panel, 'changePage')}\n${extractFunction(panel, 'openSettings')}\n${extractFunction(panel, 'closePanel')}; return { openSettings, closePanel }`)(...Object.values(bindings))
  const opening = handlers.openSettings()
  handlers.closePanel()
  expansion.resolve()
  await opening
  assert.deepEqual(updates, [['settings', false], ['todos', false], 'closed'], 'late resize completion cannot reopen settings after close')
}
console.log('actual transition handlers: queued failure propagation, retry, final intent, serialized IPC and close invalidation passed')

{
  const h = transitionHarness()
  const transition = h.change('expanded', h.commitPage)
  await transition
  const events = h.events
  const modeAt = events.findIndex(event => event[0] === 'mode' && event[1] === 'expanded')
  const pageAt = events.findIndex(event => event[0] === 'page')
  const paintAt = events.findIndex(event => event[0] === 'paint')
  const boundsAt = events.findIndex(event => event[0] === 'hit-bounds')
  const committedEmits = events.filter(event => event[0] === 'emit' && event[1] === 'main' && event[2] === 'pet-panel:committed')
  assert.ok(modeAt !== -1 && pageAt !== -1, 'mode and page commit on the open-to-open path')
  // A flushSync around the destination render blocks the main thread behind
  // the ghost cover (measured 72-98ms in a light repro); the open-to-open
  // commit must be ordinary async React state instead.
  assert.ok(!h.commits.some(commit => commit.includes('expanded')), 'open-to-open mode commit must not run inside flushSync')
  assert.ok(modeAt < paintAt && pageAt < paintAt, 'the paint wait follows the committed mode/page')
  assert.ok(paintAt < boundsAt, 'hit bounds publish only after the destination painted, reflecting committed geometry')
  assert.equal(committedEmits.length, 1, 'exactly one pet-panel:committed emit per transition')
  assert.ok(boundsAt < events.indexOf(committedEmits[0]), 'commit acknowledgement follows hit bounds')
  const count = h.calls.length
  await h.change('expanded', h.commitPage)
  assert.equal(h.calls.length, count, 'same-size navigation needs no native resize')
  assert.deepEqual(h.commits.at(-1), ['settings'], 'same-size page commit keeps its explicit flush')
}
console.log('open-to-open commit: async state, paint wait before hit bounds, single committed emit; same-size page navigation bypasses IPC')

{
  const h = transitionHarness()
  h.bindings.chatModeRef.current = 'closed'
  const opening = h.change('compact')
  await tick()
  h.calls[0].resolve()
  await tick()
  h.calls[1].resolve()
  await opening
  assert.equal(h.bindings.chatModeRef.current, 'compact')
}

// The viewport gate observes renderer dimensions, and never calls timeout ready.
for (const scenario of ['ready', 'resize', 'timeout']) {
  let resized, timer, removed = false
  const window = {
    innerWidth: scenario === 'ready' ? 940 : 232, innerHeight: scenario === 'ready' ? 760 : 381,
    setTimeout(callback) { timer = callback; return 1 }, clearTimeout() {},
    addEventListener(_name, callback) { resized = callback },
    removeEventListener() { removed = true },
  }
  const wait = new Function('window', `${extractFunction(source, 'waitForPanelViewport')}; return waitForPanelViewport`)(window)
  const result = wait('compact')
  if (scenario === 'resize') { window.innerWidth = 940; window.innerHeight = 760; resized() }
  if (scenario === 'timeout') timer()
  assert.equal(await result, scenario !== 'timeout')
  assert.equal(removed, true)
}
console.log('viewport observation: ready, delayed resize and unready timeout clean up correctly')

{
  const h = transitionHarness(false)
  h.bindings.chatModeRef.current = 'closed'
  const opening = h.change('compact')
  const rejected = assert.rejects(opening, /限定时间/)
  await tick()
  h.calls[0].resolve()
  await tick()
  assert.deepEqual(h.calls.map(call => call.mode), ['compact', 'closed'])
  h.calls[1].resolve()
  await rejected
  assert.equal(h.bindings.chatModeRef.current, 'closed')
  assert.equal(h.bindings.modeTransitionRef.current, false)
  assert.equal(h.bindings.preparing, false)
}
console.log('unready initial viewport restores native closed frame, React mode and interaction guards')

const native = readFileSync('src-tauri/src/lib.rs', 'utf8')
const resizing = native.slice(native.indexOf('fn set_pet_chat_mode'), native.indexOf('fn pet_drag_origin'))
assert.ok(resizing.includes('get_webview_panel("chat")'))
assert.ok(!resizing.includes('get_webview_panel("main")'))
assert.ok(!resizing.includes('pet.set_size'))
assert.ok(!resizing.includes('pet.set_position'))
assert.ok(!native.includes('addChildWindow'))
assert.ok(!resizing.includes('setFrame:'))
assert.ok(native.includes('fn move_pet_group'))
const mainRendering = source.slice(source.lastIndexOf('  return ('))
assert.ok(!mainRendering.includes('<ChatPanel'))
assert.ok(mainRendering.includes('pet-chat-closed'))
console.log('fixed main window: chat-only native resizing; single cat render; explicit pair movement contract')

{
  let listener, timer, stopped = false
  const sent = [], mode = { current: 'closed' }, busy = { current: false }, count = { current: 0 }
  const bindings = {
    markMotionDiagnostic: () => {},
    getFrameVisualBounds: frame => frame.getBoundingClientRect(),
    setPanelError() {}, crypto: { randomUUID: () => 'request-1' }, remoteRequestsRef: count, modeTransitionRef: busy,
    chatModeRef: mode, setModeTransitioning() {}, setChatMode() {},
    listen: async (_name, callback) => { listener = callback; return () => { stopped = true } },
    emitTo: async (...args) => { sent.push(args) },
    window: { setTimeout(callback) { timer = callback; return 1 }, clearTimeout() { timer = undefined } },
  }
  const request = new Function(...Object.keys(bindings), `${extractFunction(source, 'requestChatMode')}; return requestChatMode`)(...Object.values(bindings))
  const pending = request('expanded')
  await tick()
  assert.equal(busy.current, true, 'reminders cannot dispatch while remote request is pending')
  assert.equal(sent[0][0], 'chat')
  listener({ payload: { id: 'other', mode: 'closed' } })
  assert.equal(count.current, 1)
  listener({ payload: { id: 'request-1', mode: 'expanded' } })
  await pending
  assert.equal(mode.current, 'expanded')
  assert.equal(busy.current, false)
  assert.equal(stopped, true)
  assert.equal(timer, undefined)
}
console.log('cross-window request: matching acknowledgement, actual mode and reminder gate cleanup')

assert.ok(native.includes('if let Some(chat) = app.get_webview_window("chat") { chat.hide()?; }'))
assert.ok(source.includes("title: '打开失败'"))

{
  const dragSource = readFileSync('src/lib/usePetGroupDrag.ts', 'utf8')
  const code = extractFunction(dragSource, 'usePetGroupDrag').replace('export function', 'function')
  const calls = [], errors = []
  const bindings = {
    markMotionDiagnostic: () => {},
    getFrameVisualBounds: frame => frame.getBoundingClientRect(),
    useRef: value => ({ current: value }), useEffect() {}, isTauri: () => true,
    crypto: { randomUUID: () => String(calls.length) },
    invoke(command, args) { const call = { command, args, ...deferred() }; calls.push(call); return call.promise },
  }
  const useDrag = new Function(...Object.keys(bindings), `${code}; return usePetGroupDrag`)(...Object.values(bindings))
  const handlers = useDrag({ onError: cause => errors.push(cause) })
  const target = { setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {} }
  const event = x => ({ pointerId: 1, button: 0, isPrimary: true, screenX: x, screenY: 0, currentTarget: target, target, preventDefault() {}, stopPropagation() {} })
  handlers.onPointerDown(event(0))
  await tick()
  calls[0].resolve({ scale: 2 })
  handlers.onPointerMove(event(10))
  await tick()
  handlers.onPointerMove(event(20))
  handlers.onPointerUp(event(25))
  assert.equal(calls.length, 2, 'one move in flight')
  calls[1].resolve()
  await tick()
  assert.equal(calls[2].args.deltaX, 25, 'pointerup final position replaces intermediate pending position')
  calls[2].resolve()
  await tick()
  assert.equal(calls[3].command, 'end_pet_group_drag', 'capture policy releases after final move')
  calls[3].resolve()
  await tick()
  assert.equal(errors.length, 0)
}
console.log('shared drag: serialized moves, coalescing and final pointer-up position before capture release')

assert.ok(native.includes('PanelLevel::Floating.value() + if window.label() == "main" { 1 } else { 0 }'))
assert.ok(native.includes('panel.set_level(level)'))
console.log('native layer contract: main stays one level above chat independently of key-window ordering')

{
  const hook = readFileSync('src/components/useFrameMorph.ts', 'utf8')
  // The compact↔expanded transition is a compositor-only crossfade dissolve:
  // WKWebView GPU-composites only transform and opacity, so nothing else may
  // animate on the transition path.
  assert.ok(hook.includes('.animate('), 'transition must be WAAPI-driven')
  assert.ok(!hook.includes('clipPath') && !hook.includes('clip-path'), 'no clip-path animation on the transition path')
  assert.ok(!hook.includes('setCurrentTime') && !hook.includes('pauseAnimations') && !hook.includes('unpauseAnimations'), 'no SMIL clock plumbing')
  assert.ok(!hook.includes('MutationObserver'), 'no footprint sync observer remains')
  assert.ok(!hook.includes('setInterval'), 'hit bounds notify at start/end only, never per frame')
  assert.ok(!hook.includes('root.style.width') && !hook.includes('root.style.height') && !hook.includes('flushSync'))
  assert.ok(hook.includes("position: 'fixed'") && hook.includes("pointerEvents: 'none'"), 'ghost is a non-interactive fixed overlay at the from-rect')
  assert.ok(hook.includes("removeAttribute('filter')"), 'ghost clone drops the drop-shadow filter')
  assert.ok(hook.includes('transformOrigin') && hook.includes('data-shell-dock'), 'ghost scales around the dock anchor')
  // The dock transform's translate components are the artwork origin (offscreen
  // up-left); scaling around them drags the fixed dock ~37/26px mid-fade. The
  // anchor must be the platform center (artwork 1220,868) mapped through the
  // dock transform's translate AND scale.
  assert.ok(hook.includes('1220') && hook.includes('868'), 'ghost transform origin is the platform center, not the artwork origin')
  assert.ok(hook.includes('scale\\(([-\\d.]+)\\)'), 'dock scale factor feeds the anchor mapping')
  assert.ok(hook.includes('dockAnchorOrigin(shell)') && hook.includes('svg.style.transformOrigin'), 'incoming shell grow shares the ghost\'s dock anchor origin')
  assert.ok(hook.includes('scale(.95)'), 'ordinary motion contracts the outgoing ghost toward the dock')
  assert.ok(hook.includes('scale(.96)'), 'destination shell grows in from .96 toward the dock anchor')
  assert.ok(hook.includes('{ opacity: 1 }, { opacity: 0 }'), 'reduced motion uses an opacity-only crossfade')
  assert.ok(hook.includes('translateY(6px)'), 'destination content arrives with a short 6px rise')
  assert.ok(hook.includes('document.timeline.currentTime'), 'all animations share one explicit timeline startTime')
  assert.ok(!/delay\s*:/.test(hook), 'no start delay: ghost and destination fades fully overlap once painting settles')
  assert.ok(hook.includes('requestAnimationFrame') && hook.includes('cancelAnimationFrame'), 'crossfade starts only after the committed frame paints; settle rAF handles cancel cleanly')
  assert.ok(hook.includes("opacity = '0'") && hook.includes("opacity = ''"), 'destination pins invisible beneath the ghost cover and restores cleanly')
  assert.ok(hook.includes('document.fonts'), 'pending webfonts join the paint-settle wait when observable')
  assert.ok(hook.includes('FRAME_MORPH_MS = 300'), 'morph budget constant matches the 300ms crossfade')
  assert.ok(hook.includes('duration: reduced ? FRAME_MORPH_REDUCED_MS : 240'), 'ghost cover fade lasts 240ms under ordinary motion')
  assert.ok(hook.includes('duration: reduced ? FRAME_MORPH_REDUCED_MS : 300'), 'destination fade-in lasts 300ms under ordinary motion')
  assert.ok(hook.includes('cubic-bezier(0.4, 0, 0.2, 1)'), 'ghost fade uses the standard curve')
  assert.ok(hook.includes('cubic-bezier(0.22, 1, 0.36, 1)'), 'destination fade-in uses the emphasized ease-out')
  assert.ok(hook.includes("finishWatchdog") && hook.includes("morph-watchdog"), 'a watchdog settles the morph when an occluded WebView suspends the animation timeline')
  assert.ok(hook.includes("finish('morph-watchdog'), 1200"), 'watchdog budget covers the longer 300ms timeline')
  assert.ok(hook.includes('dataset.frameMorphing'), 'the CSS relief attribute lifecycle stays')
  assert.ok(hook.includes('chat-frame-bounds'), 'start/end hit-bounds notifications stay')
  assert.ok(hook.includes('activeRef.current?.cancel()'), 'rapid toggling cancels the previous ghost and animations first')
}
console.log('frame morph contract: WAAPI transform/opacity crossfade only; no SMIL, clip-path or per-frame IPC')
{
  let rect = { x: 254, y: 427, width: 475, height: 278 }
  const calls = []
  const bindings = {
    markMotionDiagnostic: () => {},
    getFrameVisualBounds: frame => frame.getBoundingClientRect(),
    chatHostRef: { current: { querySelector: () => ({ getBoundingClientRect: () => rect }) } },
    hitBoundsQueueRef: { current: { pending: null, running: null } },
    invoke: (_command, args) => { const call = { args, ...deferred() }; calls.push(call); return call.promise },
  }
  const publish = new Function(...Object.keys(bindings), `${extractFunction(source, 'publishChatHitBounds')}; return publishChatHitBounds`)(...Object.values(bindings))
  const initial = publish()
  rect = { x: 100, y: 150, width: 600, height: 500 }
  const midway = publish()
  rect = { x: 40, y: 40, width: 676, height: 665 }
  const final = publish()
  assert.equal(calls.length, 1)
  calls[0].resolve()
  await tick()
  assert.equal(calls.length, 2, 'morph does not accumulate one IPC per frame')
  assert.deepEqual(calls[1].args.bounds, rect, 'final interactive bounds replace intermediate pending geometry')
  calls[1].resolve()
  await Promise.all([initial, midway, final])
  assert.equal(bindings.hitBoundsQueueRef.current.running, null)
}
console.log('coalesced final hit bounds passed; browser geometry remains separate')

{
  let rect = { x: 254, y: 427, width: 475, height: 278 }
  const calls = []
  const bindings = {
    markMotionDiagnostic: () => {},
    getFrameVisualBounds: frame => frame.getBoundingClientRect(),
    chatHostRef: { current: { querySelector: () => ({ getBoundingClientRect: () => rect }) } },
    hitBoundsQueueRef: { current: { pending: null, running: null } },
    invoke: (_command, args) => { const call = { args, ...deferred() }; calls.push(call); return call.promise },
  }
  const publish = new Function(...Object.keys(bindings), `${extractFunction(source, 'publishChatHitBounds')}; return publishChatHitBounds`)(...Object.values(bindings))
  const first = publish()
  rect = { x: 40, y: 40, width: 676, height: 665 }
  const final = publish()
  calls[0].reject(new Error('intermediate failed'))
  await tick()
  assert.equal(calls.length, 2, 'rejection still drains the already queued final bounds')
  assert.deepEqual(calls[1].args.bounds, rect)
  calls[1].resolve()
  await Promise.all([first, final])
  assert.equal(bindings.hitBoundsQueueRef.current.pending, null)
  assert.equal(bindings.hitBoundsQueueRef.current.running, null)
  const retry = publish()
  const retryRejected = assert.rejects(retry, /final failed/)
  calls[2].reject(new Error('final failed'))
  await retryRejected
  await tick()
  assert.equal(calls.length, 3, 'failed payload does not retry indefinitely')
  assert.equal(bindings.hitBoundsQueueRef.current.pending, null)
}
console.log('hit bounds uses latest outcome: repaired intermediate failure resolves, final failure rejects without retry loop')

{
  const h = transitionHarness(true, async () => { throw new Error('final hit bounds failed') })
  await assert.rejects(h.change('expanded', h.commitPage), /final hit bounds failed/)
  assert.equal(h.bindings.chatModeRef.current, 'expanded', 'failed hit-region write does not roll back only the already committed mode')
  assert.ok(h.events.some(event => event[0] === 'mode' && event[1] === 'expanded') && h.events.some(event => event[0] === 'page'), 'page and mode stay committed through the terminal geometry failure')
  assert.equal(h.bindings.modeTransitionRef.current, false)
  assert.ok(h.errors.length, 'terminal hit-region failure is reported')
  const close = h.change('closed')
  h.calls[0].resolve()
  await close
  assert.equal(h.bindings.chatModeRef.current, 'closed', 'terminal geometry error does not block subsequent close')
}
console.log('terminal hit-region failure preserves committed page/mode consistency and releases transition lock')

{
  const geometrySource = readFileSync('src/components/pet-shell-geometry.ts', 'utf8')
  const geometryCode = ts.transpileModule(geometrySource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const { buildPetShellGeometry } = await import(`data:text/javascript;base64,${Buffer.from(geometryCode).toString('base64')}`)
  assert.ok(!geometrySource.includes('motionOutline'), 'SMIL-only normalized outline geometry is removed')
  const aRect = { x: 254.3, y: 427, width: 475, height: 278 }
  const custom = { scale: .9, offsetX: -8, offsetY: -200 }
  const configured = buildPetShellGeometry(aRect, custom)
  const actualDock = configured.dockTransform.match(/translate\(([-\d.]+) ([-\d.]+)\)/).slice(1).map(Number)
  const k = Math.min(.9, 475 / 680, 278 / 440)
  assert.equal(configured.scale, k, 'effective scale still shrinks to the available panel room')
  assert.ok(actualDock[1] > 278 - 940 * k - 200, 'excessive upward offsetY is still clamped before the joint folds')
  // The SMIL architecture module is deleted with all of its consumers.
  assert.ok(!existsSync('src/components/shell-motion.ts'), 'shell-motion.ts is deleted')
  for (const file of ['src/components/useFrameMorph.ts', 'src/components/ChatBubbleFrame.tsx', 'src/components/ChatBubbleShell.tsx', 'src/App.tsx'])
    assert.ok(!readFileSync(file, 'utf8').includes('shell-motion'), `${file} must not reference shell-motion`)
  const hook = readFileSync('src/components/useFrameMorph.ts', 'utf8')
  assert.ok(!hook.includes('createNativeShellMotion') && !hook.includes('interpolateShell') && !hook.includes('shellState'))
  assert.ok(!hook.includes('createShellComposition') && !hook.includes('shellCuts'), 'experimental slicing stays removed')
  assert.ok(source.includes('getFrameVisualBounds(frame)'), 'hit bounds still read the committed frame rect')
  const frameCss = readFileSync('src/components/ChatBubbleFrame.css', 'utf8')
  assert.ok(frameCss.includes('.chat-panel[data-frame-morphing]'), 'morph-state paint relief rules stay')
}
console.log('crossfade dissolve contract: shell-motion deleted, dock geometry intact, relief rules and committed-rect hit bounds pinned')
