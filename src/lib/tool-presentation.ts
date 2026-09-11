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
  return { running: '执行中', completed: '已完成', failed: '失败', needs_reconciliation: '待核实' }[status]
}

/** Presentation lookup through the registry; an unregistered tool degrades to
 * the generic shape instead of throwing (AC5). */
export function presentTool(tool: ToolCall): ToolPresentation {
  const plugin = plugins.find(candidate => candidate.toolNames.includes(tool.name))
  if (plugin) return plugin.present(tool)
  return { name: tool.name, status: toolStatusText(tool.status), text: '' }
}

/** Fingerprint of the confirmed effects feeding one refresh group, dispatched
 * by the plugins' declared `affects` (replaces the hardcoded todo fingerprint). */
export function toolEffectsFingerprint(tools: ToolCall[], affect: string): string {
  return JSON.stringify(
    plugins.filter(plugin => plugin.affects.includes(affect)).map(plugin => plugin.effectsFingerprint(tools)),
  )
}
