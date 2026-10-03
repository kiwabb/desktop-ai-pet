import { Check, RotateCcw, SlidersHorizontal } from 'lucide-react'
import type { PetTheme } from '../lib/customization'
import { paletteChoices, presetTheme } from '../lib/customization-theme'

export function PetThemePicker({ accent, colors, value, onChange, onReset }: {
  accent: string; colors?: string[]; value?: PetTheme
  onChange: (theme: PetTheme) => void; onReset: () => void
}) {
  const choices = paletteChoices(colors, accent)
  const current = value ?? choices[0].theme
  return <section className="pet-theme-picker" aria-label="完整主题搭配">
    <div className="customization-section-title"><h3>给日常换个颜色</h3><button type="button" onClick={onReset}><RotateCcw size={13} aria-hidden="true" />还原已保存</button></div>
    <p className="customization-hint">选一套喜欢的搭配，整个面板一起换色。无需重新生成。</p>
    <div className="pet-theme-options" role="group" aria-label="选择主题">
      {choices.map(choice => <button key={choice.theme.palette} type="button" className="pet-theme-option" style={presetTheme(choice.theme.primary, { ...choice.theme, strength: value?.strength ?? 65 })} aria-pressed={value?.palette === choice.theme.palette} onClick={() => onChange({ ...choice.theme, strength: value?.strength ?? 65 })}>
        <span className="pet-theme-sample" aria-hidden="true"><span /><span /><span /></span>
        <span className="pet-theme-option-name">{choice.name}{value?.palette === choice.theme.palette && <Check size={13} aria-hidden="true" />}</span>
      </button>)}
    </div>
    {!value && <p className="customization-hint">保留原配色中 · 选择搭配后开始预览</p>}
    <label className="pet-theme-strength">色彩浓度 <span>{value ? `${value.strength}%` : '选择搭配后可调'}</span>
      <input type="range" min="0" max="100" step="5" disabled={!value} value={value?.strength ?? 65} onChange={event => onChange({ ...current, strength: Number(event.target.value) })} />
    </label>
    <div className="pet-theme-specimen" aria-label="组件配色示意，非聊天记录">
      <div className="pet-theme-specimen-header"><strong>面板配色示意</strong><span>不写入聊天记录</span></div>
      <div className="pet-theme-specimen-body"><span className="pet-theme-specimen-tab">选中项</span><span className="pet-theme-specimen-muted">辅助文字</span><span className="pet-theme-specimen-bubble">你的消息色</span></div>
      <div className="pet-theme-specimen-footer"><span>输入区域</span><span className="pet-theme-specimen-action">操作按钮</span></div>
    </div>
    <details className="pet-theme-advanced"><summary><SlidersHorizontal size={14} aria-hidden="true" />进阶调色</summary>
      <div><label>主色<input type="color" value={current.primary} onChange={event => onChange({ ...current, palette: 'custom', primary: event.target.value })} /></label><label>辅助色<input type="color" value={current.secondary} onChange={event => onChange({ ...current, palette: 'custom', secondary: event.target.value })} /></label></div>
      <p className="customization-hint">主色用于按钮与面板，辅助色用于输入区和消息。文字会自动保持清晰。</p>
    </details>
  </section>
}
