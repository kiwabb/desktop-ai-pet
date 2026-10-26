/** A small, versioned subset of Pi's documented RPC protocol. */

export type PiPromptDisposition = 'started' | 'queued' | 'handled'

export interface PiRpcCommand {
  type: string
  id?: string
  [key: string]: unknown
}

export interface PiPromptCommand {
  type: 'prompt'
  message: string
  streamingBehavior?: 'steer' | 'followUp'
}

export interface PiAbortCommand {
  type: 'abort'
}

export interface PiGetStateCommand {
  type: 'get_state'
}

export type PiCommand = PiPromptCommand | PiAbortCommand | PiGetStateCommand

export interface PiRpcResponse<TData = unknown> {
  id?: string
  type: 'response'
  command: string
  success: boolean
  data?: TData
  error?: string
}

export interface PiAgentSettledEvent {
  type: 'agent_settled'
  aborted: boolean
}

export type PiRpcRecord = PiRpcResponse | PiAgentSettledEvent | PiEventRecord

export interface PiEventRecord {
  type: string
  [key: string]: unknown
}

export interface PiPromptAccepted {
  requestId: string
  disposition: PiPromptDisposition
}

export interface PiPromptData {
  disposition: PiPromptDisposition
}

export interface PiStateData {
  isStreaming?: boolean
  sessionFile?: string
  sessionId?: string
  sessionName?: string
  [key: string]: unknown
}

export interface PiPromptResult extends PiPromptAccepted {
  settled: true
  aborted: boolean
  error: string | null
}

export function isPiRpcResponse(value: unknown): value is PiRpcResponse {
  if (!isRecord(value) || value.type !== 'response' || typeof value.command !== 'string' || typeof value.success !== 'boolean') return false
  if ('id' in value && value.id !== undefined && typeof value.id !== 'string') return false
  if ('error' in value && value.error !== undefined && typeof value.error !== 'string') return false
  return true
}

export function isPiAgentSettled(value: unknown): value is PiAgentSettledEvent {
  return isRecord(value) && value.type === 'agent_settled' && typeof value.aborted === 'boolean'
}

export function parsePromptDisposition(response: PiRpcResponse): PiPromptDisposition {
  if (!response.success || !isRecord(response.data) || !['started', 'queued', 'handled'].includes(response.data.disposition as string)) {
    throw new Error('Pi prompt response did not contain a valid disposition')
  }
  return response.data.disposition as PiPromptDisposition
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
