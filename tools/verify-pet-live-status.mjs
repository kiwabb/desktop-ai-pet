import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Pure presentation regression inputs only; never injected into the app or
// presented as real connection/model evidence.
const source = readFileSync(new URL('../src/lib/pet-live-status.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const { getPetLiveStatus } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const ready = { configured: true, connection: 'connected', model_configured: true, node_connected: true, node_error: null, error: null }
const cases = [
  [null, '正在读取状态', 'neutral'],
  [{ ...ready, configured: false }, '助手待配置', 'neutral'],
  [{ ...ready, connection: 'unconfigured' }, '助手待配置', 'neutral'],
  [{ ...ready, connection: 'connecting' }, '正在连接', 'pending'],
  [{ ...ready, connection: 'disconnected' }, '连接已断开', 'error'],
  [{ ...ready, model_configured: false }, '模型待配置', 'pending'],
  [{ ...ready, error: 'unit-only private error sentinel' }, '助手需要检查', 'error'],
  [{ ...ready, node_connected: false, node_error: 'unit-only private error sentinel' }, '聊天可用 · 设备离线', 'pending'],
  [{ ...ready, node_connected: false }, '聊天可用 · 登记中', 'pending'],
  [ready, '在线待命', 'ready'],
]
for (const [view, detail, tone] of cases) {
  const result = getPetLiveStatus(view, 'idle')
  assert.equal(result.detail, detail)
  assert.equal(result.tone, tone)
  assert.ok(result.accessibleLabel)
  assert.ok(!JSON.stringify(result).includes('private error sentinel'), 'Raw service errors must not leak into the decorative status')
  if (tone !== 'ready') {
    assert.equal(getPetLiveStatus(view, 'thinking').tone, tone)
    assert.equal(getPetLiveStatus(view, 'talking').detail, detail, 'Pet activity must not conceal connection facts')
  }
}
assert.equal(getPetLiveStatus(ready, 'thinking').title, '思考中')
assert.equal(getPetLiveStatus(ready, 'talking').title, '回复中')
console.log('pet live status pure regressions passed: 10 connection states, activity priority, private-error exclusion')
