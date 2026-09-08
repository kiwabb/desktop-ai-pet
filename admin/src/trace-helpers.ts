export interface Call {
  id: string; step_index: number; model_name: string | null; status: string; started_at: string; ended_at: string | null; duration_ms: number | null
  first_response_at: string | null; first_visible_text_at: string | null; first_token_ms?: number | null; first_visible_text_ms?: number | null
  usage: { input_tokens?: number; output_tokens?: number; total_tokens?: number; input_token_details?: Record<string, number> } | null
  usage_source: string | null; error_type: string | null; payloads: { id: string; kind: string; expired: boolean }[]
}
export interface TraceTool { id: string; name: string; status: string; error: string | null; created_at: string; ended_at?: string | null; model_call_id: string | null; step_index: number | null }
export interface Run {
  id: string; account_id: string; session_id: string; request_id: string; status: string; error: string | null; created_at: string
  started_at?: string | null; ended_at?: string | null; model_config_version_id: string | null; trace_integrity: string; trace_steps: number
}
export interface RunDetail extends Run { trace: { integrity: string; gap_reason: string | null; calls: Call[] }; tools: TraceTool[] }
export interface TraceEntry { id: string; kind: 'queue' | 'model' | 'tool' | 'end'; title: string; start: number; end: number | null; call?: Call; tool?: TraceTool; orphan?: boolean }
export function time(value?: string | null): number | null { const n = value ? Date.parse(value) : NaN; return Number.isFinite(n) ? n : null }
export function entriesOf(run: RunDetail): TraceEntry[] {
  const entries: TraceEntry[] = []
  const accepted = time(run.created_at), started = time(run.started_at)
  if (accepted !== null) entries.push({ id: `queue:${run.id}`, kind: 'queue', title: '请求接收与排队', start: accepted, end: started })
  const calls = [...run.trace.calls].sort((a, b) => a.step_index - b.step_index || a.id.localeCompare(b.id))
  const used = new Set<string>()
  for (const call of calls) {
    const start = time(call.started_at)
    if (start !== null) entries.push({ id: `model:${call.id}`, kind: 'model', title: `模型步骤 ${call.step_index} · ${call.model_name ?? '名称未采集'}`, start, end: time(call.ended_at), call })
    for (const tool of run.tools.filter(tool => tool.model_call_id === call.id).sort((a, b) => (time(a.created_at) ?? 0) - (time(b.created_at) ?? 0) || a.id.localeCompare(b.id))) {
      used.add(tool.id)
      const toolStart = time(tool.created_at)
      if (toolStart !== null) entries.push({ id: `tool:${tool.id}`, kind: 'tool', title: tool.name, start: toolStart, end: time(tool.ended_at), tool })
    }
  }
  for (const tool of run.tools.filter(tool => !used.has(tool.id))) {
    const start = time(tool.created_at)
    if (start !== null) entries.push({ id: `tool:${tool.id}`, kind: 'tool', title: `${tool.name} · 模型关联未采集`, start, end: time(tool.ended_at), tool, orphan: true })
  }
  const ended = time(run.ended_at)
  if (ended !== null) entries.push({ id: `end:${run.id}`, kind: 'end', title: '服务端运行结束', start: ended, end: ended })
  return entries
}
export function extentOf(entries: TraceEntry[]): [number, number] {
  if (!entries.length) return [0, 1]
  const min = Math.min(...entries.map(entry => entry.start)), max = Math.max(...entries.map(entry => entry.end ?? entry.start))
  return [min, Math.max(min + 1, max)]
}
export function intersects(entry: TraceEntry, range: [number, number]) { return entry.start <= range[1] && (entry.end ?? entry.start) >= range[0] }
export function usageSummary(calls: Call[]) {
  const withUsage = calls.filter(call => call.usage && Number.isFinite(call.usage.total_tokens))
  return { total: withUsage.length ? withUsage.reduce((sum, call) => sum + call.usage!.total_tokens!, 0) : null, known: withUsage.length, missing: calls.length - withUsage.length }
}
export function delayMs(start?: string | null, end?: string | null) { const a = time(start), b = time(end); return a !== null && b !== null && b >= a ? b - a : null }
export function milliseconds(value?: number | null) { return value === null || value === undefined || !Number.isFinite(value) ? '未采集' : `${Math.max(0, value).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 毫秒` }
export function localDateInput(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  // datetime-local accepts local wall time, while URLs preserve ISO offsets.
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
