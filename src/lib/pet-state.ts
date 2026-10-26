import type { AgentMessage, AgentRun } from './agent'

export type PetState =
  | 'idle'
  | 'curious'
  | 'thinking'
  | 'talking'
  | 'happy'
  | 'sleeping'
  | 'error'

export const petStateLabel: Record<PetState, string> = {
  idle: '陪着你',
  curious: '在听',
  thinking: '思考中',
  talking: '回复中',
  happy: '很开心',
  sleeping: '休息中',
  error: '需要帮助',
}

/** Derive activity from the active run, never from a previous reply. */
export function getAgentPetState(view: { error: string | null; snapshot: {
  runs: Pick<AgentRun, 'id' | 'status'>[]
  messages: Pick<AgentMessage, 'run_id' | 'role' | 'content'>[]
} } | null): PetState {
  if (!view) return 'idle'
  if (view.error) return 'error'
  const active = view.snapshot.runs.find(run => run.status === 'queued' || run.status === 'running')
  if (active) {
    for (let index = view.snapshot.messages.length - 1; index >= 0; index--) {
      const message = view.snapshot.messages[index]
      if (message.run_id === active.id && message.role === 'assistant') return message.content.trim() ? 'talking' : 'thinking'
    }
    return 'thinking'
  }
  const last = view.snapshot.runs.at(-1)
  return last?.status === 'failed' || last?.status === 'interrupted' ? 'error' : 'idle'
}
