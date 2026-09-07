import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { ChatPanel, type UiMessage } from '../src/components/ChatPanel'
import { PetStage } from '../src/components/PetStage'
import type { PetState } from '../src/lib/pet-state'
import '../src/styles.css'

const demoMessages: UiMessage[] = [
  { id: '1', role: 'user', content: '今天天气真好呀', createdAt: Date.now() - 60_000 },
  { id: '2', role: 'assistant', content: '是呀，阳光暖洋洋的，好想趴在窗台上打个盹～', createdAt: Date.now() - 58_000 },
]

function Preview() {
  const [mode, setMode] = useState<'compact' | 'expanded'>(
    new URLSearchParams(window.location.search).get('mode') === 'expanded' ? 'expanded' : 'compact',
  )
  const [petState] = useState<PetState>('idle')
  const [messages, setMessages] = useState<UiMessage[]>(demoMessages)

  return (
    <div className={`preview-wrap preview-${mode}`}>
      <main className={`desktop-pet-app pet-shell pet-chat-${mode}`}>
        <ChatPanel
          attached
          expanded={mode === 'expanded'}
          status={{ configured: true, model: 'demo', endpoint: 'https://demo', source: 'local_file' }}
          messages={messages}
          streaming={false}
          error={null}
          onStatusChange={() => {}}
          onClose={() => {}}
          onExpandedChange={expanded => setMode(expanded ? 'expanded' : 'compact')}
          onSend={async (content) => {
            setMessages(current => [
              ...current,
              { id: crypto.randomUUID(), role: 'user', content, createdAt: Date.now() },
              { id: crypto.randomUUID(), role: 'assistant', content: '喵～收到啦！', createdAt: Date.now() },
            ])
          }}
        />
        <PetStage
          petState={petState}
          reply={null}
          mode="reference-closed"
          onPetInteract={() => {}}
          onToggleChat={() => {}}
          onContextMenu={() => {}}
        />
      </main>
      <nav>
        <button type="button" onClick={() => setMode('compact')}>紧凑气泡</button>
        <button type="button" onClick={() => setMode('expanded')}>展开面板</button>
      </nav>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
)
