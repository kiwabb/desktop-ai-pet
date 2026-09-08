import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Isolated hook scheduling with mocked React lifecycle and HTTP. No browser,
// server, model, or application data is created by these tests.
const source = ts.transpileModule(readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

function harness(poll = false) {
  const states = [], effects = [], requests = [], timers = new Map()
  let nextTimer = 0
  const document = Object.assign(new EventTarget(), { hidden: false, cookie: '' })
  const window = Object.assign(new EventTarget(), {
    setTimeout: callback => { const id = ++nextTimer; timers.set(id, callback); return id },
    clearTimeout: id => timers.delete(id),
  })
  const react = {
    useCallback: callback => callback,
    useRef: current => ({ current }),
    useEffect: effect => effects.push(effect),
    useState: initial => {
      const cell = { value: initial }; states.push(cell)
      return [initial, value => { cell.value = value }]
    },
  }
  const exports = {}
  const execute = vm.runInNewContext(`(function(require, exports) { ${source}\n})`, {
    document, window, Headers, AbortController, Event,
    fetch: (_path, init) => new Promise((resolve, reject) => requests.push({ init, resolve, reject })),
  })
  execute(name => { assert.equal(name, 'react'); return react }, exports)
  const resource = exports.useResource('/runs', poll)
  const cleanup = effects[0]()
  const resolve = (index, sequence) => requests[index].resolve({ ok: true, status: 200, json: async () => ({ sequence }) })
  const tick = () => { const [id, callback] = timers.entries().next().value; timers.delete(id); callback() }
  return { resource, cleanup, states, requests, timers, document, resolve, tick }
}
const settle = () => new Promise(resolve => setImmediate(resolve))

test('mutation refresh during a pending read queues exactly one fresh read', async () => {
  const h = harness()
  assert.equal(h.requests.length, 1)
  h.resource.refresh(); h.resource.refresh()
  assert.equal(h.requests.length, 1)
  h.resolve(0, 1); await settle()
  assert.equal(h.timers.size, 1)
  h.tick()
  assert.equal(h.requests.length, 2)
  h.resolve(1, 2); await settle()
  assert.equal(h.states[0].value.data.sequence, 2)
  assert.equal(h.timers.size, 0)
  h.cleanup()
})

test('navigation aborts the request and discards even a late fulfilled response', async () => {
  const h = harness(true)
  h.cleanup()
  assert.equal(h.requests[0].init.signal.aborted, true)
  h.resolve(0, 1); await settle()
  assert.equal(h.states[0].value, null)
  assert.equal(h.timers.size, 0)
})

test('hidden polling aborts in flight and resumes once on visibility', async () => {
  const h = harness(true)
  h.document.hidden = true; h.document.dispatchEvent(new Event('visibilitychange'))
  assert.equal(h.requests[0].init.signal.aborted, true)
  h.requests[0].reject(new DOMException('Aborted', 'AbortError')); await settle()
  assert.equal(h.timers.size, 0)
  h.document.hidden = false; h.document.dispatchEvent(new Event('visibilitychange'))
  assert.equal(h.requests.length, 2)
  h.resolve(1, 2); await settle()
  assert.equal(h.timers.size, 1)
  h.cleanup()
  assert.equal(h.timers.size, 0)
})
