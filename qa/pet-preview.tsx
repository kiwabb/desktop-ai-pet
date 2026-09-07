import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { PetStage } from '../src/components/PetStage'
import type { PetState } from '../src/lib/pet-state'
import '../src/styles.css'

const states: PetState[] = ['idle', 'curious', 'thinking', 'talking', 'happy', 'sleeping', 'error']

function Preview() {
  const [petState, setPetState] = useState<PetState>('idle')
  const [reply, setReply] = useState<string | null>(null)

  return (
    <div className="preview-wrap">
      <main className="desktop-pet-app pet-shell pet-chat-closed">
        <PetStage
          petState={petState}
          reply={reply}
          mode="reference-closed"
          onPetInteract={() => {
            setPetState('happy')
            window.setTimeout(() => setPetState('idle'), 900)
          }}
          onToggleChat={() => {}}
          onContextMenu={() => {}}
        />
      </main>
      <nav>
        {states.map(state => (
          <button key={state} type="button" onClick={() => setPetState(state)}>{state}</button>
        ))}
        <button type="button" onClick={() => setReply(reply ? null : '你好呀，我是橘伴～今天想聊点什么呢？')}>气泡</button>
      </nav>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
)
