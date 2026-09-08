import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
assert.ok(source.includes('visible={!panelPreparing}'))
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
function transitionHarness(viewportReady = true) {
  const calls = [], errors = [], commits = []
  let currentCommit = null
  const bindings = {
    chatModeRef: { current: 'compact' }, modeTransitionRef: { current: false },
    pendingCommitRef: { current: undefined }, pendingModeRef: { current: null }, modeWaitersRef: { current: [] },
    flushSync: callback => { currentCommit = []; callback(); commits.push(currentCommit); currentCommit = null }, setModeTransitioning() {}, setPanelEntering() {},
    setPanelPreparing(value) { bindings.preparing = value }, setChatMode: mode => currentCommit?.push(mode), setError: error => errors.push(error),
    waitForWindowPaint: async () => {}, waitForPanelViewport: async () => viewportReady,
    invoke: (_command, { mode }) => { const call = { mode, ...deferred() }; calls.push(call); return call.promise },
  }
  const change = new Function(...Object.keys(bindings), `${extractFunction(source, 'changePetChatMode')}; return changePetChatMode`)(...Object.values(bindings))
  return { change, calls, bindings, errors, commits, commitPage: () => currentCommit?.push('settings') }
}
{
  const h = transitionHarness()
  const first = h.change('expanded')
  const queued = h.change('compact')
  const rejected = assert.rejects(queued, /native failed/)
  assert.equal(h.calls.length, 1, 'IPC remains serialized')
  h.calls[0].resolve()
  await tick()
  assert.equal(h.calls[1].mode, 'compact')
  h.calls[1].reject(new Error('native failed'))
  await first
  await rejected
  assert.equal(h.bindings.chatModeRef.current, 'expanded', 'failed transition restores committed mode')
  assert.equal(h.bindings.modeTransitionRef.current, false)
  assert.ok(h.errors.length)
  const retry = h.change('compact')
  h.calls[2].resolve()
  await retry
  assert.equal(h.bindings.chatModeRef.current, 'compact')
}
{
  const h = transitionHarness()
  const first = h.change('expanded')
  const intermediate = h.change('compact')
  const last = h.change('closed')
  h.calls[0].resolve()
  await tick()
  assert.deepEqual(h.calls.map(call => call.mode), ['expanded', 'closed'])
  h.calls[1].resolve()
  await Promise.all([first, intermediate, last])
  assert.equal(h.bindings.chatModeRef.current, 'closed')
  assert.equal(h.bindings.modeWaitersRef.current.length, 0)
}
{
  const panel = readFileSync('src/components/ChatPanel.tsx', 'utf8')
  const expansion = deferred(), updates = []
  const bindings = {
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
  assert.deepEqual(updates, ['closed'], 'late resize completion cannot reopen settings after close')
}
console.log('actual transition handlers: queued failure propagation, retry, final intent, serialized IPC and close invalidation passed')

{
  const h = transitionHarness()
  const transition = h.change('expanded', h.commitPage)
  h.calls[0].resolve()
  await transition
  assert.ok(h.commits.some(commit => JSON.stringify(commit) === JSON.stringify(['expanded', 'settings'])), 'destination and expanded layout share the same explicit flush')
  const count = h.calls.length
  await h.change('expanded', h.commitPage)
  assert.equal(h.calls.length, count, 'same-size navigation needs no native resize')
  assert.deepEqual(h.commits.at(-1), ['settings'])
}
console.log('destination content and native mode commit atomically; same-size page navigation bypasses IPC')

{
  const h = transitionHarness()
  h.bindings.chatModeRef.current = 'closed'
  const opening = h.change('compact')
  await tick()
  h.calls[0].resolve()
  await opening
  assert.equal(h.bindings.chatModeRef.current, 'compact')
}

// The viewport gate observes renderer dimensions, and never calls timeout ready.
for (const scenario of ['ready', 'resize', 'timeout']) {
  let resized, timer, removed = false
  const window = {
    innerWidth: scenario === 'ready' ? 713 : 232, innerHeight: scenario === 'ready' ? 401 : 381,
    setTimeout(callback) { timer = callback; return 1 }, clearTimeout() {},
    addEventListener(_name, callback) { resized = callback },
    removeEventListener() { removed = true },
  }
  const wait = new Function('window', `${extractFunction(source, 'waitForPanelViewport')}; return waitForPanelViewport`)(window)
  const result = wait('compact')
  if (scenario === 'resize') { window.innerWidth = 713; window.innerHeight = 401; resized() }
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
