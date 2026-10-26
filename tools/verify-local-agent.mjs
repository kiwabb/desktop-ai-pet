import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import ts from 'typescript'

// Structural/static regressions for the standalone (local) agent mode that
// cargo test cannot cover: keyring wiring, plaintext-scrub guarantees,
// command registration, mode-neutral copy, and doc/env hygiene. Behavior-level
// units (SSE parsing, tool accumulation, store rules) stay in `cargo test`;
// this script never performs real LLM calls or touches a real keychain.

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const backendMod = read('../src-tauri/src/backend/mod.rs')
const credentials = read('../src-tauri/src/backend/credentials.rs')
const libRs = read('../src-tauri/src/lib.rs')
const sse = read('../src-tauri/src/llm/sse.rs')
const agentTs = read('../src/lib/agent.ts')

// --- 1. The local API key never reaches the disk or the frontend -------------

// LocalConfig.api_key deserializes (legacy migration) but never serializes.
assert.ok(
  /#\[serde\([^\]]*skip_serializing[^\]]*\)\]\s*pub api_key/.test(backendMod),
  'LocalConfig.api_key must be skip_serializing so persist() can never write it',
)
// The OS credential store is the only durable home for the key.
for (const needle of ['keyring::Entry::new', '"desktop-ai-pet"', '"local-llm-api-key"', 'trait CredentialStore', 'pub fn hydrate', 'pub fn save_key'])
  assert.ok(credentials.includes(needle), `credentials.rs missing: ${needle}`)
// Startup hydrates the active mode and still migrates legacy plaintext. An
// inactive encrypted local key must not block server startup on credential UI.
assert.ok(backendMod.includes('config.hydrate_startup(&credentials::PlatformStore)'), 'agent_view must use the mode-aware startup credential path')
assert.ok(backendMod.includes('credentials::hydrate_startup(self.mode, &mut self.local, store)'), 'Config startup must route mode and local config through the credential store')
assert.ok(credentials.includes('mode == Mode::Local || !config.api_key.is_empty()'), 'server startup may access local credentials only to migrate legacy plaintext')
// A failed migration must prevent every later scrubbed filesystem write,
// including automatic session persistence; behavioral file tests live in Rust.
const persistAt = backendMod.match(/fn persist_at\([\s\S]*?\n\}/)?.[0] ?? ''
assert.ok(persistAt.indexOf('config.local_key_migration_pending') >= 0 && persistAt.indexOf('config.local_key_migration_pending') < persistAt.indexOf('fs::create_dir_all'), 'pending legacy migration must be checked before filesystem writes')
// Settings save writes the keyring before persisting the config.
assert.ok(/credentials::save_key\(&credentials::PlatformStore/.test(backendMod), 'save_agent_settings must route the key through the credential store')
// The emitted AgentView exposes presence only, never the key itself.
const viewStruct = backendMod.match(/pub struct View \{([\s\S]*?)\n\}/)?.[1] ?? ''
assert.ok(viewStruct.includes('local_has_key: bool'), 'AgentView must expose a has-key boolean for the settings form')
assert.ok(!/api_key/.test(viewStruct), 'AgentView must never carry the API key')
assert.ok(!/api_key/.test(agentTs.match(/export interface AgentView \{([\s\S]*?)\n\}/)?.[1] ?? ''), 'TS AgentView must never carry the API key')
// Keyring logic is unit-tested through an in-memory mock, not a real keychain.
assert.ok(credentials.includes('pub struct MemoryStore'), 'credential logic must be covered by an in-memory mock in cargo test')

// --- 2. Command registration (the eight agent commands, single view outlet) --

const handler = libRs.match(/invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/)?.[1] ?? ''
for (const command of ['agent_view', 'save_agent_settings', 'agent_submit', 'agent_list_models', 'agent_list_todos', 'agent_complete_todo', 'agent_reopen_todo', 'agent_set_todo_reminder'])
  assert.ok(handler.includes(`backend::${command}`), `invoke_handler must register backend::${command}`)

// --- 3. The chunk timer wraps raw bytes, so SSE heartbeats reset it ----------

assert.ok(sse.includes('fn chunk_stream_with_timeout'), 'sse.rs must own the chunk read timeout')
const bytesFirst = sse.indexOf('bytes_stream()')
const eventsourceAfter = sse.indexOf('.eventsource()', bytesFirst)
assert.ok(bytesFirst > -1 && eventsourceAfter > bytesFirst && sse.slice(bytesFirst, eventsourceAfter).includes('tokio::time::timeout'),
  'the chunk timeout must wrap bytes_stream before eventsource parsing (heartbeat comments produce no events)')
const runtime = read('../src-tauri/src/local_agent/runtime.rs')
assert.ok(!runtime.includes('CHUNK_TIMEOUT'), 'runtime must rely on the stream chunk timer, not a second timeout')
assert.ok(runtime.includes('if chunk.content.is_empty()'), 'empty chunks must be skipped before append_delta')

// --- 4. Mode-neutral status copy (behavioral, via the real functions) --------

// connectionLabel is a self-contained exported const; transpile and run it.
const agentAst = ts.createSourceFile('agent.ts', agentTs, ts.ScriptTarget.Latest, true)
let labelNode
for (const statement of agentAst.statements)
  if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(d => d.name.getText(agentAst) === 'connectionLabel')) labelNode = statement
assert.ok(labelNode, 'connectionLabel export not found in src/lib/agent.ts')
const { outputText: labelJs } = ts.transpileModule(`${labelNode.getText(agentAst).replace(/^export\s+/, '')}; exports.connectionLabel = connectionLabel`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
const { connectionLabel } = new Function('exports', `${labelJs}; return exports`)({})
const base = { configured: true, connection: 'connected', model_configured: true, node_connected: true, node_error: null }
// Server-mode branches stay byte-identical.
assert.equal(connectionLabel(null), '还没连上助手')
assert.equal(connectionLabel({ ...base, connection: 'connecting' }), '正在连接……')
assert.equal(connectionLabel({ ...base, connection: 'disconnected' }), '连接断了，正在重连')
assert.equal(connectionLabel({ ...base, node_connected: false, node_error: 'x' }), '设备暂时离线，聊天照常')
assert.equal(connectionLabel({ ...base, node_connected: false }), '我在，设备还在登记')
assert.equal(connectionLabel(base), '我在这儿呢')
// The partially-configured label is accurate for both modes (no "服务端").
const partial = connectionLabel({ ...base, model_configured: false })
assert.equal(partial, '我在，模型还没设置')
assert.ok(!partial.includes('服务端'), 'the label must be neutral across modes')

// pet-live-status.ts is pure; run the real function against local-mode shapes.
const { outputText: statusJs } = ts.transpileModule(read('../src/lib/pet-live-status.ts'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const { getPetLiveStatus } = await import(`data:text/javascript;base64,${Buffer.from(statusJs).toString('base64')}`)
const localPartial = getPetLiveStatus({ mode: 'local', configured: true, connection: 'connected', model_configured: false, node_connected: true, node_error: null, error: null }, 'idle')
assert.equal(localPartial.detail, '模型待配置')
assert.ok(!JSON.stringify(localPartial).includes('服务端'), 'local-mode status copy must not claim a server-side model')
const localDown = getPetLiveStatus({ mode: 'local', configured: true, connection: 'disconnected', model_configured: true, node_connected: true, node_error: null, error: 'unit-only' }, 'idle')
assert.equal(localDown.tone, 'error')
assert.ok(!localDown.accessibleLabel.includes('重新连接'), 'local mode has no reconnect loop; the copy must not promise one')
const serverDown = getPetLiveStatus({ mode: 'server', configured: true, connection: 'disconnected', model_configured: true, node_connected: true, node_error: null, error: null }, 'idle')
assert.equal(serverDown.detail, '连接已断开', 'server-mode copy must stay unchanged')

// --- 5. Dead legacy contract removed; env/docs hygiene ------------------------

assert.ok(!existsSync(new URL('../src/lib/ai.ts', import.meta.url)), 'src/lib/ai.ts must be deleted (git history keeps it)')
function* walk(dir) {
  for (const entry of readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
    if (entry.isDirectory()) yield* walk(`${dir}${entry.name}/`)
    else if (/\.(ts|tsx)$/.test(entry.name)) yield `${dir}${entry.name}`
  }
}
for (const file of walk('../src/'))
  assert.ok(!/from\s+'[^']*lib\/ai'/.test(read(file)), `${file} still imports the deleted lib/ai`)

const envExample = read('../.env.example')
for (const name of ['PET_AGENT_MODEL_BASE_URL', 'PET_AGENT_MODEL_API_KEY', 'PET_AGENT_MODEL_NAME'])
  assert.ok(envExample.includes(name), `.env.example must document ${name} as a standalone-mode default`)
assert.ok(!envExample.includes('DESKTOP_AI_PET_'), '.env.example must not keep the legacy DESKTOP_AI_PET_* names')

const architecture = read('../docs/ARCHITECTURE.md')
for (const needle of ['单机模式', '服务端模式', '凭据存储', 'agent-local.db'])
  assert.ok(architecture.includes(needle), `ARCHITECTURE.md must describe the dual-mode reality: ${needle}`)
assert.ok(!architecture.includes('过时') && !architecture.includes('尚未实现'), 'ARCHITECTURE.md must not keep the stale/outdated banner')
const serverDoc = read('../docs/SERVER_AGENT_ARCHITECTURE.md')
assert.ok(serverDoc.includes('ARCHITECTURE.md') && serverDoc.includes('单机'), 'SERVER_AGENT_ARCHITECTURE.md must point at the dual-mode overview')

console.log('local agent structural regressions passed: keyring-only key storage, plaintext scrub, 8 commands, byte-level chunk timer, mode-neutral copy, legacy contract removal, env/docs hygiene')
