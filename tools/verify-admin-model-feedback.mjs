import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Execute the actual handlers and JSX return with isolated deferred requests.
// This is neither an authenticated admin session nor a real model invocation.
const source = ts.createSourceFile('models.tsx', readFileSync(new URL('../admin/src/models.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const page = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ModelPage')
assert.ok(page)
const options = { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'element', jsxFragmentFactory: 'fragment' }
function compile(text, bindings, result) {
  const compiled = ts.transpileModule(text, { compilerOptions: options }).outputText
  return new Function(...Object.keys(bindings), `${compiled}; return ${result}`)(...Object.values(bindings))
}
function handler(name, bindings) {
  const node = page.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.ok(node, `Missing actual handler: ${name}`)
  return compile(node.getText(source), bindings, name)
}
const outcomeDeclaration = page.body.statements.filter(ts.isVariableStatement).flatMap(node => node.declarationList.declarations)
  .find(node => node.name.getText(source) === 'visibleTestOutcome')
assert.ok(outcomeDeclaration?.initializer)
const returned = page.body.statements.find(ts.isReturnStatement)
assert.ok(returned?.expression)
const version = id => ({ id, base_url: 'https://isolated.invalid/v1', model_name: `isolated-${id}`, timeout_seconds: 90, has_key: false, created_at: '2026-01-01T00:00:00Z', tested: false })
const A = version('version-a'), B = version('version-b')

function harness() {
  let resolve, reject, pending
  const request = new Promise((yes, no) => { resolve = yes; reject = no })
  const state = { outcome: null, error: '', notice: '', busy: false, refreshes: 0, requests: [] }
  const lock = { current: false }
  const resource = { busy: false, error: '', refresh: () => { state.refreshes++ } }
  const setTestOutcome = value => { state.outcome = value }
  const bindings = {
    lock, resource, setTestOutcome,
    setBusy: value => { state.busy = value }, setError: value => { state.error = value }, setNotice: value => { state.notice = value },
    messageOf: cause => cause instanceof Error ? cause.message : String(cause),
  }
  const action = handler('action', bindings)
  function start(selected = A) {
    handler('test', { ...bindings, selected,
      action: (work, onError) => { pending = action(work, onError) }, write: () => ({ method: 'POST' }),
      api: (path, init) => { state.requests.push({ path, init }); return request },
    })()
    return pending
  }
  function render(selected) {
    const visibleTestOutcome = compile(`const visibleTestOutcome = ${outcomeDeclaration.initializer.getText(source)}`, { testOutcome: state.outcome, selected }, 'visibleTestOutcome')
    const noOp = () => {}
    const tree = compile(`function render() { return ${returned.expression.getText(source)} }`, {
      element: (type, props, ...children) => ({ type, props: props ?? {}, children }), fragment: 'fragment',
      PageIntro: 'PageIntro', Refresh: 'Refresh', ErrorLine: 'ErrorLine', Loading: 'Loading', JsonView: 'JsonView', Pager: 'Pager',
      resource, busy: state.busy, error: state.error, notice: state.notice, visibleTestOutcome,
      state: { management_enabled: true, revision: 7, active: A, versions: [A, B], next_cursor: null },
      selected, selectedId: selected?.id ?? null, user: { role: 'admin' }, cursor: null,
      form: { base_url: '', model_name: '', timeout_seconds: 90, api_key: '' }, keySource: 'current',
      formatTime: value => value, action: noOp, save: noOp, test: noOp, publish: noOp, rollback: noOp, choose: noOp,
    }, 'render()')
    const nodes = []
    function visit(node) {
      if (Array.isArray(node)) { node.forEach(visit); return }
      if (!node || typeof node !== 'object') return
      nodes.push(node)
      node.children.forEach(visit)
    }
    visit(tree)
    return {
      errors: nodes.filter(node => node.type === 'ErrorLine').map(node => node.props.error).filter(Boolean),
      notices: nodes.filter(node => node.type === 'p' && node.props.className === 'notice-line').flatMap(node => node.children),
      results: nodes.filter(node => node.type === 'JsonView').map(node => node.props.value),
    }
  }
  return { state, lock, action, start, render, resolve, reject }
}

let cases = 0
for (const kind of ['success', 'model-failure', 'network-rejection']) {
  for (const navigate of [false, true]) {
    const h = harness()
    const pending = h.start()
    assert.equal(h.lock.current, true)
    assert.equal(h.state.busy, true)
    assert.deepEqual(h.state.requests, [{ path: '/model-config/version-a/test', init: { method: 'POST' } }])
    assert.deepEqual(h.render(navigate ? B : A), { errors: [], notices: [], results: [] })
    const result = { status: kind === 'success' ? 'succeeded' : 'failed', error_message: kind === 'success' ? null : 'isolated model failure' }
    if (kind === 'network-rejection') h.reject(new Error('isolated network rejection'))
    else h.resolve(result)
    await pending
    assert.equal(h.lock.current, false)
    assert.equal(h.state.busy, false)
    assert.equal(h.state.refreshes, kind === 'network-rejection' ? 0 : 1, 'Resolved tests refresh; a rejected request retains the existing no-refresh path')
    assert.equal(h.state.requests.length, 1, 'Changing selection does not replay or cancel the sent test')
    assert.equal(h.state.error, '', 'Test rejection must not leak through generic action feedback')
    assert.equal(h.state.notice, '')
    if (navigate) assert.deepEqual(h.render(B), { errors: [], notices: [], results: [] }, `${kind}: A feedback must not be rendered for B`)
    assert.deepEqual(h.render(null), { errors: [], notices: [], results: [] }, 'No selected version owns A feedback')
    const shown = h.render(A)
    assert.deepEqual(shown.errors, kind === 'success' ? [] : [kind === 'network-rejection' ? 'isolated network rejection' : 'isolated model failure'])
    assert.equal(shown.notices.length, kind === 'success' ? 1 : 0)
    assert.deepEqual(shown.results, kind === 'network-rejection' ? [] : [result])
    cases++
  }
}

{
  const h = harness()
  const pending = h.start()
  await h.start(B)
  assert.equal(h.state.requests.length, 1, 'The existing immediate lock prevents a concurrent test')
  h.resolve({ status: 'succeeded', error_message: null })
  await pending
  await h.action(async () => { throw new Error('isolated other action failure') })
  assert.equal(h.state.error, 'isolated other action failure', 'Other actions retain their existing error path')
  assert.equal(h.state.outcome, null, 'A later action clears the prior test feedback')
  assert.equal(h.state.refreshes, 1)
  assert.equal(h.lock.current, false)
  assert.equal(h.state.busy, false)
  cases++
}

console.log(`Admin model feedback verifier passed (${cases} isolated handler/JSX cases; no service/model request).`)
