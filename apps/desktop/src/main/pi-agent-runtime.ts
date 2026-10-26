import {
  isPiAgentSettled,
  isPiEventRecord,
  parsePromptDisposition,
  type PiAgentSettledEvent,
  type PiEventRecord,
  type PiPromptData,
  type PiRpcRecord,
  type PiRpcResponse,
} from '../shared/pi-rpc'
import type {
  AgentRunAcceptedEvent,
  AgentRunCancelRequestedEvent,
  AgentRunEvent,
  AgentRunRecordEvent,
  AgentRunRequest,
  AgentRunSettledEvent,
} from '../shared/agent-runtime'

export interface PiRunTransport {
  prompt(message: string, streamingBehavior?: 'steer' | 'followUp'): Promise<PiRpcResponse<PiPromptData>>
  abort(): Promise<PiRpcResponse>
  onRecord(listener: (record: PiRpcRecord) => void): () => void
  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): () => void
}

type RunStatus = 'submitting' | 'accepted' | 'cancelling' | 'settled'

interface RunState {
  request: AgentRunRequest
  status: RunStatus
  requireStartFence: boolean
  started: boolean
  cancelRequested: boolean
  cancelAccepted: boolean
  accepted: AgentRunAcceptedEvent | null
  acceptance: Promise<AgentRunAcceptedEvent> | null
  cancel: Promise<AgentRunCancelRequestedEvent> | null
  bufferedRecords: PiEventRecord[]
  bufferedSettlements: PiAgentSettledEvent[]
}

/**
 * Host-owned application run boundary around the Pi transport.
 *
 * `submit` resolves when Pi accepts the prompt. Final work completion is only
 * published as `run.settled`, so callers cannot mistake command acceptance for
 * model execution completion. Pi's settlement record has no run id; after the
 * first prompt, a new run must observe `agent_start` before a settlement can be
 * attributed to it. This fences duplicate or late settlement records.
 */
export class PiAgentRuntime {
  private readonly listeners = new Set<(event: AgentRunEvent) => void>()
  private readonly requests = new Map<string, RunState>()
  private readonly runs = new Map<string, RunState>()
  private readonly unsubscribeRecord: () => void
  private readonly unsubscribeExit: () => void
  private active: RunState | null = null
  private sequence = 0
  private hasIssuedRun = false
  private disposed = false

  constructor(private readonly transport: PiRunTransport) {
    this.unsubscribeRecord = transport.onRecord((record) => this.handleRecord(record))
    this.unsubscribeExit = transport.onExit((code, signal) => this.handleExit(code, signal))
  }

  onEvent(listener: (event: AgentRunEvent) => void): () => void {
    if (this.disposed) throw new Error('Pi agent runtime is disposed')
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async submit(request: AgentRunRequest): Promise<AgentRunAcceptedEvent> {
    if (this.disposed) throw new Error('Pi agent runtime is disposed')
    validateRequest(request)

    const existingRequest = this.requests.get(request.requestId)
    if (existingRequest) {
      assertSameRequest(existingRequest.request, request)
      if (!existingRequest.acceptance) throw new Error('Agent run acceptance is not initialized')
      return existingRequest.acceptance
    }

    const existingRun = this.runs.get(request.runId)
    if (existingRun) {
      assertSameRequest(existingRun.request, request)
      if (!existingRun.acceptance) throw new Error('Agent run acceptance is not initialized')
      return existingRun.acceptance
    }

    if (this.active && this.active.status !== 'settled') {
      throw new Error('A Pi run is already active')
    }

    const state: RunState = {
      request,
      status: 'submitting' as const,
      requireStartFence: this.hasIssuedRun,
      started: false,
      cancelRequested: false,
      cancelAccepted: false,
      accepted: null,
      acceptance: null,
      cancel: null,
      bufferedRecords: [],
      bufferedSettlements: [],
    }
    this.requests.set(request.requestId, state)
    this.runs.set(request.runId, state)
    this.active = state
    this.hasIssuedRun = true
    state.acceptance = this.acceptPrompt(state)
    return state.acceptance
  }

  async cancel(sessionId: string, runId: string): Promise<AgentRunCancelRequestedEvent> {
    if (this.disposed) throw new Error('Pi agent runtime is disposed')
    const state = this.runs.get(runId)
    if (!state || state.request.sessionId !== sessionId) throw new Error('Unknown agent run')
    if (state.status === 'settled') throw new Error('Agent run is already settled')
    if (state.status === 'submitting') throw new Error('Agent run has not been accepted')
    if (state.cancel) return state.cancel

    state.status = 'cancelling'
    state.cancelRequested = true
    state.cancel = this.acceptCancellation(state)
    return state.cancel
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribeRecord()
    this.unsubscribeExit()
    this.listeners.clear()
    this.active = null
  }

  private async acceptPrompt(state: RunState): Promise<AgentRunAcceptedEvent> {
    try {
      const response = await this.transport.prompt(state.request.prompt, state.request.streamingBehavior)
      const accepted: AgentRunAcceptedEvent = {
        type: 'run.accepted',
        sequence: this.nextSequence(),
        sessionId: state.request.sessionId,
        runId: state.request.runId,
        requestId: state.request.requestId,
        disposition: parsePromptDisposition(response),
      }
      state.accepted = accepted
      state.status = 'accepted'
      this.emit(accepted)
      this.flushBufferedRecords(state)
      for (const settlement of state.bufferedSettlements) this.handleSettlement(state, settlement)
      state.bufferedSettlements = []
      return accepted
    } catch (error) {
      if (this.active === state) this.active = null
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  private async acceptCancellation(state: RunState): Promise<AgentRunCancelRequestedEvent> {
    try {
      const response = await this.transport.abort()
      if (!response.success) throw new Error(response.error || 'Pi cancellation was rejected')

      state.cancelAccepted = true
      const event: AgentRunCancelRequestedEvent = {
        type: 'run.cancel_requested',
        sequence: this.nextSequence(),
        sessionId: state.request.sessionId,
        runId: state.request.runId,
        requestId: state.request.requestId,
      }
      this.emit(event)
      const pendingSettlement = state.bufferedSettlements.shift()
      if (pendingSettlement) this.handleSettlement(state, pendingSettlement)
      return event
    } catch (error) {
      state.status = 'accepted'
      state.cancelRequested = false
      state.cancel = null
      const pendingSettlement = state.bufferedSettlements.shift()
      if (pendingSettlement) this.handleSettlement(state, pendingSettlement)
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  private handleRecord(record: PiRpcRecord): void {
    const state = this.active
    if (!state) return

    if (record.type === 'agent_settled') {
      if (!isPiAgentSettled(record)) return
      if (state.status === 'submitting' || (state.status === 'cancelling' && !state.cancelAccepted)) {
        state.bufferedSettlements.push(record)
      } else {
        this.handleSettlement(state, record)
      }
      return
    }
    if (!isPiEventRecord(record)) return

    if (record.type === 'agent_start') state.started = true
    if (state.status === 'submitting') state.bufferedRecords.push(record)
    else this.emitRecord(state, record)
  }

  private handleSettlement(state: RunState, record: PiAgentSettledEvent): void {
    if (this.active !== state || state.status === 'settled') return
    if (state.requireStartFence && !state.started) return

    state.status = 'settled'
    const event: AgentRunSettledEvent = {
      type: 'run.settled',
      sequence: this.nextSequence(),
      sessionId: state.request.sessionId,
      runId: state.request.runId,
      requestId: state.request.requestId,
      outcome: record.aborted ? 'cancelled' : 'completed',
      aborted: record.aborted,
      cancelRequested: state.cancelRequested,
      error: null,
    }
    this.emit(event)
    this.active = null
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    const state = this.active
    if (!state || !state.accepted || state.status === 'settled') return
    state.status = 'settled'
    const event: AgentRunSettledEvent = {
      type: 'run.settled',
      sequence: this.nextSequence(),
      sessionId: state.request.sessionId,
      runId: state.request.runId,
      requestId: state.request.requestId,
      outcome: 'failed',
      aborted: false,
      cancelRequested: state.cancelRequested,
      error: `Pi process exited (code=${code ?? 'null'}, signal=${signal ?? 'none'})`,
    }
    this.emit(event)
    this.active = null
  }

  private flushBufferedRecords(state: RunState): void {
    for (const record of state.bufferedRecords) this.emitRecord(state, record)
    state.bufferedRecords = []
  }

  private emitRecord(state: RunState, record: PiEventRecord): void {
    const event: AgentRunRecordEvent = {
      type: 'run.record',
      sequence: this.nextSequence(),
      sessionId: state.request.sessionId,
      runId: state.request.runId,
      requestId: state.request.requestId,
      record,
    }
    this.emit(event)
  }

  private emit(event: AgentRunEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  private nextSequence(): number {
    this.sequence += 1
    return this.sequence
  }
}

function validateRequest(request: AgentRunRequest): void {
  assertNonEmpty(request.sessionId, 'sessionId')
  assertNonEmpty(request.runId, 'runId')
  assertNonEmpty(request.requestId, 'requestId')
  assertNonEmpty(request.prompt, 'prompt')
}

function assertNonEmpty(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`)
}

function assertSameRequest(existing: AgentRunRequest, next: AgentRunRequest): void {
  if (
    existing.sessionId !== next.sessionId ||
    existing.runId !== next.runId ||
    existing.requestId !== next.requestId ||
    existing.prompt !== next.prompt ||
    existing.streamingBehavior !== next.streamingBehavior
  ) {
    throw new Error('Agent request id is already bound to a different run')
  }
}
