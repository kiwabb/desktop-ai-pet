import test from 'node:test'
import assert from 'node:assert/strict'
import { entriesOf, intersects, extentOf, usageSummary, delayMs, milliseconds, localDateInput } from '../src/trace-helpers.ts'
// Isolated pure-function inputs only: never mounted in the UI or sent to a service.
const date = n => new Date(n).toISOString()
const call = (id, step, start, end, usage = null) => ({ id, step_index: step, started_at: date(start), ended_at: date(end), model_name: id, usage })
const run = { id: 'r', created_at: date(0), started_at: date(10), ended_at: date(90), trace: { calls: [call('second', 2, 60, 80), call('first', 1, 10, 30)] }, tools: [{ id: 't', name: 'todo_list', model_call_id: 'first', created_at: date(40), ended_at: date(50) }] }
test('model and tool records preserve triggering-call order independent of input order', () => {
  assert.deepEqual(entriesOf(run).map(entry => entry.id), ['queue:r', 'model:first', 'tool:t', 'model:second', 'end:r'])
})
test('timeline range selects overlapping steps and missing ends remain points', () => {
  const entries = entriesOf(run)
  assert.deepEqual(entries.filter(entry => intersects(entry, [35, 55])).map(entry => entry.id), ['tool:t'])
  assert.deepEqual(extentOf(entries), [0, 90])
  assert.equal(intersects({ start: 10, end: null }, [11, 20]), false)
})
test('missing usage is never presented as a complete zero total', () => {
  assert.deepEqual(usageSummary([call('a', 1, 1, 2)]), { total: null, known: 0, missing: 1 })
  assert.deepEqual(usageSummary([call('a', 1, 1, 2, { total_tokens: 13 }), call('b', 2, 3, 4)]), { total: 13, known: 1, missing: 1 })
  assert.deepEqual(usageSummary([call('a', 1, 1, 2, { total_tokens: 0 })]), { total: 0, known: 1, missing: 0 })
})
test('timing is a nonnegative difference and missing token delay is explicit', () => {
  assert.equal(delayMs(date(100), date(145)), 45)
  assert.equal(delayMs(date(145), date(100)), null)
  assert.equal(delayMs(date(100), null), null)
  assert.equal(milliseconds(undefined), '未采集')
})
test('unlinked tools retain the missing-association evidence', () => {
  const entries = entriesOf({ ...run, tools: [{ ...run.tools[0], model_call_id: null }] })
  assert.equal(entries.find(entry => entry.kind === 'tool').orphan, true)
})

test('malformed URL dates cannot crash a datetime-local input', () => {
  assert.equal(localDateInput('badZ'), '')
  assert.equal(localDateInput('invalid'), '')
  assert.equal(localDateInput(''), '')
  const source = '2026-09-08T10:00:00+08:00'
  const date = new Date(source)
  const expected = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  assert.equal(localDateInput(source), expected)
})
