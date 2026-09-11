import { invoke } from '@tauri-apps/api/core'

export type TodoStatus = 'pending' | 'completed'
export interface Todo {
  id: string
  title: string
  status: TodoStatus
  created_at: string
  remind_at: string | null
}
export interface TodoListView {
  generation: number
  items: Todo[]
}
export const todoStatusLabel: Record<TodoStatus, string> = { pending: '待完成', completed: '已完成' }
export function listTodos() {
  return invoke<TodoListView>('agent_list_todos')
}
export interface TodoCompletionView {
  generation: number
  item: Todo
}
export function completeTodo(todoId: string) {
  return invoke<TodoCompletionView>('agent_complete_todo', { todoId })
}
export function reopenTodo(todoId: string) {
  return invoke<TodoCompletionView>('agent_reopen_todo', { todoId })
}

export function setTodoReminder(todoId: string, remindAt: string | null, expectedRemindAt: string | null) {
  return invoke<TodoCompletionView>('agent_set_todo_reminder', { todoId, remindAt, expectedRemindAt })
}

export function createTodo(title: string) {
  return invoke<TodoCompletionView>('agent_create_todo', { title })
}
export function updateTodoTitle(todoId: string, title: string) {
  return invoke<TodoCompletionView>('agent_update_todo', { todoId, title })
}
export function deleteTodo(todoId: string) {
  return invoke<TodoCompletionView>('agent_delete_todo', { todoId })
}

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
  run_id: string | null
}
export interface ToolCall {
  id: string
  run_id: string
  name: string
  status: 'running' | 'completed' | 'failed' | 'needs_reconciliation'
  result: Record<string, unknown> | null
  error: string | null
}
export interface AgentRun {
  id: string
  request_id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted'
  error: string | null
}
export type AgentMode = 'server' | 'local'
export interface AgentView {
  generation: number
  revision: number
  mode: AgentMode
  reminders: Todo[]
  reminder_error: string | null
  todo_revision: number
  configured: boolean
  endpoint: string | null
  connection: 'unconfigured' | 'connecting' | 'connected' | 'disconnected'
  node_connected: boolean
  node_error: string | null
  model: string | null
  model_configured: boolean
  error: string | null
  server_endpoint: string | null
  server_has_token: boolean
  local_endpoint: string | null
  local_model: string | null
  local_has_key: boolean
  snapshot: {
    session_id: string
    seq: number
    messages: AgentMessage[]
    tool_calls: ToolCall[]
    runs: AgentRun[]
  }
}
export const connectionLabel = (view: AgentView | null) => !view?.configured
  ? '助手服务未配置'
  : view.connection !== 'connected'
    ? view.connection === 'connecting' ? '正在连接助手' : '连接已断开，正在重连'
    : !view.model_configured ? '已连接，模型未配置'
      : !view.node_connected ? view.node_error ? '设备暂时离线，聊天可用' : '对话已连接，设备正在登记' : '助手已连接'

export function getAgentView() {
  return invoke<AgentView>('agent_view')
}
export interface AgentSettings {
  mode: AgentMode
  base_url: string
  token: string
  local_base_url: string
  local_api_key: string
  local_model: string
}
export function saveAgentSettings(settings: AgentSettings) {
  return invoke<AgentView>('save_agent_settings', { settings })
}
export function listAgentModels(baseUrl: string, apiKey: string) {
  return invoke<string[]>('agent_list_models', { baseUrl, apiKey })
}
export function submitAgentRun(requestId: string, text: string) {
  return invoke<void>('agent_submit', { requestId, text })
}
