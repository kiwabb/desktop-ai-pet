import type { PiEventRecord, PiPromptDisposition } from './pi-rpc'

export interface AgentRunRequest {
  sessionId: string
  runId: string
  requestId: string
  prompt: string
  streamingBehavior?: 'steer' | 'followUp'
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
