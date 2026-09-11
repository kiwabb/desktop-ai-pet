import { StrictMode, useState, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'

import { ChatPanel } from '../src/components/ChatPanel'
import '../src/styles.css'

const messages = Array.from({ length: 40 }, (_, i) => ({
  id: `m${i}`,
  role: (i % 2 ? 'assistant' : 'user') as 'assistant' | 'user',
  content: `第 ${i + 1} 条消息：这是一段用于制造真实渲染成本的对话内容，包含足够多的文字让消息气泡具有代表性的排版与绘制开销。`,
  createdAt: Date.now() - (40 - i) * 60000,
}))

/** 复刻真实聊天窗：940×760 固定后备 + pet-chat-scene compact 时 713×401 右下锚定，
 * 真实 ChatPanel（消息列表/输入区）。toggle 保留 flushSync 作为压力场景：
 * 即使调用方同步提交，新 morph 时序（绘制稳定后才开始交叉淡入）也必须不出现空白帧。 */
function MorphDebug2() {
  const [expanded, setExpanded] = useState(false)
  const toggle = useCallback(() => {
    performance.mark('morph-toggle')
    flushSync(() => setExpanded(current => !current))
  }, [])
  ;(window as unknown as { __morphToggle: () => void }).__morphToggle = toggle
  return (
    <div style={{ position: 'relative', width: 940, height: 760 }}>
      <main className={`desktop-pet-app pet-shell pet-chat-scene pet-chat-${expanded ? 'expanded' : 'compact'}`}>
        <ChatPanel
          attached
          expanded={expanded}
          visible
          tail={{}}
          status={null}
          messages={messages}
          tools={[]}
          streaming={false}
          error={null}
          onClose={() => {}}
          onExpandedChange={value => flushSync(() => setExpanded(value))}
          acceptedRequestId={null}
          onSend={() => ({ requestId: 'qa', accepted: Promise.resolve() })}
        />
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><MorphDebug2 /></StrictMode>)
