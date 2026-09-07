import { invoke } from '@tauri-apps/api/core'

export interface AiStatus {
  configured: boolean
  model: string | null
  endpoint: string | null
  source: 'environment' | 'local_file' | null
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  requestId: string
  messages: ChatMessage[]
}

export interface AiStreamEvent {
  requestId: string
  kind: 'chunk' | 'done'
  content: string
}

export function getAiStatus() {
  return invoke<AiStatus>('ai_status')
}

export interface SaveAiSettings {
  baseUrl: string
  apiKey: string
  model: string
}

export function saveAiSettings(settings: SaveAiSettings) {
  return invoke<AiStatus>('save_ai_settings', { settings })
}

export interface ListModelsRequest {
  baseUrl: string
  apiKey: string
}

export function listAiModels(request: ListModelsRequest) {
  return invoke<string[]>('list_ai_models', { request })
}

export function streamChat(request: ChatRequest) {
  return invoke<void>('stream_chat', { request })
}
