import { describe, expect, it } from 'vitest'

import type { AgentRunEvent, AgentRunRequest } from '../shared/agent-runtime'
import type { PiPromptData, PiRpcRecord, PiRpcResponse } from '../shared/pi-rpc'
import { PiAgentRuntime, type PiRunTransport } from './pi-agent-runtime'

class FakePiTransport implements PiRunTransport {
  promptCalls: string[] = []
  abortCalls = 0
  private promptResult: Promise<PiRpcResponse<PiPromptData>> = Promise.resolve({
    type: 'response',
    command: 'prompt',
    success: true,
    data: { disposition: 'started' },
  })
  private abortResult: Promise<PiRpcResponse> = Promise.resolve({
    type: 'response',
    command: 'abort',
    success: true,
  })
  private readonly recordListeners = new Set<(record: PiRpcRecord) => void>()
  private readonly exitListeners = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>()

  onRecord(listener: (record: PiRpcRecord) => void): () => void {
    this.recordListeners.add(listener)
    return () => this.recordListeners.delete(listener)
  }

  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): () => void {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  prompt(message: string): Promise<PiRpcResponse<PiPromptData>> {
    this.promptCalls.push(message)
    return this.promptResult
  }

  abort(): Promise<PiRpcResponse> {
    this.abortCalls += 1
    return this.abortResult
  }

  setPromptResult(result: Promise<PiRpcResponse<PiPromptData>>): void {
    this.promptResult = result
  }

  setAbortResult(result: Promise<PiRpcResponse>): void {
    this.abortResult = result
  }

  emitRecord(record: PiRpcRecord): void {
    for (const listener of this.recordListeners) listener(record)
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null): void {
    for (const listener of this.exitListeners) listener(code, signal)
  }
}

const request = (overrides: Partial<AgentRunRequest> = {}): AgentRunRequest => ({
  sessionId: 'session-1',
  runId: 'run-1',
  requestId: 'request-1',
  prompt: 'hello',
  ...overrides,
})

const response = (command: string, data?: PiPromptData): PiRpcResponse<PiPromptData> => ({
  type: 'response',
  command,
  success: true,
  ...(data ? { data } : {}),
})

describe('PiAgentRuntime', () => {
  it('separates prompt acceptance from settlement and orders host events', async () => {
    const transport = new FakePiTransport()
    const runtime = new PiAgentRuntime(transport)
    const events: AgentRunEvent[] = []
    runtime.onEvent((event) => events.push(event))

    const accepted = await runtime.submit(request())
    expect(accepted.type).toBe('run.accepted')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'run.accepted', sessionId: 'session-1', runId: 'run-1' })

    transport.emitRecord({ type: 'agent_start' })
    transport.emitRecord({ type: 'message_update', delta: 'hi' })
    transport.emitRecord({ type: 'agent_settled', aborted: false })

    expect(events.map((event) => event.type)).toEqual(['run.accepted', 'run.record', 'run.record', 'run.settled'])
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4])
    expect(events.at(-1)).toMatchObject({ type: 'run.settled', outcome: 'completed', aborted: false })
    runtime.dispose()
  })

  it('deduplicates the same request and ignores a duplicate late settlement', async () => {
    const transport = new FakePiTransport()
    const runtime = new PiAgentRuntime(transport)
    const events: AgentRunEvent[] = []
    runtime.onEvent((event) => events.push(event))

    const first = runtime.submit(request())
    const duplicate = runtime.submit(request())
    expect(await duplicate).toEqual(await first)
    expect(transport.promptCalls).toEqual(['hello'])

    transport.emitRecord({ type: 'agent_settled', aborted: false })
    expect(events).toHaveLength(2)
    transport.emitRecord({ type: 'agent_settled', aborted: false })
    expect(events).toHaveLength(2)
    runtime.dispose()
  })

  it('rejects a request that reuses a run id with a different request id', async () => {
    const transport = new FakePiTransport()
    const runtime = new PiAgentRuntime(transport)

    await runtime.submit(request())
    await expect(runtime.submit(request({ requestId: 'request-2' }))).rejects.toThrow(
      'Agent request id is already bound to a different run',
    )
    expect(transport.promptCalls).toEqual(['hello'])
    runtime.dispose()
  })

  it('requires a fresh agent_start before attributing a later settlement', async () => {
    const transport = new FakePiTransport()
    const runtime = new PiAgentRuntime(transport)
    const events: AgentRunEvent[] = []
    runtime.onEvent((event) => events.push(event))

    await runtime.submit(request())
    transport.emitRecord({ type: 'agent_settled', aborted: false })
    await runtime.submit(request({ runId: 'run-2', requestId: 'request-2', prompt: 'second' }))

    transport.emitRecord({ type: 'agent_settled', aborted: false })
    expect(events.filter((event) => event.type === 'run.settled')).toHaveLength(1)

    transport.emitRecord({ type: 'agent_start' })
    transport.emitRecord({ type: 'agent_settled', aborted: false })
    expect(events.filter((event) => event.type === 'run.settled')).toHaveLength(2)
    expect(events.at(-1)).toMatchObject({ runId: 'run-2', outcome: 'completed' })
    runtime.dispose()
  })

  it('makes cancellation explicit and settles only after Pi confirms the abort command', async () => {
    const transport = new FakePiTransport()
    let resolveAbort: (value: PiRpcResponse) => void = () => undefined
    transport.setAbortResult(new Promise((resolve) => { resolveAbort = resolve }))
    const runtime = new PiAgentRuntime(transport)
    const events: AgentRunEvent[] = []
    runtime.onEvent((event) => events.push(event))

    await runtime.submit(request())
    const cancellation = runtime.cancel('session-1', 'run-1')
    transport.emitRecord({ type: 'agent_settled', aborted: true })
    expect(events.map((event) => event.type)).toEqual(['run.accepted'])

    resolveAbort(response('abort'))
    await expect(cancellation).resolves.toMatchObject({ type: 'run.cancel_requested' })
    expect(events.map((event) => event.type)).toEqual(['run.accepted', 'run.cancel_requested', 'run.settled'])
    expect(events.at(-1)).toMatchObject({ outcome: 'cancelled', aborted: true, cancelRequested: true })
    expect(transport.abortCalls).toBe(1)
    runtime.dispose()
  })

  it('rejects malformed requests before invoking Pi', async () => {
    const transport = new FakePiTransport()
    const runtime = new PiAgentRuntime(transport)

    await expect(runtime.submit({ ...request(), prompt: '   ' })).rejects.toThrow('prompt must be a non-empty string')
    await expect(runtime.submit({ ...request(), streamingBehavior: 'unknown' as 'steer' })).rejects.toThrow(
      'streamingBehavior must be steer or followUp',
    )
    expect(transport.promptCalls).toEqual([])
    runtime.dispose()
  })

  it('settles an accepted run as failed when the Pi child exits', async () => {
    const transport = new FakePiTransport()
    const runtime = new PiAgentRuntime(transport)
    const events: AgentRunEvent[] = []
    runtime.onEvent((event) => events.push(event))

    await runtime.submit(request())
    transport.emitExit(1, null)

    expect(events).toHaveLength(2)
    expect(events.at(-1)).toMatchObject({ type: 'run.settled', outcome: 'failed', aborted: false })
    expect((events.at(-1) as Extract<AgentRunEvent, { type: 'run.settled' }>).error).toContain('code=1')
    runtime.dispose()
  })
})
