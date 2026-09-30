import { describe, expect, it } from 'vitest'
import { getAgentPetState } from './pet-state'

describe('pet activity belongs to the current run', () => {
  it('keeps thinking when only an earlier run has text', () => {
    const snapshot = { runs: [{ id: 'new', status: 'running' as const }], messages: [
      { run_id: 'old', role: 'assistant' as const, content: 'earlier reply' },
      { run_id: 'new', role: 'assistant' as const, content: '' },
    ] }
    expect(getAgentPetState({ error: null, snapshot })).toBe('thinking')
    snapshot.messages[1].content = 'actual new reply'
    expect(getAgentPetState({ error: null, snapshot })).toBe('talking')
  })
  it('shows failed or interrupted work until a later run supersedes it', () => {
    for (const status of ['failed', 'interrupted'] as const) {
      expect(getAgentPetState({ error: null, snapshot: { runs: [{ id: 'a', status }], messages: [] } })).toBe('error')
    }
    expect(getAgentPetState({ error: null, snapshot: { runs: [{ id: 'a', status: 'failed' }, { id: 'b', status: 'completed' }], messages: [] } })).toBe('idle')
  })
})
