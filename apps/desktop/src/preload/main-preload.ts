import { contextBridge, ipcRenderer } from 'electron'
import {
  AGENT_CANCEL_CHANNEL,
  AGENT_EVENT_CHANNEL,
  AGENT_SUBMIT_CHANNEL,
  type AgentRunAcceptedEvent,
  type AgentRunCancelRequest,
  type AgentRunCancelRequestedEvent,
  type AgentRunEvent,
  type AgentRunRequest,
} from '../shared/agent-runtime'

contextBridge.exposeInMainWorld('desktop', {
  openPet: (): Promise<void> => ipcRenderer.invoke('main:pet:open'),
  hidePet: (): Promise<void> => ipcRenderer.invoke('main:pet:hide'),
  getPetState: (): Promise<{ visible: boolean }> => ipcRenderer.invoke('main:pet:state'),
  submitRun: (request: AgentRunRequest): Promise<AgentRunAcceptedEvent> => ipcRenderer.invoke(AGENT_SUBMIT_CHANNEL, request),
  cancelRun: (request: AgentRunCancelRequest): Promise<AgentRunCancelRequestedEvent> =>
    ipcRenderer.invoke(AGENT_CANCEL_CHANNEL, request),
  onRunEvent: (listener: (event: AgentRunEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AgentRunEvent) => listener(payload)
    ipcRenderer.on(AGENT_EVENT_CHANNEL, handler)
    return () => ipcRenderer.removeListener(AGENT_EVENT_CHANNEL, handler)
  },
})
