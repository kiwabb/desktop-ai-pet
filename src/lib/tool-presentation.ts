import type { ToolCall } from './agent'

/** Generic tool presentation shape (mirrors the { name, status, text } view). */
export interface ToolPresentation {
  name: string
  status: string
  text: string
}

export interface ToolPresentationPlugin {
  /** Model and business tool names this plugin presents (from its manifest). */
  toolNames: readonly string[]
  /** Refresh groups this plugin's confirmed effects feed (manifest `affects`). */
  affects: readonly string[]
  present(tool: ToolCall): ToolPresentation
  /** Stable fingerprint of this plugin's confirmed effect tools. */
  effectsFingerprint(tools: ToolCall[]): unknown
}

// Explicit registration order (mirrors the runtimes' builtin_plugins).
const plugins: ToolPresentationPlugin[] = []

export function registerToolPresentation(plugin: ToolPresentationPlugin) {
  plugins.push(plugin)
}

/** Test hook: restore the empty registry. */
export function resetToolPresentations() {
  plugins.length = 0
}

export function toolStatusText(status: ToolCall['status']) {
  return { running: '橘伴处理中…', completed: '执行成功', failed: '失败', needs_reconciliation: '结果待确认' }[status]
}

/** Unregistered tools never surface a bare English tool name to the user:
 * the degrade branch frames it as a generic 工具 while keeping the raw name
 * for identification. */
export function toolFallbackName(name: string): string {
  return name.trim() ? `工具：${name}` : '工具'
}

/** Presentation lookup through the registry; an unregistered tool degrades to
 * the generic shape instead of throwing (AC5). */
export function presentTool(tool: ToolCall): ToolPresentation {
  const plugin = plugins.find(candidate => candidate.toolNames.includes(tool.name))
  if (plugin) return plugin.present(tool)
  return { name: toolFallbackName(tool.name), status: toolStatusText(tool.status), text: '' }
}

/** Fingerprint of the confirmed effects feeding one refresh group, dispatched
 * by the plugins' declared `affects` (replaces the hardcoded todo fingerprint). */
export function toolEffectsFingerprint(tools: ToolCall[], affect: string): string {
  return JSON.stringify(
    plugins.filter(plugin => plugin.affects.includes(affect)).map(plugin => plugin.effectsFingerprint(tools)),
  )
}
