import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { isNearChatBottom, safeMessageUrl, shouldSubmitComposer } from '../src/lib/chat-interaction.ts'

const enter = { key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13, compositionActive: false, timeStamp: 1000, compositionEndedAt: -Infinity }
assert.equal(shouldSubmitComposer(enter), true)
for (const change of [{ shiftKey: true }, { isComposing: true }, { compositionActive: true }, { keyCode: 229 }, { key: 'Escape' }, { compositionEndedAt: 990 }])
  assert.equal(shouldSubmitComposer({ ...enter, ...change }), false)
assert.equal(shouldSubmitComposer({ ...enter, compositionEndedAt: 900 }), true)
assert.equal(isNearChatBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 540 }), true)
assert.equal(isNearChatBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 300 }), false)
assert.equal(isNearChatBottom({ scrollHeight: 400, clientHeight: 400, scrollTop: -10 }), true)
assert.equal(isNearChatBottom({ scrollHeight: 1500, clientHeight: 400, scrollTop: 300 }), false, 'stream growth must not re-enable history following')
for (const url of ['javascript:alert(1)', 'data:text/html,<script>x</script>', 'file:///etc/passwd', '//example.com', '/internal', 'https://user:secret@example.com', 'java\nscript:alert(1)', 'https://example.com\u0000', 'https://'])
  assert.equal(safeMessageUrl(url), undefined, url)
assert.equal(safeMessageUrl('https://例子.中国/说明?q=橘伴'), new URL('https://例子.中国/说明?q=橘伴').href)
assert.equal(safeMessageUrl('https://example.com/a?q=hello%20world'), 'https://example.com/a?q=hello%20world')
assert.equal(safeMessageUrl('mailto:hello@example.com'), 'mailto:hello@example.com')

// Exercise the actual local submission handlers without mounting a product
// preview or invoking native/service APIs. Extract their AST nodes rather than
// maintaining a second implementation of the acknowledgement race logic.
const panelSource = ts.createSourceFile('ChatPanel.tsx', readFileSync(new URL('../src/components/ChatPanel.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function localHandler(name, bindings, sourceFile = panelSource) {
  let declaration
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  assert.ok(declaration, `Missing actual handler: ${name}`)
  const source = ts.transpileModule(declaration.getText(sourceFile), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(bindings), `${source}; return ${name}`)(...Object.values(bindings))
}

// Isolated viewport contracts exercise the real reading handlers and the named
// post-commit callback. This does not emulate React or claim native scrolling.
const readingSource = ts.createSourceFile('useChatReading.ts', readFileSync(new URL('../src/components/useChatReading.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const readingHook = readingSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'useChatReading')
const readingEffects = readingHook.body.statements.filter(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(readingSource) === 'useLayoutEffect').map(node => ({
  callback: node.expression.arguments[0], dependencies: node.expression.arguments[1].elements.map(element => element.getText(readingSource)),
}))
function readingHarness() {
  const scrolls = [], observers = [], blocks = []
  const list = {
    scrollHeight: 1000, clientHeight: 400, scrollTop: 300, clientTop: 0,
    getBoundingClientRect() { return { top: 100, bottom: 100 + this.clientHeight } },
    scrollTo({ top, behavior }) { assert.equal(behavior, 'instant'); this.scrollTop = Math.max(0, Math.min(top, this.scrollHeight - this.clientHeight)); scrolls.push(this.scrollTop) },
    contains() { return false }, focus() { assert.fail('Accepted send must not move focus from the composer') },
  }
  const refs = {
    listRef: { current: list }, contentRef: { current: { querySelectorAll: () => blocks, contains: element => blocks.includes(element) } }, followingRef: { current: false }, upwardReadingRef: { current: false }, topRef: { current: list.scrollTop },
    readingIntentRef: { current: 0 }, pendingSendRevealRef: { current: null }, prependedRef: { current: null }, layoutAnchorRef: { current: null },
  }
  let revealVersion = 0, showLatest = true
  const bindings = { ...refs, active: true, sessionKey: '', layoutVersion: false, isNearChatBottom, document: { activeElement: null },
    ResizeObserver: class {
      targets = []
      disconnected = false
      constructor(callback) { this.callback = callback; observers.push(this) }
      observe(target) { this.targets.push(target) }
      disconnect() { this.disconnected = true }
    },
    setSendRevealVersion: update => { revealVersion = update(revealVersion) },
    setShowLatest: value => { showLatest = value },
  }
  const invalidateSendReveal = localHandler('invalidateSendReveal', bindings, readingSource)
  const followLatest = localHandler('followLatest', bindings, readingSource)
  const captureSendIntent = localHandler('captureSendIntent', bindings, readingSource)
  const revealAcceptedSend = localHandler('revealAcceptedSend', bindings, readingSource)
  const onScroll = localHandler('onScroll', { ...bindings, invalidateSendReveal }, readingSource)
  const pauseForUpwardReading = localHandler('pauseForUpwardReading', { ...bindings, invalidateSendReveal }, readingSource)
  const prepareHistoryPrepend = localHandler('prepareHistoryPrepend', { ...bindings, invalidateSendReveal }, readingSource)
  const prepareLayoutChange = localHandler('prepareLayoutChange', bindings, readingSource)
  const cancelLayoutChange = localHandler('cancelLayoutChange', bindings, readingSource)
  const returnToLatest = localHandler('returnToLatest', { ...bindings, invalidateSendReveal, followLatest }, readingSource)
  const commit = (active = true) => localHandler('commitReadingUpdate', { ...bindings, active, followLatest }, readingSource)()
  const cleanups = new Map()
  // Execute the actual effect callbacks selected by their actual dependency
  // names. No React state/render simulation or native layout is claimed.
  const layoutCommit = (changed, active = true) => {
    const selected = readingEffects.filter(effect => effect.dependencies.some(dependency => changed.includes(dependency)))
    selected.forEach(effect => { cleanups.get(effect)?.(); cleanups.delete(effect) })
    const scope = { ...bindings, active, invalidateSendReveal, followLatest, commitReadingUpdate: () => commit(active) }
    for (const effect of selected) {
      const code = ts.transpileModule(`const effect = ${effect.callback.getText(readingSource)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
      const cleanup = new Function(...Object.keys(scope), `${code}; return effect()`)(...Object.values(scope))
      if (cleanup) cleanups.set(effect, cleanup)
    }
  }
  const resize = () => observers.filter(observer => !observer.disconnected).forEach(observer => observer.callback())
  const addBlock = (top, height = 80) => {
    const block = { top, height, width: 300, getBoundingClientRect() { const top = 100 + list.clientTop + this.top - list.scrollTop; return { top, bottom: top + this.height, height: this.height, width: this.width } } }
    blocks.push(block)
    return block
  }
  return { list, refs, blocks, addBlock, scrolls, observers, document: bindings.document, captureSendIntent, revealAcceptedSend, invalidateSendReveal, onScroll, pauseForUpwardReading, prepareHistoryPrepend, prepareLayoutChange, cancelLayoutChange, returnToLatest, commit, layoutCommit, resize,
    setLayoutVersion: value => { bindings.layoutVersion = value },
    revealVersion: () => revealVersion, showLatest: () => showLatest }
}

// Run the real control-focus handlers with isolated DOM contracts; these are
// not native WebView input-delivery or OS focus observations.
for (const page of ['chat', 'settings', 'todos', 'memos']) {
  const focused = []
  class FocusElement {
    blocked = false
    disabled = false
    painted = true
    value = 'unsent draft'
    selectionStart = 2
    selectionEnd = 5
    constructor(name) { this.name = name }
    focus(options) { assert.deepEqual(options, { preventScroll: true }); focused.push(this.name) }
    closest(selector) { assert.equal(selector, '[hidden], [inert]'); return this.blocked ? {} : null }
    matches(selector) { assert.equal(selector, ':disabled'); return this.disabled }
    getClientRects() { return this.painted ? [{}] : [] }
  }
  const editor = new FocusElement(`${page}-existing-control`)
  const document = { activeElement: editor }
  const owned = new Set([editor])
  const panel = { contains: element => owned.has(element) }
  const focusCurrentView = localHandler('focusCurrentView', {
    settingsOpen: page === 'settings', page: page === 'settings' ? 'chat' : page,
    settingsListRef: { current: { querySelector: () => new FocusElement('settings-default') } },
    backButtonRef: { current: new FocusElement(`${page}-default`) },
    inputRef: { current: new FocusElement('chat-default') },
  })
  const bindings = {
    visible: true, document, HTMLElement: FocusElement, focusCurrentView,
    messageListRef: { current: { closest: selector => { assert.equal(selector, '.chat-panel'); return panel } } },
  }
  const restore = localHandler('restoreCurrentViewFocus', bindings)
  restore()
  assert.deepEqual(focused.splice(0), [`${page}-existing-control`], 'valid current-page controls regain focus instead of moving to composer')
  const openingFocusPendingRef = { current: true }
  const activated = localHandler('restoreActivatedViewFocus', { visible: true, openingFocusPendingRef, focusCurrentView, restoreCurrentViewFocus: restore })
  activated()
  assert.deepEqual(focused.splice(0), [`${page}-default`], 'the first native activation replaces WebKit automatic first-control focus with the page default')
  assert.equal(openingFocusPendingRef.current, false)
  activated()
  assert.deepEqual(focused.splice(0), [`${page}-existing-control`], 'later native activation preserves a valid current control')
  openingFocusPendingRef.current = true
  localHandler('restoreActivatedViewFocus', { visible: false, openingFocusPendingRef, focusCurrentView, restoreCurrentViewFocus: restore })()
  assert.equal(openingFocusPendingRef.current, true, 'hidden activation cannot consume the next visible default focus')
  assert.deepEqual(focused, [])
  assert.equal(editor.value, 'unsent draft')
  assert.deepEqual([editor.selectionStart, editor.selectionEnd], [2, 5], 'reactivation preserves the editable selection')
  for (const reason of ['hidden-ancestor', 'disabled', 'unpainted', 'detached']) {
    editor.blocked = reason === 'hidden-ancestor'
    editor.disabled = reason === 'disabled'
    editor.painted = reason !== 'unpainted'
    if (reason === 'detached') owned.delete(editor)
    restore()
    assert.deepEqual(focused.splice(0), [`${page}-default`], `${reason} controls use the current page default`)
  }
  localHandler('restoreCurrentViewFocus', { ...bindings, visible: false })()
  assert.deepEqual(focused, [], 'hidden panels must not take keyboard focus')
}

// Explicit reading and utility navigation use the actual handlers. The host
// commits a real page intent once even if it invokes its callback before return.
for (const initialExpanded of [false, true]) {
  let expanded = initialExpanded, page = 'chat', settingsOpen = false
  const requests = [], pageIntentRef = { current: 0 }, returnExpandedRef = { current: initialExpanded }
  const settingsReturnRef = { current: { page: 'chat', expanded: initialExpanded } }
  const pendingNavigationRef = { current: null }
  const reading = readingHarness(), savingRef = { current: false }
  const changePage = localHandler('changePage', {
    reading, pageIntentRef, pendingNavigationRef,
    onExpandedChange: async (next, commit) => { expanded = next; requests.push(next); commit() },
  })
  function call(name) {
    return localHandler(name, {
      companion: true, expanded, page, settingsOpen, todosOpen: page === 'todos', memosOpen: page === 'memos',
      savingRef, returnExpandedRef, settingsReturnRef, pendingNavigationRef, changePage, reading,
      setPage: value => { page = value }, setSettingsOpen: value => { settingsOpen = value },
      setSettingsSuccess() {}, setSettingsError() {},
      returnToChat: () => call('returnToChat'), openMemos: () => call('openMemos'),
      stayOnCurrentPage: () => call('stayOnCurrentPage'),
    })()
  }
  await call('returnToChat')
  assert.deepEqual(requests, [], 'The selected chat tab does not trigger a native size transaction')
  await call('openSettings')
  assert.equal(expanded, true)
  assert.equal(settingsOpen, true)
  await call('openSettings')
  assert.equal(requests.length, 1, 'Repeated settings activation does not leave settings or overwrite its origin')
  await call('toggleTodos')
  assert.equal(page, 'todos')
  assert.equal(settingsOpen, false)
  await call('toggleTodos')
  assert.equal(requests.length, 2, 'The selected Todo tab stays on Todo')
  await call('openMemos')
  assert.equal(page, 'memos')
  await call('toggleMemos')
  assert.equal(requests.length, 3, 'The selected Memo tab stays on Memo')
  assert.equal(returnExpandedRef.current, initialExpanded, 'Switching utility pages retains the original conversation size')
  await call('returnToChat')
  assert.equal(expanded, initialExpanded)
  assert.equal(page, 'chat')
  assert.equal(settingsOpen, false)
  assert.deepEqual(requests, [true, true, true, initialExpanded])
  await call('toggleReadingView')
  assert.equal(expanded, !initialExpanded, 'Only an explicit reading action changes the conversation size')
  assert.equal(page, 'chat')
}

// Settings is a utility detour. Its back/Escape path restores the captured
// source, while the explicit Chat tab still restores the conversation size.
for (const origin of ['chat', 'todos', 'memos']) for (const initialExpanded of [false, true]) {
  let page = origin, expanded = initialExpanded, settingsOpen = false
  const requests = [], savingRef = { current: false }, returnExpandedRef = { current: false }
  const settingsReturnRef = { current: { page: 'chat', expanded: false } }
  const pendingNavigationRef = { current: null }
  const changePage = async (target, commit) => { requests.push(target); expanded = target; commit() }
  function call(name) {
    return localHandler(name, {
      companion: true, page, expanded, settingsOpen, savingRef, returnExpandedRef, settingsReturnRef, pendingNavigationRef, changePage,
      setPage: value => { page = value }, setSettingsOpen: value => { settingsOpen = value },
      setSettingsError() {}, setSettingsSuccess() {}, returnToChat: () => call('returnToChat'),
      stayOnCurrentPage: () => call('stayOnCurrentPage'),
    })()
  }
  await call('openSettings')
  assert.deepEqual(settingsReturnRef.current, { page: origin, expanded: initialExpanded })
  await call('openSettings')
  assert.deepEqual(settingsReturnRef.current, { page: origin, expanded: initialExpanded }, 'Repeated activation must not replace the original page')
  savingRef.current = true
  call('returnFromSettings')
  assert.equal(settingsOpen, true, 'Saving settings blocks back/Escape navigation')
  savingRef.current = false
  call('returnFromSettings')
  assert.equal(page, origin)
  assert.equal(expanded, initialExpanded)
  assert.equal(settingsOpen, false)
  assert.deepEqual(requests, [true, initialExpanded])
  await call('openSettings')
  call('returnToChat')
  assert.equal(page, 'chat', 'Explicit Chat means Chat, not the settings origin')
  assert.equal(expanded, origin === 'chat' ? initialExpanded : false)
}

// Actual handlers with deferred host commits: the host replaces queued page
// callbacks while a native transition is settling. This is an isolated host
// contract, not a native runtime test.
function queuedNavigationHarness(initialPage, initialExpanded, settingsOrigin = null) {
  let page = initialPage, expanded = initialExpanded, settingsOpen = settingsOrigin !== null
  const requests = [], pageIntentRef = { current: 0 }, pendingNavigationRef = { current: null }
  const savingRef = { current: false }, returnExpandedRef = { current: false }
  const settingsReturnRef = { current: settingsOrigin ?? { page: 'chat', expanded: initialExpanded } }
  const reading = { invalidateSendReveal() {}, prepareLayoutChange() {}, cancelLayoutChange() {} }
  const changePage = localHandler('changePage', {
    reading, pageIntentRef, pendingNavigationRef,
    onExpandedChange: (target, commit) => new Promise(resolve => requests.push({ target, commit, resolve })),
  })
  function call(name, ...args) {
    return localHandler(name, {
      companion: true, expanded, page, settingsOpen, todosOpen: page === 'todos', memosOpen: page === 'memos',
      savingRef, pageIntentRef, pendingNavigationRef, returnExpandedRef, settingsReturnRef, changePage, reading,
      setPage: value => { page = value }, setSettingsOpen: value => { settingsOpen = value },
      setSettingsSuccess() {}, setSettingsError() {}, markMotionDiagnostic() {}, onClose() {},
      returnToChat: () => call('returnToChat'), openMemos: () => call('openMemos'),
      stayOnCurrentPage: () => call('stayOnCurrentPage'),
    })(...args)
  }
  function commit(index) { expanded = requests[index].target; requests[index].commit() }
  return { call, commit, requests, pendingNavigationRef, returnExpandedRef, settingsReturnRef,
    state: () => ({ page, expanded, settingsOpen }) }
}

for (const initialExpanded of [false, true]) {
  const h = queuedNavigationHarness('chat', initialExpanded)
  const earlier = h.call('toggleTodos')
  h.returnExpandedRef.current = false // A previous utility visit can retain compact here.
  h.call('returnToChat')
  assert.equal(h.requests.length, 2, 'Current Chat replaces a queued Todo destination')
  assert.equal(h.requests[1].target, initialExpanded, 'Cancellation retains the visible size, not an old utility-return size')
  h.requests[0].resolve()
  await earlier
  assert.equal(h.pendingNavigationRef.current?.view, 'chat', 'An old finally cannot clear the replacing navigation')
  assert.equal(h.state().page, 'chat', 'An old fallback commit cannot open Todo')
  h.commit(1)
  assert.equal(h.pendingNavigationRef.current, null, 'Commit clears pending before native tail work settles')
  h.call('returnToChat')
  assert.equal(h.requests.length, 2, 'Already committed Chat is a real no-op during host tail work')
  h.requests[1].resolve()
  await Promise.resolve()
  assert.deepEqual(h.state(), { page: 'chat', expanded: initialExpanded, settingsOpen: false })
}

for (const [origin, queued, retain] of [['todos', 'openMemos', 'toggleTodos'], ['memos', 'toggleTodos', 'openMemos']]) {
  const h = queuedNavigationHarness(origin, true)
  const earlier = h.call(queued)
  h.call(retain)
  assert.equal(h.requests.length, 2, 'Reselecting a current tool cancels the queued other tool')
  h.commit(1)
  h.requests.forEach(request => request.resolve())
  await earlier
  assert.deepEqual(h.state(), { page: origin, expanded: true, settingsOpen: false })
  assert.equal(h.returnExpandedRef.current, false, 'Retaining a tool does not overwrite the original conversation size')
}

{
  const origin = { page: 'memos', expanded: true }
  const h = queuedNavigationHarness('chat', true, origin)
  const earlier = h.call('toggleTodos')
  await h.call('openSettings')
  assert.equal(h.requests.length, 2, 'Current Settings replaces the queued Todo destination')
  assert.equal(h.settingsReturnRef.current, origin, 'Retaining Settings preserves its captured source')
  h.commit(1)
  h.requests.forEach(request => request.resolve())
  await earlier
  assert.deepEqual(h.state(), { page: 'chat', expanded: true, settingsOpen: true })
  h.call('returnFromSettings')
  h.commit(2)
  h.requests[2].resolve()
  await Promise.resolve()
  assert.deepEqual(h.state(), { page: 'memos', expanded: true, settingsOpen: false }, 'Settings Escape/back still returns to Memo after cancellation')
}

{
  const h = queuedNavigationHarness('chat', false)
  const earlier = h.call('toggleTodos')
  h.call('closePanel', 'button')
  assert.equal(h.pendingNavigationRef.current, null, 'Closing invalidates the pending page marker')
  h.requests[0].commit()
  h.requests[0].resolve()
  await earlier
  assert.equal(h.state().page, 'chat', 'A late queued callback cannot navigate after close')
}

{
  let expanded = false
  const calls = []
  const loadEarlier = () => localHandler('loadEarlierMessages', {
    companion: true, expanded,
    toggleReadingView: () => { expanded = true; calls.push('expand') },
    reading: { prepareHistoryPrepend: () => calls.push('anchor') },
    sessionKey: 'isolated', historyCount: 40, HISTORY_PAGE_SIZE: 40,
    setHistoryWindow: next => calls.push(next),
  })()
  loadEarlier()
  assert.deepEqual(calls, ['expand'], 'Compact earlier-history entry opens reading before adding DOM')
  loadEarlier()
  assert.deepEqual(calls, ['expand', 'anchor', { sessionKey: 'isolated', count: 80 }])
}

const composerSource = ts.createSourceFile('ChatComposer.tsx', readFileSync(new URL('../src/components/ChatComposer.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
for (const [start, end, direction] of [[6, 11, 'forward'], [6, 11, 'backward'], [6, 6, 'none']]) {
  const inputRef = { current: null }, selectionRef = { current: null }, restored = []
  const bindInput = localHandler('bindInput', { inputRef, selectionRef }, composerSource)
  const input = { value: 'Focus-check', selectionStart: start, selectionEnd: end, selectionDirection: direction }
  bindInput(input)
  bindInput(null)
  bindInput(null)
  assert.equal(inputRef.current, null, 'secondary pages detach the composer instead of leaving a hidden focus target')
  const replacement = { value: input.value, setSelectionRange: (...range) => restored.push(range) }
  bindInput(replacement)
  assert.equal(inputRef.current, replacement)
  assert.deepEqual(restored, [[start, end, direction]], 'remount restores selected text or collapsed caret with its original direction')
  assert.equal(selectionRef.current, null, 'selection is consumed once, so later refocus cannot replay an old range')
  assert.equal(replacement.value, 'Focus-check', 'restoring selection never rewrites the draft')
  bindInput(replacement)
  assert.equal(restored.length, 1)

  inputRef.current = input
  bindInput(null)
  bindInput({ value: '', setSelectionRange() { assert.fail('a cleared draft must not inherit an obsolete selection') } })
  assert.equal(selectionRef.current, null)
}
const submittedDraftRef = { current: null }
const sendingRef = { current: false }
const originalDraft = '  单元检查草稿\n'
let draft = originalDraft
const reading = readingHarness()
const pageIntentRef = { current: 0 }, mountedRef = { current: true }
const acknowledgeSubmission = localHandler('acknowledgeSubmission', { submittedDraftRef, reading, pageIntentRef, mountedRef, setDraft: update => { draft = update(draft) } })
let resolveAccepted
const accepted = new Promise(resolve => { resolveAccepted = resolve })
let sendCount = 0
let expandedCount = 0
const submit = localHandler('submit', {
  draft: originalDraft, streaming: false, sendingRef, compositionRef: { current: false }, configured: true,
  pageIntentRef, mountedRef, reading,
  status: { connection: 'connected', model_configured: true }, submittedDraftRef, acknowledgeSubmission,
  onSend: content => { sendCount++; assert.equal(content, originalDraft.trim()); return { requestId: 'unit-request', accepted } },
  companion: false, expanded: false, onExpandedChange: value => { assert.equal(value, true); expandedCount++ },
  openSettings: () => { throw new Error('Unexpected settings navigation') },
})
const firstSend = submit({ preventDefault() {} })
await submit({ preventDefault() {} })
assert.equal(sendCount, 1, 'Immediate repeat submit is fenced before a React state commit')
const submitted = submittedDraftRef.current
acknowledgeSubmission(submitted)
assert.equal(draft, '', 'Acceptance clears the matching raw draft including outer whitespace')
draft = originalDraft
resolveAccepted()
await firstSend
assert.equal(draft, originalDraft, 'Late promise acceptance cannot clear a newly entered identical draft')
assert.equal(sendingRef.current, false)
assert.equal(expandedCount, 1)
const newer = { content: '新草稿', requestId: 'unit-new-request', pageIntent: 0, readingIntent: reading.captureSendIntent() }
submittedDraftRef.current = newer
draft = newer.content
acknowledgeSubmission(submitted)
assert.equal(submittedDraftRef.current, newer, 'Old confirmation must not consume a newer request marker')
assert.equal(draft, newer.content)
draft = '已继续编辑'
acknowledgeSubmission(newer)
assert.equal(draft, '已继续编辑', 'Acceptance preserves a changed draft')

// A delayed acceptance cannot reopen a closed panel or override navigation.
for (const action of ['close', 'navigate', 'unmount']) {
  const pageIntentRef = { current: 0 }, mountedRef = { current: true }
  const marker = { current: null }, lock = { current: false }
  const reading = readingHarness()
  let finish, expansions = 0
  const delayed = new Promise(resolve => { finish = resolve })
  const send = localHandler('submit', {
    draft: '验证延迟确认', streaming: false, sendingRef: lock, compositionRef: { current: false }, configured: true,
    pageIntentRef, mountedRef, reading, status: { connection: 'connected', model_configured: true },
    submittedDraftRef: marker, acknowledgeSubmission() {}, companion: false, expanded: false,
    onSend: () => ({ requestId: `unit-${action}`, accepted: delayed }),
    onExpandedChange: () => { expansions++ }, openSettings() {},
  })
  const waiting = send({ preventDefault() {} })
  if (action === 'unmount') mountedRef.current = false
  else pageIntentRef.current++
  finish()
  await waiting
  assert.equal(expansions, 0, `Late acceptance after ${action} must not open the panel`)
  assert.equal(lock.current, false)
}

{
  const lock = { current: false }
  const reading = readingHarness()
  let acknowledged = false
  const send = localHandler('submit', {
    draft: '保留失败草稿', streaming: false, sendingRef: lock, compositionRef: { current: false }, configured: true,
    pageIntentRef: { current: 0 }, mountedRef: { current: true }, reading,
    status: { connection: 'connected', model_configured: true }, submittedDraftRef: { current: null },
    acknowledgeSubmission: () => { acknowledged = true }, companion: true, expanded: false,
    onSend: () => ({ requestId: 'unit-rejected', accepted: Promise.reject(new Error('isolated acceptance failure')) }),
    onExpandedChange() {}, openSettings() {},
  })
  await send({ preventDefault() {} })
  assert.equal(acknowledged, false, 'A rejected submission never clears its draft')
  assert.equal(lock.current, false, 'A rejected submission releases its immediate retry fence')
  reading.commit()
  assert.equal(reading.revealVersion(), 0, 'A failed send never requests successful-send reading behavior')
  assert.equal(reading.list.scrollTop, 300, 'A failed send preserves the historical reading position')
}

for (const expanded of [false, true]) for (const timing of ['ack-before-dom', 'dom-before-ack']) {
  const reading = readingHarness()
  const submittedDraftRef = { current: null }, sendingRef = { current: false }
  const pageIntentRef = { current: 0 }, mountedRef = { current: true }
  let draft = '显式发送', finish, expansions = 0
  const accepted = new Promise(resolve => { finish = resolve })
  const acknowledgeSubmission = localHandler('acknowledgeSubmission', { submittedDraftRef, reading, pageIntentRef, mountedRef, setDraft: update => { draft = update(draft) } })
  const send = localHandler('submit', {
    draft, streaming: false, sendingRef, compositionRef: { current: false }, configured: true,
    pageIntentRef, mountedRef, reading, submittedDraftRef, acknowledgeSubmission,
    status: { connection: 'connected', model_configured: true }, companion: true, expanded,
    onSend: () => ({ requestId: timing, accepted }), onExpandedChange() { expansions++ }, openSettings() {},
  })
  const waiting = send({ preventDefault() {} })
  assert.deepEqual(reading.scrolls, [], 'Submission alone is not acceptance')
  draft = '继续编辑下一条草稿'
  if (timing === 'dom-before-ack') {
    reading.list.scrollHeight = 1400
    reading.commit()
    assert.equal(reading.list.scrollTop, 300, 'An ordinary append does not pull a historical reader to latest')
    assert.equal(reading.showLatest(), true)
  }
  // Snapshot acceptance uses the same actual once-only handler as the Promise.
  acknowledgeSubmission(submittedDraftRef.current)
  assert.equal(draft, '继续编辑下一条草稿', 'Typing the next draft is preserved and does not abandon the send reading intent')
  assert.deepEqual(reading.scrolls, [], 'ACK queues a post-commit reveal, not a pre-commit DOM scroll')
  reading.commit()
  assert.equal(reading.list.scrollTop, reading.list.scrollHeight - reading.list.clientHeight)
  assert.equal(reading.showLatest(), false)
  reading.onScroll()
  assert.equal(reading.captureSendIntent(), 0, 'Programmatic accepted-send scroll does not invalidate itself')
  if (timing === 'ack-before-dom') {
    reading.list.scrollHeight = 1400
    reading.commit()
    assert.equal(reading.list.scrollTop, 1000, 'The accepted message becomes visible when its later DOM append commits')
    reading.onScroll()
    assert.equal(reading.captureSendIntent(), 0)
  }
  reading.list.scrollTop = 200
  reading.onScroll()
  reading.list.scrollHeight = 1800
  reading.commit()
  assert.equal(reading.list.scrollTop, 200, 'Later streaming respects the user returning to history')
  assert.equal(reading.showLatest(), true)
  finish()
  await waiting
  assert.equal(expansions, 0, 'Accepted companion sends preserve both compact and expanded reading sizes')
  assert.equal(reading.revealVersion(), 1, 'The late Promise cannot replay a consumed snapshot acknowledgement')
  reading.commit()
  assert.equal(reading.list.scrollTop, 200)
}

for (const action of ['scroll', 'gesture', 'upward-reading', 'earlier-history', 'navigation', 'unmount']) {
  const reading = readingHarness()
  const pageIntentRef = { current: 0 }, mountedRef = { current: true }
  const submitted = { content: '待确认草稿', requestId: action, pageIntent: 0, readingIntent: reading.captureSendIntent() }
  const submittedDraftRef = { current: submitted }
  const acknowledgeSubmission = localHandler('acknowledgeSubmission', { submittedDraftRef, reading, pageIntentRef, mountedRef, setDraft() {} })
  if (action === 'scroll') { reading.list.scrollTop = 120; reading.onScroll() }
  if (action === 'gesture') reading.invalidateSendReveal()
  if (action === 'upward-reading') reading.pauseForUpwardReading()
  if (action === 'earlier-history') reading.prepareHistoryPrepend()
  if (action === 'navigation') { pageIntentRef.current++; reading.invalidateSendReveal() }
  if (action === 'unmount') mountedRef.current = false
  const top = reading.list.scrollTop
  acknowledgeSubmission(submitted)
  reading.commit()
  assert.equal(reading.revealVersion(), 0, `A newer ${action} intent wins over a pending send's ACK`)
  assert.equal(reading.list.scrollTop, top)
}

{
  const reading = readingHarness()
  reading.revealAcceptedSend(reading.captureSendIntent())
  reading.commit(false)
  assert.equal(reading.list.scrollTop, 300, 'A hidden viewport defers reveal until the chat viewport is active')
  reading.list.scrollHeight = 1400
  reading.commit(true)
  reading.onScroll()
  assert.equal(reading.list.scrollTop, 1000)
  assert.equal(reading.captureSendIntent(), 0, 'Activation scroll must not cancel its own accepted intent')
}

{
  const reading = readingHarness()
  reading.revealAcceptedSend(reading.captureSendIntent())
  reading.invalidateSendReveal()
  reading.commit()
  assert.equal(reading.list.scrollTop, 300, 'A reading gesture after ACK but before commit cancels the queued reveal')
}

{
  const h = readingHarness()
  h.refs.followingRef.current = true
  h.layoutCommit(['active'])
  assert.deepEqual(h.scrolls, [600], 'Activation has exactly one synchronous follow pass')
  assert.deepEqual(h.observers[0].targets, [h.list, h.refs.contentRef.current])
  h.list.scrollHeight = 1400
  h.layoutCommit(['contentVersion'])
  assert.deepEqual(h.scrolls, [600, 1000], 'Content updates still follow once')
  h.layoutCommit(['toolsVersion'])
  assert.equal(h.scrolls.length, 3, 'Tools updates still have one commit owner')
  h.pauseForUpwardReading()
  h.layoutCommit(['sessionKey'])
  assert.equal(h.scrolls.length, 4, 'A session-only change must reset and follow exactly once')
  assert.equal(h.refs.upwardReadingRef.current, false)
  assert.equal(h.observers[0].disconnected, true)
  h.list.scrollHeight = 1600
  h.resize()
  assert.equal(h.scrolls.at(-1), 1200, 'ResizeObserver remains responsible for subsequent content geometry')
  h.layoutCommit(['active'], false)
  const count = h.scrolls.length
  h.resize()
  assert.equal(h.scrolls.length, count, 'Deactivation disconnects size following')
}
{
  const h = readingHarness()
  h.list.scrollTop = 0 // The hidden viewport lost its DOM position.
  h.layoutCommit(['active'])
  assert.deepEqual(h.scrolls, [300], 'A historical reader restores only the saved position')
  h.list.scrollHeight = 1400
  h.layoutCommit(['contentVersion']); h.resize()
  assert.deepEqual(h.scrolls, [300], 'Historical content and size updates remain stationary')
  h.prepareHistoryPrepend()
  h.document.body = {}
  h.document.activeElement = h.document.body
  h.refs.prependedRef.current.restoreFocus = true
  let focused = 0
  h.list.focus = options => { assert.deepEqual(options, { preventScroll: true }); focused++ }
  h.list.scrollHeight = 1800
  h.layoutCommit(['active', 'historyVersion'])
  assert.deepEqual(h.scrolls, [300, 700], 'Reactivation with prepended history anchors once without restoring stale top first')
  assert.equal(focused, 1)
  h.onScroll()
  assert.equal(h.refs.topRef.current, 700)
}
{
  const h = readingHarness()
  h.revealAcceptedSend(h.captureSendIntent())
  h.layoutCommit(['sendRevealVersion'], false)
  h.list.scrollHeight = 1400
  h.layoutCommit(['active'])
  assert.deepEqual(h.scrolls, [1000], 'Inactive accepted send reveals once without an old-position detour')
  h.onScroll()
  assert.equal(h.captureSendIntent(), 0, 'Its own programmatic scroll preserves the accepted intent')
}

// Isolated DOM geometry: execute the real explicit-resize anchor handlers.
// These checks prove content-relative restoration, not WebView/native layout.
{
  const h = readingHarness()
  h.list.scrollHeight = 2000
  h.list.scrollTop = h.refs.topRef.current = 800
  h.addBlock(120, 100) // An older reply whose reflow changes every later offset.
  const tableRow = h.addBlock(820, 80)
  h.setLayoutVersion(true)
  h.prepareLayoutChange(false)
  h.commit() // Still the original expanded layout: do not consume the anchor.
  assert.deepEqual(h.scrolls, [])
  tableRow.top = 1320
  h.list.scrollHeight = 3000
  h.list.clientHeight = 160
  h.setLayoutVersion(false)
  h.layoutCommit(['layoutVersion'])
  assert.equal(h.list.scrollTop, 1300, 'Collapse keeps the same table row 20px below the viewport top despite previous reply reflow')
  h.onScroll()
  assert.equal(h.refs.followingRef.current, false)
  assert.equal(h.showLatest(), true)
  h.prepareLayoutChange(true)
  tableRow.top = 820
  h.list.scrollHeight = 2000
  h.list.clientHeight = 400
  h.setLayoutVersion(true)
  h.layoutCommit(['layoutVersion'])
  assert.equal(h.list.scrollTop, 800, 'Expansion restores the same semantic row, not a whole-history ratio')
  assert.equal(h.refs.layoutAnchorRef.current, null, 'A committed anchor is consumed once')
}
{
  const h = readingHarness()
  h.list.scrollHeight = 1800
  h.list.scrollTop = h.refs.topRef.current = 800
  const paragraph = h.addBlock(700, 300)
  h.prepareLayoutChange(true)
  paragraph.top = 400
  paragraph.height = 60
  h.setLayoutVersion(true)
  h.layoutCommit(['layoutVersion'])
  assert.equal(h.list.scrollTop, 436, 'A shortened paragraph keeps its last readable line rather than jumping beyond the anchored block')
}
{
  const h = readingHarness()
  h.refs.followingRef.current = true
  h.prepareLayoutChange(true)
  assert.equal(h.refs.layoutAnchorRef.current, null, 'Latest readers retain bottom following rather than getting a history anchor')
  h.list.clientHeight = 600
  h.setLayoutVersion(true)
  h.layoutCommit(['layoutVersion'])
  assert.deepEqual(h.scrolls, [400])
}
{
  const h = readingHarness()
  const paragraph = h.addBlock(300, 100)
  h.pauseForUpwardReading()
  h.prepareLayoutChange(true)
  paragraph.top = 580
  h.setLayoutVersion(true)
  h.layoutCommit(['layoutVersion'])
  assert.equal(h.list.scrollTop, 580)
  h.onScroll()
  h.list.scrollHeight = 1400
  h.layoutCommit(['contentVersion'])
  assert.deepEqual(h.scrolls, [580], 'Reflow near the bottom and later tokens cannot undo explicit upward-reading pause')
}
for (const expiry of ['gesture', 'removed-block', 'hidden-block', 'accepted-send', 'prepend', 'session', 'inactive', 'failed-layout']) {
  const h = readingHarness()
  const paragraph = h.addBlock(320, 80)
  h.prepareLayoutChange(true)
  assert.ok(h.refs.layoutAnchorRef.current)
  if (expiry === 'gesture') h.invalidateSendReveal()
  if (expiry === 'removed-block') h.blocks.length = 0
  if (expiry === 'hidden-block') paragraph.height = 0
  if (expiry === 'accepted-send') h.revealAcceptedSend(h.captureSendIntent())
  if (expiry === 'prepend') h.prepareHistoryPrepend()
  if (expiry === 'session') h.layoutCommit(['sessionKey'])
  if (expiry === 'inactive') h.layoutCommit(['active'], false)
  if (expiry === 'failed-layout') h.cancelLayoutChange()
  paragraph.top = 720
  h.list.scrollHeight = 1400
  h.setLayoutVersion(true)
  h.layoutCommit(['layoutVersion'])
  assert.notEqual(h.list.scrollTop, 700, `${expiry} expires the old semantic anchor`)
  assert.equal(h.refs.layoutAnchorRef.current, null)
  if (expiry === 'accepted-send' || expiry === 'session') assert.equal(h.list.scrollTop, 1000, `${expiry} retains latest ownership`)
}
{
  const h = readingHarness()
  const paragraph = h.addBlock(320, 80)
  const pageIntentRef = { current: 0 }, pendingNavigationRef = { current: null }
  const change = localHandler('changePage', {
    reading: h, pageIntentRef, pendingNavigationRef,
    onExpandedChange: async (target, commit) => {
      assert.ok(h.refs.layoutAnchorRef.current, 'Capture precedes even a synchronous native/layout commit')
      paragraph.top = 620
      h.list.scrollHeight = 1400
      h.setLayoutVersion(target)
      commit()
      h.layoutCommit(['layoutVersion'])
    },
  })
  await change(true, () => {}, 'chat', true)
  assert.equal(h.list.scrollTop, 600)
}
{
  const h = readingHarness()
  h.addBlock(320, 80)
  const change = localHandler('changePage', {
    reading: h, pageIntentRef: { current: 0 }, pendingNavigationRef: { current: null },
    onExpandedChange: async () => { throw new Error('isolated size failure') },
  })
  await change(true, () => {}, 'chat', true)
  assert.equal(h.refs.layoutAnchorRef.current, null, 'A failed host resize cannot resurrect its anchor on a later size change')
}

class HistoryTarget {
  isContentEditable = false
  constructor(kind = 'history') { this.kind = kind }
  closest(selector) {
    if (selector.includes('textarea')) return this.kind === 'editor' ? {} : null
    if (this.kind === 'action' && selector.split(',').some(part => part.trim() === 'button')) return {}
    if (this.kind === 'link' && selector.split(',').some(part => part.trim() === 'a[href]')) return {}
    return null
  }
}
function historyInput(reading) {
  const key = localHandler('handleHistoryKeyDown', { reading, HTMLElement: HistoryTarget })
  const wheel = localHandler('handleHistoryWheel', { reading })
  const base = { target: new HistoryTarget(), defaultPrevented: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    nativeEvent: { isComposing: false, keyCode: 0 }, preventDefault() { assert.fail('History gestures must retain browser defaults') } }
  return { key: (keyName, overrides = {}) => key({ ...base, key: keyName, ...overrides }), wheel: overrides => wheel({ ...base, deltaY: -10, ...overrides }) }
}
for (const gesture of ['ArrowUp', 'PageUp', 'Home', 'Shift+Space', 'wheel']) {
  const h = readingHarness(), input = historyInput(h)
  h.refs.followingRef.current = true
  h.layoutCommit(['active'])
  const originalIntent = h.captureSendIntent()
  if (gesture === 'wheel') input.wheel()
  else input.key(gesture === 'Shift+Space' ? ' ' : gesture, { shiftKey: gesture === 'Shift+Space' })
  assert.equal(h.refs.followingRef.current, false, `${gesture} pauses before default browser scrolling`)
  assert.ok(h.captureSendIntent() > originalIntent)
  h.layoutCommit(['contentVersion']); h.resize(); h.onScroll()
  assert.deepEqual(h.scrolls, [600], 'Content/resize before default scrolling and its unchanged event cannot restart following')
  h.list.scrollTop = 599
  h.onScroll(); h.resize()
  assert.equal(h.refs.followingRef.current, false, 'The first upward step inside the near-bottom threshold keeps its direction')
  assert.deepEqual(h.scrolls, [600])
  h.list.scrollTop = 300
  h.onScroll()
  h.list.scrollHeight = 1400
  h.layoutCommit(['contentVersion']); h.resize()
  assert.equal(h.list.scrollTop, 300)
  input.key('End')
  assert.equal(h.refs.followingRef.current, false, 'Downward commands use their actual eventual position')
  h.list.scrollTop = 1000
  h.onScroll()
  assert.equal(h.refs.followingRef.current, true, 'Actual downward return to bottom resumes following')
  h.list.scrollHeight = 1500
  h.resize()
  assert.equal(h.list.scrollTop, 1100)
}
{
  const h = readingHarness(), input = historyInput(h)
  h.refs.followingRef.current = true
  h.list.scrollHeight = 400; h.list.scrollTop = 0; h.refs.topRef.current = 0
  h.layoutCommit(['active'])
  input.key('PageUp')
  assert.equal(h.refs.followingRef.current, true, 'No overflow leaves following active')
  assert.equal(h.showLatest(), false)
  h.list.scrollHeight = 1000
  input.key('Home')
  h.onScroll(); h.resize()
  assert.equal(h.refs.followingRef.current, false, 'Overflow at scrollTop zero still honors upward reading')
  let focuses = 0
  h.list.focus = () => { focuses++ }
  h.returnToLatest()
  assert.equal(h.refs.followingRef.current, true)
  assert.equal(h.refs.upwardReadingRef.current, false)
  assert.equal(focuses, 1)
  input.key('PageUp')
  h.revealAcceptedSend(h.captureSendIntent())
  h.layoutCommit(['sendRevealVersion'])
  assert.equal(h.refs.followingRef.current, true, 'A later explicit accepted send can resume following')
  assert.equal(h.refs.upwardReadingRef.current, false)
}
for (const excluded of [
  { defaultPrevented: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true },
  { nativeEvent: { isComposing: true } }, { nativeEvent: { keyCode: 229 } },
  { target: new HistoryTarget('editor') }, { target: Object.assign(new HistoryTarget(), { isContentEditable: true }) },
]) {
  const h = readingHarness(), input = historyInput(h)
  h.refs.followingRef.current = true
  input.key('ArrowUp', excluded)
  assert.equal(h.captureSendIntent(), 0, 'Non-scrolling/editing/prevented keys leave the reading intent alone')
  assert.equal(h.refs.followingRef.current, true)
}
{
  const h = readingHarness(), input = historyInput(h)
  h.refs.followingRef.current = true
  input.key(' ', { shiftKey: true, target: new HistoryTarget('action') })
  input.wheel({ ctrlKey: true })
  input.wheel({ defaultPrevented: true })
  assert.equal(h.captureSendIntent(), 0, 'Action-control Space and prevented/zoom wheels are not upward history gestures')
  input.key('PageDown'); input.key('End')
  assert.equal(h.refs.followingRef.current, true, 'Downward keys do not synchronously pause')
  input.key(' ', { shiftKey: true, target: new HistoryTarget('link') })
  assert.equal(h.refs.followingRef.current, false, 'Space on a plain link retains its default page-scrolling intent')
}
{
  const h = readingHarness()
  h.refs.followingRef.current = true
  h.refs.topRef.current = 600
  h.list.scrollTop = 590
  h.onScroll()
  assert.equal(h.refs.followingRef.current, true, 'Ordinary passive near-bottom detection is unchanged without an explicit upward pause')
}
console.log('reading lifecycle: single commit follow, cached-position/prepend recovery, upward intent ordering and actual bottom resumption passed')

// WKWebView does not reliably pan a focused overflow region with arrow keys.
// Exercise the actual table-only handler against isolated scroll contracts.
const messageContentSource = ts.createSourceFile('MessageContent.tsx', readFileSync(new URL('../src/components/MessageContent.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const tableKeyDown = localHandler('handleTableKeyDown', {}, messageContentSource)
function tableKeyboard(overrides = {}, eventOverrides = {}) {
  const scrolls = []
  const table = { clientWidth: 300, scrollWidth: 800, scrollLeft: 0, scrollTop: 37, ownerDocument: {},
    scrollTo(options) { assert.equal(options.behavior, 'instant'); assert.equal('top' in options, false); this.scrollLeft = options.left; scrolls.push(options.left) }, ...overrides }
  table.ownerDocument.activeElement = table
  let prevented = false
  const event = { key: 'ArrowRight', defaultPrevented: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, nativeEvent: {},
    target: table, currentTarget: table, preventDefault() { prevented = true }, ...eventOverrides }
  return { table, event, scrolls, prevented: () => prevented }
}
for (const key of ['ArrowLeft', 'ArrowRight']) {
  const h = tableKeyboard({ scrollLeft: 240 }, { key })
  tableKeyDown(h.event)
  assert.deepEqual(h.scrolls, [key === 'ArrowRight' ? 400 : 80])
  assert.equal(h.prevented(), true)
  assert.equal(h.table.scrollTop, 37, 'Table panning does not change vertical reading')
}
for (const [scrollLeft, key, expected] of [[490, 'ArrowRight', 500], [10, 'ArrowLeft', 0]]) {
  const h = tableKeyboard({ scrollLeft }, { key })
  tableKeyDown(h.event)
  assert.deepEqual(h.scrolls, [expected], 'Horizontal movement is clamped to the actual overflow')
}
for (const excluded of [
  { target: {} }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true },
  { defaultPrevented: true }, { nativeEvent: { isComposing: true } }, { nativeEvent: { keyCode: 229 } },
  { key: 'ArrowUp' }, { key: 'ArrowDown' }, { key: 'Home' },
]) {
  const h = tableKeyboard({}, excluded)
  tableKeyDown(h.event)
  assert.deepEqual(h.scrolls, [], 'Child actions, shortcuts, composition and vertical keys retain their normal behavior')
  assert.equal(h.prevented(), false)
}
for (const overrides of [{ scrollWidth: 300 }, { scrollWidth: 280 }, { clientWidth: 0 }]) {
  const h = tableKeyboard(overrides)
  tableKeyDown(h.event)
  assert.deepEqual(h.scrolls, [])
  assert.equal(h.prevented(), false, 'Only a visible region with actual horizontal overflow handles the key')
}
{
  const h = tableKeyboard()
  h.table.ownerDocument.activeElement = {}
  tableKeyDown(h.event)
  assert.deepEqual(h.scrolls, [], 'The region must itself own keyboard focus')
}
console.log('table keyboard regressions passed: bounded local left/right pan, focus/overflow guards, children/modifiers and vertical reading preserved')

// One-off TSX/CSS loader for rendering the real component in this static
// regression. Test strings never enter application state or a preview service.
const sourceRoot = new URL('../src/', import.meta.url).href
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith(sourceRoot)) {
      const url = new URL(specifier, context.parentURL)
      for (const extension of ['.ts', '.tsx'])
        if (existsSync(fileURLToPath(url) + extension)) return nextResolve(url.href + extension, context)
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.startsWith(sourceRoot) && url.endsWith('.css')) return { format: 'module', source: 'export {}', shortCircuit: true }
    if (url.startsWith(sourceRoot) && url.endsWith('.tsx')) return {
      format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    }
    return nextLoad(url, context)
  },
})
try {
  const { MessageContent } = await import('../src/components/MessageContent.tsx')
  const render = content => renderToStaticMarkup(createElement(MessageContent, { content }))
  const unsafe = render('<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n![说明](https://example.com/track.png)')
  assert.ok(!/<script|<img|javascript:|track\.png/.test(unsafe))
  assert.ok(unsafe.includes('图片：说明'))
  const markdown = render('# 标题\n\n**重点**\n\n- 第一项\n- 第二项\n\n[说明](https://例子.中国/文档)\n\n```js\n  const x = "<tag>";\n\n```\n\n| 列 | 值 |\n|---|---|\n| A | B |')
  for (const tag of ['<h1>', '<strong>', '<ul>', '<table>', '<pre>', '复制代码', 'rel="noopener noreferrer"']) assert.ok(markdown.includes(tag), tag)
  assert.ok(markdown.includes('  const x = &quot;&lt;tag&gt;&quot;;\n\n'), 'code indentation and trailing newline remain selectable/copyable')
  assert.doesNotThrow(() => render('**未完成\n\n```ts\nconst value ='))
}
finally { hooks.deregister() }
console.log('chat interaction static regressions passed: IME, reading threshold, safe URLs, actual Markdown SSR; no runtime/service messages created')
