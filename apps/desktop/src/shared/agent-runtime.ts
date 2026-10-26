import type { PiEventRecord, PiPromptDisposition } from './pi-rpc'

export interface AgentRunRequest {
  sessionId: string
  runId: string
  requestId: string
  prompt: string
  streamingBehavior?: 'steer' | 'followUp'
}

export interface AgentRunCancelRequest {
  sessionId: string
  runId: string
}

export interface AgentRunAcceptedEvent {
  type: 'run.accepted'
  sequence: number
  sessionId: string
  runId: string
  requestId: string
  disposition: PiPromptDisposition
}

export interface AgentRunRecordEvent {
  type: 'run.record'
  sequence: number
  sessionId: string
  runId: string
  requestId: string
  record: PiEventRecord
}

export interface AgentRunCancelRequestedEvent {
  type: 'run.cancel_requested'
  sequence: number
  sessionId: string
  runId: string
  requestId: string
}

export type AgentRunSettlement = 'completed' | 'cancelled' | 'failed'

export interface AgentRunSettledEvent {
  type: 'run.settled'
  sequence: number
  sessionId: string
  runId: string
  requestId: string
  outcome: AgentRunSettlement
  aborted: boolean
  cancelRequested: boolean
  error: string | null
}

export type AgentRunEvent =
  | AgentRunAcceptedEvent
  | AgentRunRecordEvent
  | AgentRunCancelRequestedEvent
  | AgentRunSettledEvent

export type PetActivityStatus = 'idle' | 'running' | 'cancelling' | 'waiting' | 'completed' | 'cancelled' | 'failed'

export interface PetActivity {
  status: PetActivityStatus
  sessionId: string | null
  runId: string | null
  updatedAt: number
}

export const AGENT_SUBMIT_CHANNEL = 'agent:submit'
export const AGENT_CANCEL_CHANNEL = 'agent:cancel'
export const AGENT_EVENT_CHANNEL = 'agent:event'
export const PET_ACTIVITY_CHANNEL = 'pet:activity'

/** Parse the small, untrusted request shape accepted over Electron IPC. */
export function parseAgentRunRequest(value: unknown): AgentRunRequest {
  if (!isRecord(value)) throw new Error('Agent run request must be an object')

  const sessionId = parseNonEmptyString(value.sessionId, 'sessionId')
  const runId = parseNonEmptyString(value.runId, 'runId')
  const requestId = parseNonEmptyString(value.requestId, 'requestId')
  const prompt = parseNonEmptyString(value.prompt, 'prompt')
  const streamingBehavior = value.streamingBehavior

  if (streamingBehavior !== undefined && streamingBehavior !== 'steer' && streamingBehavior !== 'followUp') {
    throw new Error('streamingBehavior must be steer or followUp')
  }

  return {
    sessionId,
    runId,
    requestId,
    prompt,
    ...(streamingBehavior ? { streamingBehavior } : {}),
  }
}

export function parseAgentRunCancelRequest(value: unknown): AgentRunCancelRequest {
  if (!isRecord(value)) throw new Error('Agent cancel request must be an object')
  return {
    sessionId: parseNonEmptyString(value.sessionId, 'sessionId'),
    runId: parseNonEmptyString(value.runId, 'runId'),
  }
}

function parseNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
