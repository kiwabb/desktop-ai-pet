import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { FormEvent } from 'react'

import { ChatPanel } from '../src/components/ChatPanel'
import { PetStage } from '../src/components/PetStage'
import '../src/styles.css'
import './preview.css'

type Mode = 'compact' | 'expanded'

function Preview() {
  const [mode, setMode] = useState<Mode>(new URLSearchParams(window.location.search).get('mode') === 'expanded' ? 'expanded' : 'compact')
  const [visible, setVisible] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)

  function preventUnavailableSave(event: FormEvent) {
    if (event.target instanceof HTMLFormElement && event.target.classList.contains('assistant-connection-card')) {
      event.preventDefault()
      event.stopPropagation()
      setNotice('浏览器预览没有原生配置通道，未保存设置或连接服务。请在桌面应用中配置。')
    }
  }

  return (
    <div className="qa-page">
      <p className="qa-note">浏览器未连接原生助手服务，使用未配置界面且无消息或工具数据。可检查输入、快捷提问、设置导航与收起；发送及保存连接需在桌面应用验证。</p>
      {notice && <p className="qa-note" role="alert">{notice}</p>}
      <nav className="qa-controls" aria-label="预览模式">
        <button type="button" onClick={() => { setMode('compact'); setVisible(true) }}>紧凑气泡</button>
        <button type="button" onClick={() => { setMode('expanded'); setVisible(true) }}>展开面板</button>
        <button type="button" onClick={() => setVisible(current => !current)}>{visible ? '隐藏面板' : '显示面板'}</button>
        <a href="/qa/frame-preview.html">独立气泡框检查</a>
      </nav>
      <div className={`preview-wrap preview-${mode}`} onSubmitCapture={preventUnavailableSave}>
        <main className={`desktop-pet-app pet-shell pet-chat-${mode}`}>
          <ChatPanel
            attached
            expanded={mode === 'expanded'}
            visible={visible}
            animateEntrance
            status={null}
            messages={[]}
            tools={[]}
            streaming={false}
            error={null}
            acceptedRequestId={null}
            onClose={() => setVisible(false)}
            onExpandedChange={expanded => setMode(expanded ? 'expanded' : 'compact')}
            onSend={() => { throw new Error('浏览器预览未连接助手，无法发送消息。') }}
          />
          <PetStage
            petState="idle"
            reply={null}
            mode="reference-closed"
            onPetInteract={() => {}}
            onToggleChat={() => setVisible(current => !current)}
            onContextMenu={() => {}}
          />
        </main>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><Preview /></StrictMode>)
