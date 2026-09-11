// Temporary diagnosis fixture for task 09-11-ui-polish. Not product code.
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { ChatPanel } from '../src/components/ChatPanel'
import { PetStage } from '../src/components/PetStage'
import type { AgentView, ToolCall } from '../src/lib/agent'
import type { UiMessage } from '../src/components/ChatPanel'
import '../src/styles.css'
import './preview.css'

const status: AgentView = {
  generation: 1,
  revision: 3,
  mode: 'server',
  reminders: [
    { id: 't2', title: '给妈妈回电话', status: 'pending', created_at: '2026-09-10T12:00:00Z', remind_at: '2026-09-11T10:30:00Z' },
  ],
  reminder_error: null,
  todo_revision: 5,
  configured: true,
  endpoint: 'http://127.0.0.1:18081',
  connection: 'connected',
  node_connected: true,
  node_error: null,
  model: 'kimi-k2',
  model_configured: true,
  error: null,
  server_endpoint: 'http://127.0.0.1:18081',
  server_has_token: true,
  local_endpoint: null,
  local_model: null,
  local_has_key: false,
  snapshot: { session_id: 's1', seq: 4, messages: [], tool_calls: [], runs: [] },
}

const messages: UiMessage[] = [
  { id: 'm1', role: 'user', content: '帮我把这周五要做的事整理一下', createdAt: Date.now() - 1000 * 60 * 42 },
  {
    id: 'm2', role: 'assistant', runId: 'r1', createdAt: Date.now() - 1000 * 60 * 40,
    content: '好的，我看了看你的待办列表，周五之前有三件事：\n\n- **整理评审演示文稿**（还没有提醒）\n- 给妈妈回电话（今天 18:30 提醒）\n- 提交季度报销单（已逾期，建议今天处理）\n\n要不要我给演示文稿也设一个明早的提醒？',
  },
  { id: 'm3', role: 'user', content: '设一个明天早上九点半的', createdAt: Date.now() - 1000 * 60 * 38 },
  {
    id: 'm4', role: 'assistant', runId: 'r2', createdAt: Date.now() - 1000 * 60 * 37,
    content: '已设好，明早 9:30 会提醒你。另外报销单已经逾期一天了，需要我现在帮你起草吗？',
  },
]

const tools: ToolCall[] = [
  { id: 'tc1', run_id: 'r2', name: 'todo_list', status: 'completed', result: { ok: true }, error: null },
]

function Preview() {
  const [visible, setVisible] = useState(true)
  return (
    <div className="qa-page">
      <p className="qa-note">诊断夹具（临时）：带示例消息与待办数据，Tauri invoke 已 mock。</p>
      <div className="preview-wrap preview-expanded">
        <main className="desktop-pet-app pet-shell pet-chat-scene pet-chat-expanded">
          <ChatPanel
            attached
            expanded
            visible={visible}
            status={status}
            messages={messages}
            tools={tools}
            streaming={false}
            error={null}
            acceptedRequestId={null}
            onClose={() => setVisible(false)}
            onExpandedChange={(expanded, commitPage) => { commitPage?.() }}
            onSend={() => { throw new Error('diagnosis fixture') }}
          />
        </main>
        <main className="desktop-pet-app pet-shell pet-chat-closed preview-cat-host pet-panel-visible">
          <PetStage petState="idle" reply={null} mode="reference-closed" onPetInteract={() => {}} onToggleChat={() => {}} onContextMenu={() => {}} />
        </main>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><Preview /></StrictMode>)
