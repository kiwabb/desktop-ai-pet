import { Check, Send } from 'lucide-react'
import type { PetTheme } from '../lib/customization'
import type { ThemeStyle } from '../lib/customization-theme'
import { presetTheme } from '../lib/customization-theme'

const materials = { matte: '柔雾质感', paper: '纸感质地', glaze: '轻釉光泽' }
const controls = { soft: '柔和按钮', solid: '饱满按钮', outlined: '描边按钮' }
/** A labelled specimen, never a conversation or a selectable template gallery. */
export function PetThemePreview({ accent, theme, saved = false }: { accent: string; theme?: PetTheme; saved?: boolean }) {
  const design = theme?.design
  return <section className="pet-theme-preview" style={{ ...(!design ? { '--companion-material': 'var(--companion-surface)', '--companion-material-inset': 'none', '--companion-radius': '14px', '--companion-control-radius': '99px', '--companion-border-width': '1px', '--companion-action-border': 'transparent' } : {}), ...presetTheme(accent, theme) } as ThemeStyle} aria-label="专属主题预览">
    <div className="pet-theme-story"><h3>{design?.name || '已保存的伙伴主题'}</h3><p>{design?.summary || '保留这个伙伴已保存的配色。重新导入参考图时，AI 会为图片设计新的完整主题。'}</p></div>
    {design && <div className="pet-theme-details"><span>{materials[design.material]}</span><span>{controls[design.control]}</span></div>}
    <div className="pet-theme-specimen" aria-label="界面样式示意，非聊天记录">
      <div className="pet-theme-specimen-header"><strong>界面样式示意</strong><span>不产生聊天记录</span></div>
      <div className="pet-theme-specimen-body"><span className="pet-theme-specimen-tab"><Check size={13} aria-hidden="true" />选中项</span><span className="pet-theme-specimen-muted">辅助文字</span><span className="pet-theme-specimen-bubble">消息气泡</span></div>
      <div className="pet-theme-specimen-footer"><span>输入区域</span><span className="pet-theme-specimen-action"><Send size={13} aria-hidden="true" />操作按钮</span></div>
    </div>
    <p className="customization-hint">{saved ? '和伙伴一起保存，应用后覆盖所有面板。' : '这是本组图片的主题预览；生成桌宠后将一起保存，当前桌面不会改变。'}</p>
    {theme?.source && <p className="customization-hint">由 {theme.source.model} 看图设计</p>}
  </section>
}
