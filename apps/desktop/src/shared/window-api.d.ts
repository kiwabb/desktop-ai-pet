export {}

import type {
  AgentRunAcceptedEvent,
  AgentRunCancelRequest,
  AgentRunCancelRequestedEvent,
  AgentRunEvent,
  AgentRunRequest,
  PetActivity,
} from './agent-runtime'

declare global {
  interface Window {
    desktop?: {
      openPet(): Promise<void>
      hidePet(): Promise<void>
      getPetState(): Promise<{ visible: boolean }>
      submitRun(request: AgentRunRequest): Promise<AgentRunAcceptedEvent>
      cancelRun(request: AgentRunCancelRequest): Promise<AgentRunCancelRequestedEvent>
      onRunEvent(listener: (event: AgentRunEvent) => void): () => void
    }
    pet?: {
      openMain(): Promise<void>
      hide(): Promise<void>
      getActivity(): Promise<PetActivity>
      onActivityChange(listener: (activity: PetActivity) => void): () => void
      onVisibilityChange(listener: (state: { visible: boolean }) => void): () => void
    }
  }
}
