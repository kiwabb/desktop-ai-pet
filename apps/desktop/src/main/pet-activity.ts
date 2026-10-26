import type { AgentRunEvent, PetActivity } from '../shared/agent-runtime'

export const IDLE_PET_ACTIVITY: PetActivity = {
  status: 'idle',
  sessionId: null,
  runId: null,
  updatedAt: 0,
}

export function petActivityFromAgentEvent(event: AgentRunEvent, now = Date.now()): PetActivity {
  const identity = { sessionId: event.sessionId, runId: event.runId, updatedAt: now }
  switch (event.type) {
    case 'run.accepted':
    case 'run.record':
      return { ...identity, status: 'running' }
    case 'run.cancel_requested':
      return { ...identity, status: 'cancelling' }
    case 'run.settled':
      return { ...identity, status: event.outcome }
  }
}
