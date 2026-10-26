import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
function extract(file, name) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let result
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node.getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(result, name)
  return ts.transpile(result.replace('export function', 'function'), { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React })
}
let dragOptions
const actions = []
const React = { createElement(type, props, ...children) { return { type, props: props ?? {}, children } }, Fragment: 'fragment' }
const bindings = {
  React, useId: () => 'unit-matte', useRef: current => ({ current }),
  useState: initial => [initial, () => {}], useEffect() {},
  getPetLiveStatus: () => ({}), petStateLabel: { idle: '陪着你' },
  usePetGroupDrag: options => { dragOptions = options; return {} },
  PetExpression: 'expression', useCompanionSprite: () => '/pets/white-cat-companion/idle.png', MessageCircle: 'chat-icon', MoreHorizontal: 'menu-icon',
}
const stage = new Function(...Object.keys(bindings), `${extract('src/components/PetStage.tsx', 'PetStage')}; return PetStage`)(...Object.values(bindings))
const tree = stage({ petState: 'idle', mode: 'companion', reply: null,
  onPetInteract: () => actions.push('pet'), onPetWake: () => actions.push('wake'),
  onToggleChat: () => actions.push('chat'), onContextMenu: () => actions.push('menu') })
function find(node, predicate) {
  if (!node || typeof node !== 'object') return undefined
  if (predicate(node)) return node
  return node.children?.flat(Infinity).map(child => find(child, predicate)).find(Boolean)
}
const pet = find(tree, node => node.props.className === 'pet-character-hitbox')
assert.ok(pet)
dragOptions.onClick()
assert.deepEqual(actions, ['pet'], 'a pointer pet interaction never opens chat')
pet.props.onClick({ detail: 0 })
pet.props.onKeyDown({ key: 'Enter', preventDefault() {} })
pet.props.onKeyDown({ key: ' ', preventDefault() {} })
assert.deepEqual(actions, ['pet', 'pet', 'pet', 'pet'], 'assistive click, Enter and Space all pet only')
pet.props.onClick({ detail: 1 })
assert.equal(actions.length, 4, 'pointer-generated click cannot duplicate pointer-up feedback')
dragOptions.onDrag(true, 20)
assert.equal(actions.at(-1), 'wake', 'drag wakes without petting or opening')
find(tree, node => node.props.className === 'companion-chat-button').props.onClick()
assert.equal(actions.at(-1), 'chat', 'the labelled chat action is the explicit opening path')
pet.props.onKeyDown({ key: 'F10', shiftKey: true, preventDefault() {} })
assert.equal(actions.at(-1), 'menu', 'keyboard menu is reachable without connection data')
find(tree, node => node.props.className === 'companion-menu-button').props.onClick()
assert.equal(actions.at(-1), 'menu')
assert.equal(find(tree, node => node.type === 'mask').props.style.maskType, 'luminance')
assert.equal(find(tree, node => node.type === 'image' && node.props.mask)?.props.href, '/pets/white-cat-companion/idle.png')
console.log('actual pet handlers: pointer/keyboard petting, drag wake, explicit chat, accessible menu and registered luminance matte passed')

let items
const menuActions = []
const menuBindings = {
  isChatWindow: false, currentWindow: { label: 'main' },
  contextMenuBusyRef: { current: false }, contextMenuMountedRef: { current: true }, preferencesRef: { current: { scale: 1, alwaysOnTop: true } },
  behaviorRef: { current: { isResting: () => true } },
  COMPANION_SIZES: [{ scale: .8, label: '小' }, { scale: 1, label: '标准' }, { scale: 1.2, label: '大' }],
  Menu: { new: async options => { items = options.items; return { popup: async () => {}, close: async () => {} } } },
  openChatWindow: async () => menuActions.push('chat'), toggleRest: () => menuActions.push('wake'),
  saveCompanionPreferences: async value => menuActions.push(value), runCompanionAction: async command => menuActions.push(command),
  setPanelError: value => menuActions.push(['error', value]),
}
const open = new Function(...Object.keys(menuBindings), `${extract('src/App.tsx', 'openPetContextMenu')}; return openPetContextMenu`)(...Object.values(menuBindings))
await open()
assert.equal(items.find(item => item.id === 'rest').text, '叫醒白猫')
for (const id of ['chat', 'rest', 'pin', 'hide', 'reset-position', 'quit-app']) items.find(item => item.id === id).action()
for (const option of items.find(item => item.id === 'size').items) option.action()
assert.deepEqual(menuActions, ['chat', 'wake', { scale: 1, alwaysOnTop: false }, 'hide_companion', 'reset_pet_position', 'quit_app',
  { scale: .8, alwaysOnTop: true }, { scale: 1, alwaysOnTop: true }, { scale: 1.2, alwaysOnTop: true }])
console.log('actual native menu handler: current rest state, all size presets, pin/hide/reset/quit and chat remain available without a model')


function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
for (const scenario of ['complete', 'popup-failed', 'unmount-during-create', 'unmount-during-popup', 'create-failed']) {
  const created = deferred(), popped = deferred(), disposed = deferred()
  let creates = 0, pops = 0, closes = 0
  const errors = []
  const bindings = { ...menuBindings, contextMenuBusyRef: { current: false }, contextMenuMountedRef: { current: true },
    Menu: { new() { creates++; return created.promise } }, setPanelError: error => errors.push(error) }
  const handler = new Function(...Object.keys(bindings), `${extract('src/App.tsx', 'openPetContextMenu')}; return openPetContextMenu`)(...Object.values(bindings))
  const first = handler()
  await handler()
  assert.equal(creates, 1, 'creation acquires exclusive ownership before its first await')
  if (scenario === 'create-failed') { created.reject(new Error('isolated creation failure')); await first; assert.equal(bindings.contextMenuBusyRef.current, false); continue }
  if (scenario === 'unmount-during-create') bindings.contextMenuMountedRef.current = false
  created.resolve({ popup() { pops++; return popped.promise }, close() { closes++; return disposed.promise } })
  await Promise.resolve(); await Promise.resolve()
  if (scenario !== 'unmount-during-create') {
    assert.equal(pops, 1)
    await handler()
    assert.equal(creates, 1, 'reentry while native popup is pending is ignored')
    assert.equal(closes, 0, 'an active popup is never destroyed')
    if (scenario === 'unmount-during-popup') bindings.contextMenuMountedRef.current = false
    assert.equal(closes, 0, 'unmount does not destroy the active native resource')
    if (scenario === 'popup-failed') popped.reject(new Error('isolated popup failure'))
    else popped.resolve()
    await Promise.resolve(); await Promise.resolve()
  } else assert.equal(pops, 0, 'a late creation after unmount is disposed without opening')
  assert.equal(closes, 1, 'one disposal follows popup settlement or unused creation')
  await handler()
  assert.equal(creates, 1, 'cleanup remains exclusive until disposal settles')
  disposed.resolve()
  await first
  assert.equal(bindings.contextMenuBusyRef.current, false)
  assert.equal(errors.length, scenario === 'popup-failed' ? 1 : 0)
}
console.log('actual menu lifecycle: exclusive creation/popup/disposal, no reentrant close, safe unmount and creation/popup failure recovery passed')


// Exercise the real preload hook with an isolated image decoder. No product
// data or native window is created. The visible href stays idle until decode.
for (const scenario of ['ready', 'failed', 'unmounted']) {
  const decoded = deferred()
  let ready = false, cleanup, eyesClosed = true, loadedUrl
  const bindings = {
    companionIdle: '/pets/white-cat-companion/idle.png', companionSleeping: '/pets/white-cat-companion/sleeping.png',
    useState: () => [ready, next => { ready = next }], usePetBlink: () => eyesClosed,
    useEffect: callback => { cleanup = callback() },
    Image: class { set src(value) { loadedUrl = value } decode() { return decoded.promise } },
  }
  const hook = new Function(...Object.keys(bindings), `${extract('src/components/PetExpression.tsx', 'useCompanionSprite')}; return useCompanionSprite`)(...Object.values(bindings))
  assert.equal(hook('sleeping'), bindings.companionIdle, 'unprepared sleeping art cannot replace the visible portrait')
  assert.equal(loadedUrl, bindings.companionSleeping)
  if (scenario === 'unmounted') cleanup()
  if (scenario === 'failed') decoded.reject(new Error('isolated decode failure'))
  else decoded.resolve()
  await Promise.resolve(); await Promise.resolve()
  assert.equal(ready, scenario === 'ready', 'only a successful current decode enables the replacement')
  assert.equal(hook('sleeping'), scenario === 'ready' ? bindings.companionSleeping : bindings.companionIdle)
  eyesClosed = false
  assert.equal(hook('idle'), bindings.companionIdle, 'waking switches the same href directly back to the original portrait')
  cleanup()
}
console.log('actual companion preload: decode gate, rejected load, unmount fencing and immediate wake href passed')


for (const scenario of ['active', 'reduced', 'hidden', 'sleeping', 'disabled']) {
  const timers = new Map(), listeners = new Map()
  const preference = { matches: scenario === 'reduced',
    addEventListener: (type, callback) => listeners.set(`preference:${type}`, callback),
    removeEventListener: type => listeners.delete(`preference:${type}`) }
  const document = { hidden: scenario === 'hidden',
    addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener: type => listeners.delete(type) }
  let next = 0, closed = false, cleanup
  const bindings = {
    document, useState: () => [false, value => { closed = value }], useEffect: callback => { cleanup = callback() },
    window: { matchMedia: () => preference, setTimeout: callback => { timers.set(++next, callback); return next }, clearTimeout: id => timers.delete(id) },
  }
  const hook = new Function(...Object.keys(bindings), `${extract('src/components/PetExpression.tsx', 'usePetBlink')}; return usePetBlink`)(...Object.values(bindings))
  assert.equal(hook(scenario === 'sleeping' ? 'sleeping' : 'idle', scenario !== 'disabled'), scenario === 'sleeping')
  assert.equal(timers.size, scenario === 'active' ? 1 : 0)
  if (scenario === 'active') {
    const [id, blink] = timers.entries().next().value
    timers.delete(id); blink()
    assert.equal(closed, true)
    document.hidden = true
    listeners.get('visibilitychange')()
    assert.equal(closed, false)
    assert.equal(timers.size, 0, 'hiding cancels both blink completion and the next blink')
  }
  cleanup?.()
  assert.equal(timers.size, 0)
  assert.equal(listeners.size, 0)
}
console.log('actual blink lifecycle: reduced-motion/hidden/disabled suspension, persistent rest and complete timer/listener cleanup passed')
