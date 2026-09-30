import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { X } from 'lucide-react'

import { ChatBubbleFrame } from '../src/components/ChatBubbleFrame'
import type { ChatBubbleTailConfig } from '../src/components/ChatBubbleFrame'
import './preview.css'

const params = new URLSearchParams(window.location.search)

function FramePreview() {
  const [variant, setVariant] = useState<'compact' | 'expanded'>(params.get('mode') === 'expanded' ? 'expanded' : 'compact')
  const [appearance, setAppearance] = useState<'attached' | 'standalone'>('standalone')
  const [visible, setVisible] = useState(true)
  const [animateEntrance, setAnimateEntrance] = useState(false)
  const [tailTop, setTailTop] = useState('')
  const [tailRight, setTailRight] = useState('')
  const [tailWidth, setTailWidth] = useState('')
  const [tailHeight, setTailHeight] = useState('')
  const [dockOffsetX, setDockOffsetX] = useState('')
  const [dockOffsetY, setDockOffsetY] = useState('')
  const [dockScale, setDockScale] = useState('')
  const [secondFrame, setSecondFrame] = useState(false)

  const position = (value: string) => !value.trim() ? undefined : Number.isFinite(Number(value)) ? Number(value) : value
  const tail: ChatBubbleTailConfig = {
    top: position(tailTop),
    right: position(tailRight),
    width: Number(tailWidth) > 0 ? Number(tailWidth) : undefined,
    height: Number(tailHeight) > 0 ? Number(tailHeight) : undefined,
  }

  function resetTail() {
    setTailTop('')
    setTailRight('')
    setTailWidth('')
    setTailHeight('')
  }

  return (
    <main className="qa-page">
      <p className="qa-note">独立组件检查：仅加载气泡框与预览布局样式。中性插槽不含聊天数据，也不调用模型。</p>
      <nav className="qa-controls" aria-label="气泡框属性">
        <label>布局<select value={variant} onChange={event => setVariant(event.target.value as typeof variant)}><option value="compact">紧凑</option><option value="expanded">展开</option></select></label>
        <label>外观<select value={appearance} onChange={event => setAppearance(event.target.value as typeof appearance)}><option value="standalone">独立</option><option value="attached">贴宠物</option></select></label>
        <label><input type="checkbox" checked={visible} onChange={event => setVisible(event.target.checked)} />显示气泡框</label>
        <label><input type="checkbox" checked={animateEntrance} onChange={event => setAnimateEntrance(event.target.checked)} />入场动画</label>
      </nav>
      <fieldset className="qa-controls">
        <legend>尾巴配置（仅贴宠物外观显示；留空使用当前布局默认值）</legend>
        <label>中心位置<input aria-label="尾巴中心位置" value={tailTop} onChange={event => setTailTop(event.target.value)} placeholder="像素或百分比" style={{ width: 110 }} /></label>
        <label>右侧偏移<input aria-label="尾巴右侧偏移" value={tailRight} onChange={event => setTailRight(event.target.value)} placeholder="像素或 CSS 长度" style={{ width: 110 }} /></label>
        <label>宽度<input aria-label="尾巴宽度" type="number" min="1" value={tailWidth} onChange={event => setTailWidth(event.target.value)} placeholder="默认" style={{ width: 70 }} /></label>
        <label>高度<input aria-label="尾巴高度" type="number" min="1" value={tailHeight} onChange={event => setTailHeight(event.target.value)} placeholder="默认" style={{ width: 70 }} /></label>
        <button type="button" onClick={resetTail}>恢复默认尾巴</button>
      </fieldset>
      <fieldset className="qa-controls">
        <legend>一体底盘（显式尾巴配置会切回旧尾巴；留空使用一体外壳）</legend>
        <label>横移<input aria-label="底盘横移" type="number" value={dockOffsetX} onChange={event => setDockOffsetX(event.target.value)} style={{ width: 75 }} /></label>
        <label>纵移<input aria-label="底盘纵移" type="number" value={dockOffsetY} onChange={event => setDockOffsetY(event.target.value)} style={{ width: 75 }} /></label>
        <label>比例<input aria-label="底盘比例" type="number" min="0.1" step="0.1" value={dockScale} onChange={event => setDockScale(event.target.value)} style={{ width: 75 }} /></label>
        <label><input type="checkbox" checked={secondFrame} onChange={event => setSecondFrame(event.target.checked)} />显示第二实例</label>
      </fieldset>
      <div className="qa-frame-host">
        <ChatBubbleFrame
          variant={variant}
          appearance={appearance}
          visible={visible}
          animateEntrance={animateEntrance}
          tail={tail}
          dock={{ offsetX: dockOffsetX ? Number(dockOffsetX) : undefined, offsetY: dockOffsetY ? Number(dockOffsetY) : undefined, scale: dockScale ? Number(dockScale) : undefined }}
          title="气泡框独立预览"
          subtitle="中性插槽，无聊天数据"
          actions={<button className="qa-frame-action" type="button" aria-label="关闭预览" onClick={() => setVisible(false)}><X aria-hidden="true" /></button>}
          footer={<div className="qa-slot">底部插槽</div>}
        >
          <label className="qa-slot">主体插槽<input aria-label="主体插槽输入" placeholder="检查隐藏与焦点" /></label>
        </ChatBubbleFrame>
        <p className="qa-note">普通文档流中的后续内容，用于检查组件是否占据布局空间。</p>
      </div>
      {secondFrame && <div className="qa-frame-host" style={{ marginTop: 100 }}><ChatBubbleFrame variant={variant} appearance={appearance} title="第二个独立实例"><div className="qa-slot">独立 SVG 定义，无业务数据</div></ChatBubbleFrame></div>}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><FramePreview /></StrictMode>)
