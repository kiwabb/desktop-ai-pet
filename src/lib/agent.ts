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

export type MemoKind = 'note' | 'goal'
export type MemoStatus = 'active' | 'archived'
export interface Memo {
  id: string
  kind: MemoKind
  title: string
  content: string | null
  status: MemoStatus
  review_at: string | null
  created_at: string
}
export const memoKindLabel: Record<MemoKind, string> = { note: '备忘', goal: '长期目标' }
export const memoStatusLabel: Record<MemoStatus, string> = { active: '进行中', archived: '已归档' }
export interface MemoListView {
  generation: number
  items: Memo[]
}
export interface MemoListFilter {
  kind?: MemoKind
  /** Server defaults to false; the memo page needs every row because it
   * toggles archived visibility client-side, so callers pass true. */
  includeArchived?: boolean
}
export function listMemos(filter: MemoListFilter = {}) {
  // Tauri converts the camelCase keys to the Rust snake_case parameters.
  return invoke<MemoListView>('agent_list_memos', { kind: filter.kind ?? null, includeArchived: filter.includeArchived ?? false })
}
export interface MemoMutationView {
  generation: number
  item: Memo
}
export function createMemo(title: string, kind: MemoKind, content: string | null, reviewAt: string | null) {
  return invoke<MemoMutationView>('agent_create_memo', { title, kind, content, reviewAt })
}
export function updateMemo(memoId: string, fields: { title?: string; content?: string | null; kind?: MemoKind }) {
  return invoke<MemoMutationView>('agent_update_memo', { memoId, ...fields })
}
export function archiveMemo(memoId: string, archived: boolean) {
  return invoke<MemoMutationView>('agent_archive_memo', { memoId, archived })
}
export function setMemoReview(memoId: string, reviewAt: string | null, expectedReviewAt: string | null) {
  return invoke<MemoMutationView>('agent_set_memo_review', { memoId, reviewAt, expectedReviewAt })
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
  memo_reviews: Memo[]
  memo_review_error: string | null
  memo_revision: number
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
  ? '还没连上助手'
  : view.connection !== 'connected'
    ? view.connection === 'connecting' ? '正在连接……' : '连接断了，正在重连'
    : !view.model_configured ? '我在，模型还没设置'
      : !view.node_connected ? view.node_error ? '设备暂时离线，聊天照常' : '我在，设备还在登记' : '我在这儿呢'

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
