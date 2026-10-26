import { describe, expect, it } from 'vitest'

import type { AgentRunEvent } from '../shared/agent-runtime'
import { petActivityFromAgentEvent } from './pet-activity'

const base = { sessionId: 'session-1', runId: 'run-1', requestId: 'request-1' }

describe('pet activity projection', () => {
  it('exposes only compact run state and identity', () => {
    const event: AgentRunEvent = {
      type: 'run.record',
      sequence: 2,
      ...base,
      record: { type: 'message_update', delta: 'private model output must not reach the pet' },
    }

    expect(petActivityFromAgentEvent(event, 123)).toEqual({
      status: 'running',
      sessionId: 'session-1',
      runId: 'run-1',
      updatedAt: 123,
    })
    expect(petActivityFromAgentEvent({ type: 'run.settled', sequence: 3, ...base, outcome: 'failed', aborted: false, cancelRequested: false, error: 'secret provider error' }, 456)).toEqual({
      status: 'failed',
      sessionId: 'session-1',
      runId: 'run-1',
      updatedAt: 456,
    })
  })
})
