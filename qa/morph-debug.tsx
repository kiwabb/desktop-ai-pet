import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { ChatBubbleFrame } from '../src/components/ChatBubbleFrame'
import '../src/styles.css'

/** 复刻真实桌面场景：.pet-shell 宿主 + styles.css 的 attached 绝对定位几何，
 * 一体外壳（tail={}），无入场动画。window.__morphToggle 供探针同步触发。 */
function MorphDebug() {
  const [variant, setVariant] = useState<'compact' | 'expanded'>('compact')
  ;(window as unknown as { __morphToggle: () => void }).__morphToggle = () => {
    performance.mark('morph-toggle')
    setVariant(current => current === 'compact' ? 'expanded' : 'compact')
  }
  return (
    <div className={`pet-shell pet-chat-${variant}`} style={{ position: 'relative', width: 960, height: 700, margin: 40 }}>
      <ChatBubbleFrame
        variant={variant}
        appearance="attached"
        tail={{}}
        visible
        title="morph 诊断"
        subtitle="复刻 attached absolute 场景"
        footer={<div style={{ padding: 16, color: '#8a7f78', fontSize: 13 }}>底部插槽（输入区占位）</div>}
      >
        <div style={{ padding: 20, color: '#8a7f78', fontSize: 13 }}>
          {variant === 'expanded' ? '展开态主体内容：消息列表占位。'.repeat(6) : '紧凑态主体。'}
        </div>
      </ChatBubbleFrame>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><MorphDebug /></StrictMode>)
