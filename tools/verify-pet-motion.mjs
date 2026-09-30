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
  let focusRequest = 0
  const bindings = {
    markMotionDiagnostic: () => {},
    getFrameVisualBounds: frame => frame.getBoundingClientRect(),
    window: { innerWidth: 940, innerHeight: 760 },
    isChatWindow: true, stableChatBacking: true, isTauri: () => true,
    visibilityEpochRef: { current: 0 }, hiddenRef: { current: false }, setPanelSide() {},
    emitTo: async (...args) => { events.push(['emit', ...args]) },
    publishChatHitBounds: async () => { events.push(['hit-bounds']); await publishBounds() },
    chatModeRef: { current: 'compact' }, modeTransitionRef: { current: false },
    pendingCommitRef: { current: undefined }, pendingModeRef: { current: null }, modeWaitersRef: { current: [] },
    flushSync: callback => { currentCommit = []; callback(); commits.push(currentCommit); currentCommit = null }, setModeTransitioning() {}, setPanelEntering() {},
    setPanelPreparing(value) { bindings.preparing = value }, setChatMode: mode => { events.push(['mode', mode]); currentCommit?.push(mode) }, setError: error => errors.push(error),
    setPanelFocusRequest(update) { focusRequest = update(focusRequest); events.push(['focus-request', focusRequest]); currentCommit?.push('focus-request') },
    waitForWindowPaint: async () => { events.push(['paint']) }, waitForPanelViewport: async () => { events.push(['viewport']); return viewportReady },
    invoke: (command, { mode } = {}) => { const pending = deferred(); const call = { command, mode, ...pending, resolve: value => pending.resolve(value ?? { width: 720, height: 680, side: 'left' }) }; calls.push(call); events.push(['invoke', command]); return call.promise },
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
    settingsOpen: false, page: 'chat', expanded: false,
    reading: { invalidateSendReveal() {} },
    savingRef: { current: false }, setSettingsSuccess() {}, setSettingsError() {},
    returnExpandedRef: { current: false }, pageIntentRef: { current: 0 },
    onExpandedChange: () => expansion.promise, onClose: () => updates.push('closed'),
    setPage: value => updates.push(['page', value]),
    setSettingsOpen: value => updates.push(['settings', value]), returnToChat() {},
  }
  const handlers = new Function(...Object.keys(bindings), `${extractFunction(panel, 'changePage')}\n${extractFunction(panel, 'openSettings')}\n${extractFunction(panel, 'closePanel')}; return { openSettings, closePanel }`)(...Object.values(bindings))
  const opening = handlers.openSettings()
  handlers.closePanel()
  expansion.resolve()
  await opening
  assert.deepEqual(updates, [['settings', false], ['page', 'chat'], 'closed'], 'late resize completion cannot reopen settings after close')
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
  let focusSettled = false
  const focus = h.change('expanded', h.commitPage).then(() => { focusSettled = true })
  assert.equal(h.calls.length, count + 1)
  assert.equal(h.calls[count].command, 'show_chat_window', 'same-open navigation restores native focus without resizing')
  assert.deepEqual(h.commits.at(-1), ['settings'], 'same-size page commit keeps its explicit flush')
  await tick()
  assert.equal(focusSettled, false, 'same-open navigation must await native focus before acknowledging success')
  assert.equal(h.events.filter(event => event[0] === 'focus-request').length, 0, 'control focus must wait for successful native activation')
  h.calls[count].resolve()
  await focus
  assert.deepEqual(h.events.filter(event => event[0] === 'focus-request'), [['focus-request', 1]])
  assert.deepEqual(h.commits.at(-1), ['focus-request'], 'control focus request commits after native activation')
}
console.log('open-to-open commit: async state, paint wait before hit bounds, single committed emit; same-open navigation awaits native focus without resizing')

{
  const h = transitionHarness()
  h.bindings.chatModeRef.current = 'closed'
  await h.change('closed', h.commitPage)
  assert.equal(h.calls.length, 0, 'same-closed must not show or resize the native window')
  assert.equal(h.events.filter(event => event[0] === 'focus-request').length, 0, 'same-closed must not request control focus')
  assert.deepEqual(h.commits.at(-1), ['settings'], 'same-closed preserves the page commit contract')
}
{
  const h = transitionHarness()
  const focus = h.change('compact', h.commitPage)
  const failed = assert.rejects(focus, /native focus failed/)
  assert.equal(h.calls[0].command, 'show_chat_window')
  h.calls[0].reject(new Error('native focus failed'))
  await failed
  assert.deepEqual(h.errors, ['切换面板失败，请重试。'], 'native focus rejection retains visible failure feedback')
  assert.equal(h.events.filter(event => event[0] === 'focus-request').length, 0, 'failed native activation must not request control focus')
  assert.deepEqual(h.commits, [['settings']], 'focus rejection must not roll back an already committed page')
  assert.equal(h.bindings.chatModeRef.current, 'compact')
  assert.equal(h.bindings.modeTransitionRef.current, false)
}
{
  const h = transitionHarness()
  const focus = h.change('compact')
  const close = h.change('closed')
  assert.equal(h.calls.length, 1, 'close must wait for the pending same-open focus command')
  assert.equal(h.calls[0].command, 'show_chat_window')
  h.calls[0].resolve()
  await tick()
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[1].command, 'set_pet_chat_mode')
  assert.equal(h.calls[1].mode, 'closed')
  h.calls[1].resolve()
  await Promise.all([focus, close])
  assert.equal(h.bindings.chatModeRef.current, 'closed')
  assert.equal(h.bindings.modeWaitersRef.current.length, 0)
}
console.log('same-mode actual handler: closed stays hidden; focus failure rejects visibly without page rollback; later close is serialized')

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
  assert.equal(h.events.filter(event => event[0] === 'paint').length, 0, 'cold open does not wait for a hidden WebView RAF')
  const shown = h.events.findIndex(event => event[0] === 'invoke' && event[1] === 'show_chat_window')
  const measured = h.events.findIndex(event => event[0] === 'viewport')
  const bounds = h.events.findIndex(event => event[0] === 'hit-bounds')
  assert.ok(shown >= 0 && shown < measured && measured < bounds, 'native reveal precedes viewport observation, then actual hit bounds')
  assert.ok(h.events.some(event => event[0] === 'focus-request'), 'cold open requests actual control focus after activation')
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
  const result = wait({ width: 940, height: 760 })
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
  const rejected = assert.rejects(opening, /尚未就绪/)
  await tick()
  h.calls[0].resolve()
  await tick()
  assert.equal(h.calls[1].command, 'show_chat_window')
  h.calls[1].resolve()
  await tick()
  assert.deepEqual(h.calls.map(call => call.mode), ['compact', undefined, 'closed'])
  h.calls[2].resolve()
  await rejected
  assert.equal(h.bindings.chatModeRef.current, 'closed')
  assert.equal(h.bindings.modeTransitionRef.current, false)
  assert.equal(h.bindings.preparing, false)
}
console.log('unready initial viewport restores native closed frame, React mode and interaction guards')

{
  const h = transitionHarness()
  h.bindings.chatModeRef.current = 'closed'
  const opening = h.change('compact')
  const rejected = assert.rejects(opening, /已隐藏/)
  h.bindings.hiddenRef.current = true
  h.bindings.visibilityEpochRef.current += 1
  h.calls[0].resolve()
  await tick()
  assert.equal(h.calls[1].command, 'set_pet_chat_mode')
  assert.equal(h.calls[1].mode, 'closed')
  h.calls[1].resolve()
  await rejected
  assert.ok(!h.calls.some(call => call.command === 'show_chat_window'), 'a native hide cancels an in-flight prepare before reveal')
  assert.equal(h.bindings.chatModeRef.current, 'closed')
  assert.equal(h.bindings.modeTransitionRef.current, false)
}
console.log('hide during preparation cancels reveal, restores closed mode and releases pending work')

for (const restored of [false, true]) {
  const bounds = deferred()
  const h = transitionHarness(true, () => bounds.promise)
  const changing = h.change('expanded')
  const rejected = assert.rejects(changing, /已隐藏/)
  await tick()
  h.bindings.hiddenRef.current = true
  h.bindings.visibilityEpochRef.current += 1
  h.bindings.chatModeRef.current = 'closed'
  if (restored) {
    h.bindings.hiddenRef.current = false
    h.bindings.visibilityEpochRef.current += 1
  }
  bounds.resolve()
  await rejected
  assert.ok(!h.events.some(event => event[0] === 'emit'), 'a hidden or superseded visible transition cannot publish an obsolete open commit')
  assert.equal(h.bindings.chatModeRef.current, 'closed', 'hide/recovery keeps the chat closed')
  assert.equal(h.bindings.modeTransitionRef.current, false)
}
console.log('hide and hide/recovery during open-to-open bounds update invalidate the old commit')


const native = readFileSync('src-tauri/src/lib.rs', 'utf8')
const resizing = native.slice(native.indexOf('fn set_pet_chat_mode'), native.indexOf('fn pet_drag_origin'))
assert.ok(resizing.includes('!state.visible.load(Ordering::Relaxed)'), 'fit backing only while hidden')
assert.ok(resizing.includes('place_window(&app, "chat", layout.chat, true)'), 'chat receives work-area fitted dimensions')
assert.ok(!resizing.includes('place_window(&app, "main"'), 'opening chat leaves the cat rectangle untouched')
assert.ok(!resizing.includes('pet.set_size'))
assert.ok(!native.includes('addChildWindow'))
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
    visibilityEpochRef: { current: 0 }, hiddenRef: { current: false },
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

assert.ok(/if let Some\(chat\) = app.get_webview_window\("chat"\) \{\s*chat.hide\(\)\?;/.test(native), 'chat starts hidden')
assert.ok(source.includes('actionError={panelError}'), 'opening failures remain actionable at the pet controls')

{
  const dragSource = readFileSync('src/lib/usePetGroupDrag.ts', 'utf8')
  const code = extractFunction(dragSource, 'usePetGroupDrag').replace('export function', 'function')
  const calls = [], errors = []
  class Element {}
  class HTMLElement extends Element { getAttribute() { return null } }
  const bindings = {
    Element, HTMLElement,
    markMotionDiagnostic: () => {},
    getFrameVisualBounds: frame => frame.getBoundingClientRect(),
    useRef: value => ({ current: value }), useEffect() {}, isTauri: () => true,
    crypto: { randomUUID: () => String(calls.length) },
    invoke(command, args) { const call = { command, args, ...deferred() }; calls.push(call); return call.promise },
  }
  const useDrag = new Function(...Object.keys(bindings), `${code}; return usePetGroupDrag`)(...Object.values(bindings))
  const handlers = useDrag({ onError: cause => errors.push(cause) })
  const target = Object.assign(new HTMLElement(), { setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {} })
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
  assert.ok(hook.includes('FRAME_MORPH_MS = 240'), 'fallback crossfade fits the shared240ms motion budget')
  assert.ok(hook.includes("motionDuration(root, 'exit', 160)"), 'outgoing ghost follows the shared exit timing' )
  assert.ok(hook.includes("motionDuration(root, 'slow', FRAME_MORPH_MS)"), 'incoming shell follows the shared slow timing' )
  assert.ok(hook.includes('cubic-bezier(0.4, 0, 0.2, 1)'), 'ghost fade uses the standard curve')
  assert.ok(hook.includes('easing: MOTION_EASE_OUT'), 'destination fade-in uses the shared exponential easing')
  assert.ok(hook.includes("finishWatchdog") && hook.includes("morph-watchdog"), 'a watchdog settles the morph when an occluded WebView suspends the animation timeline')
  assert.ok(hook.includes('dataset.frameMorphing'), 'the CSS relief attribute lifecycle stays')
  assert.ok(hook.includes('chat-frame-bounds'), 'start/end hit-bounds notifications stay')
  assert.ok(hook.includes('activeRef.current?.cancel()'), 'rapid toggling cancels the previous ghost and animations first')
}
console.log('frame morph contract: WAAPI transform/opacity crossfade only; no SMIL, clip-path or per-frame IPC')

// Execute the production morph layout effect with isolated clocks/DOM/WAAPI.
// This verifies lifecycle behavior, not native paint or compositor smoothness.
function morphHarness({ incoming = 240, outgoing = 160, reduced = false, fonts } = {}) {
  const hookSource = readFileSync('src/components/useFrameMorph.ts', 'utf8')
  const hookAst = ts.createSourceFile('useFrameMorph.ts', hookSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const hook = hookAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'useFrameMorph')
  const effect = hook.body.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(hookAst) === 'useLayoutEffect').expression.arguments[0]
  const constants = hookAst.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(hookAst).startsWith('FRAME_MORPH_'))).map(node => node.getText(hookAst).replace(/^export /, '')).join('\n')
  const effectCode = ts.transpile(`${constants}\nconst run = ${effect.getText(hookAst)}`, { target: ts.ScriptTarget.ES2022 })
  const frames = new Map(), timers = new Map(), animations = [], ghosts = [], marks = [], bounds = [], geometries = []
  let now = 0, next = 0
  const window = {
    matchMedia: () => ({ matches: reduced }),
    requestAnimationFrame(callback) { const id = ++next; frames.set(id, callback); return id },
    cancelAnimationFrame(id) { frames.delete(id) },
    setTimeout(callback, ms) { const id = ++next; timers.set(id, { callback, at: now + ms }); return id },
    clearTimeout(id) { timers.delete(id) },
  }
  const node = name => ({
    style: {},
    querySelectorAll: () => [],
    animate(keyframes, options) {
      const pending = deferred()
      const animation = { name, keyframes, options, finished: pending.promise, resolve: pending.resolve, cancelCount: 0,
        cancel() { this.cancelCount++; pending.reject(new Error('isolated animation cancellation')) } }
      animations.push(animation)
      return animation
    },
  })
  const svg = node('svg'), surface = node('surface')
  const from = { x: 240, y: 400, width: 475, height: 278 }, to = { x: 40, y: 40, width: 676, height: 665 }
  const root = {
    dataset: {}, getBoundingClientRect: () => to,
    querySelector: selector => selector === '.chat-bubble-shell' ? svg : selector === '.chat-panel-surface' ? surface : null,
    append(ghost) { ghosts.push(ghost) }, dispatchEvent(event) { bounds.push(event.detail) },
  }
  const document = {
    fonts: fonts ? { ready: fonts.promise } : undefined, timeline: { currentTime: 17 },
    createElement() { return { ...node('ghost'), append() {}, removed: false, remove() { this.removed = true } } },
  }
  const bindings = {
    rootRef: { current: root }, previousRef: { current: { variant: 'compact', rect: from } }, activeRef: { current: null }, morphingRef: { current: false },
    visible: true, enabled: true, onFrame: geometry => geometries.push(geometry), window, document,
    getComputedStyle: () => ({ position: 'absolute' }), motionDiagnosticMode: () => 'normal', markMotionDiagnostic: mark => marks.push(mark),
    motionDuration: (_root, token) => token === 'slow' ? incoming : outgoing, MOTION_EASE_OUT: 'isolated-easing',
    isolatedClone: () => node('clone'), dockAnchorOrigin: () => '100% 100%',
    CustomEvent: class { constructor(_name, options) { this.detail = options.detail } },
  }
  const run = (variant = 'expanded') => new Function(...Object.keys(bindings), 'variant', `${effectCode}; return run()`)(...Object.values(bindings), variant)
  const advance = ms => {
    const until = now + ms
    for (;;) {
      const due = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      timers.delete(due[0]); now = due[1].at; due[1].callback()
    }
    now = until
  }
  const frame = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(now)) }
  run()
  return { run, advance, frame, frames, timers, animations, ghosts, marks, bounds, geometries, bindings, svg, surface, from, to, root }
}
function assertMorphClean(h) {
  assert.equal(h.frames.size, 0)
  assert.equal(h.timers.size, 0)
  assert.equal(h.svg.style.opacity, '')
  assert.equal(h.surface.style.opacity, '')
  assert.equal(h.root.dataset.frameMorphing, undefined)
  assert.equal(h.bindings.morphingRef.current, false)
  assert.ok(h.ghosts.every(ghost => ghost.removed))
}
for (const framesReceived of [0, 1]) {
  const fonts = deferred(), h = morphHarness({ fonts })
  const staleFrame = [...h.frames.values()][0]
  if (framesReceived) h.frame()
  h.advance(199)
  assert.equal(h.svg.style.opacity, '0')
  h.advance(1)
  assert.equal(h.animations.length, 0, 'incomplete paint callbacks must reveal final geometry without starting WAAPI')
  assert.deepEqual(h.bounds, [h.from, h.to], 'no-paint recovery publishes the committed final hit bounds')
  assert.ok(h.marks.includes('morph-paint-timeout'))
  assert.ok(!h.marks.includes('morph-start'))
  fonts.resolve(); staleFrame(); await tick()
  assertMorphClean(h)
}
{
  const fonts = deferred(), h = morphHarness({ fonts })
  h.frame(); h.frame()
  assert.equal(h.animations.length, 0, 'healthy paint still waits for observable fonts')
  fonts.resolve(); await tick()
  assert.equal(h.animations.length, 3)
  assert.ok(h.animations.every(animation => animation.startTime === 17), 'healthy animations keep their shared timeline')
  h.animations[0].resolve(); h.animations[1].resolve(); await tick()
  assert.equal(h.ghosts[0].removed, false, 'natural finish waits for every effect')
  h.animations[2].resolve(); await tick()
  assert.deepEqual(h.bounds, [h.from, h.to])
  assert.ok(h.marks.includes('morph-end'))
  assert.ok(!h.marks.includes('morph-watchdog'))
  assertMorphClean(h)
}
{
  const h = morphHarness({ fonts: deferred() })
  h.frame(); h.frame(); h.advance(200)
  assert.equal(h.animations.length, 3, 'the existing font deadline starts animation when both paint callbacks arrived')
  h.animations.forEach(animation => animation.resolve()); await tick()
  assertMorphClean(h)
}
for (const options of [{ incoming: 240, outgoing: 160 }, { incoming: 180, outgoing: 460 }, { reduced: true, incoming: 800, outgoing: 900 }]) {
  const h = morphHarness(options)
  h.frame(); h.frame()
  const longestEffect = Math.max(...h.animations.map(animation => animation.options.duration))
  h.advance(longestEffect + 79)
  assert.equal(h.ghosts[0].removed, false, 'watchdog must cover every actual effect plus its grace')
  h.advance(1)
  assert.ok(h.marks.includes('morph-watchdog'))
  assert.deepEqual(h.bounds, [h.from, h.to])
  assertMorphClean(h)
  await tick()
}
{
  const h = morphHarness()
  h.frame(); h.frame()
  const oldAnimations = [...h.animations]
  // Fulfilled effects queue their completion microtask just before re-entry.
  oldAnimations.forEach(animation => animation.resolve())
  h.run('compact')
  const replacement = h.bindings.activeRef.current
  await tick()
  assert.equal(h.bindings.activeRef.current, replacement, 'stale completion cannot clear the replacement morph')
  assert.equal(h.ghosts[1].removed, false)
  assert.equal(h.bounds.length, 2, 'cancelled old morph must not publish stale final bounds')
  replacement.cancel()
  h.advance(2000); await tick()
  assert.ok(!h.marks.includes('morph-end') && !h.marks.includes('morph-watchdog'))
  assertMorphClean(h)
}
console.log('actual morph lifecycle: no-paint recovery, font gate, natural finish, duration-bound stall recovery, reduced motion and stale cancellation passed')
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

// A final drag refit must settle any old morph and publish the new geometry
// in the same layout transaction, with no per-pointer-move resize path.
{
  const frame = readFileSync('src/components/ChatBubbleFrame.tsx', 'utf8')
  const steps = []
  const bounds = { x: 16, y: 16, width: 400, height: 365 }
  const root = { offsetWidth: 400, offsetHeight: 365,
    dispatchEvent(event) { steps.push(event.type) }, getBoundingClientRect() { return bounds } }
  class Event { constructor(type) { this.type = type } }
  class CustomEvent extends Event { constructor(type, options) { super(type); this.detail = options.detail } }
  const bindings = { root, Event, CustomEvent, flushSync(callback) { steps.push('flush'); callback() },
    update(width, height) { assert.deepEqual([width, height], [400, 365]); steps.push('geometry') } }
  const resize = new Function(...Object.keys(bindings), `${extractFunction(frame, 'resizeViewport')}; return resizeViewport`)(...Object.values(bindings))
  resize()
  assert.deepEqual(steps, ['chat-frame-viewport-resize', 'flush', 'geometry', 'chat-frame-bounds'])
  const move = native.slice(native.indexOf('fn move_pet_group_on_main'), native.indexOf('fn show_chat_window'))
  assert.ok(!move.includes(', true)'), 'pointer movement never resizes a backing')
  const end = native.slice(native.indexOf('fn end_pet_group_drag'), native.indexOf('struct PanelViewport'))
  assert.ok(end.includes('align_visible_chat(&app)?'))
  const align = native.slice(native.indexOf('fn align_visible_chat'), native.indexOf('async fn set_pet_chat_mode'))
  assert.ok(align.includes('needs_refit(chat, display)'))
  assert.ok(align.includes('place_window(app, "chat", target, resize)'))
  assert.ok(align.includes('"pet-panel:viewport-changed"'))
}
console.log('drag-end refit: one final native fit, cancelled old morph, synchronous perimeter and fresh hit bounds')
