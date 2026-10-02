import type { CSSProperties } from 'react'
type RGB = [number, number, number]
const mix = (a: RGB, b: RGB, amount: number): RGB => a.map((v, i) => Math.round(v * (1 - amount) + b[i] * amount)) as RGB
const hex = (v: RGB) => '#' + v.map(n => n.toString(16).padStart(2, '0')).join('')
export function contrast(a: string, b: string) {
  const luminance = (color: string) => {
    const v = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
    return v[0] * .2126 + v[1] * .7152 + v[2] * .0722
  }
  const x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05)
}
export type ThemeStyle = CSSProperties & Record<`--${string}`, string>
/** Keep custom surfaces quiet and use the selected accent for interaction.
 * Derived at render time; saved assets and the built-in cat stay unchanged.
 */
export function petTheme(accent: string): ThemeStyle {
  if (!/^#[\da-f]{6}$/i.test(accent)) throw new Error('主题色需要是六位十六进制颜色。')
  const seed = [1, 3, 5].map(i => parseInt(accent.slice(i, i + 2), 16)) as RGB
  const white: RGB = [255, 255, 255], black: RGB = [0, 0, 0]
  const ivory: RGB = [252, 251, 247]
  const taupe: RGB = [69, 65, 59]
  // Tint/shade the selected color without replacing low-chroma hues. Bound
  // brightness so very dark/light seeds still produce a distinct soft action.
  let accentColor = mix(seed, white, .32)
  const brightness = accentColor.reduce((sum, channel) => sum + channel, 0) / 3
  if (brightness < 160) accentColor = mix(accentColor, white, (160 - brightness) / (255 - brightness))
  if (brightness > 216) accentColor = mix(accentColor, black, (brightness - 216) / brightness)
  // Blue-heavy colors can be dark despite a high RGB average. Keep every
  // action bright enough for readable dark text, including its hover shade.
  while (contrast(hex(mix(accentColor, black, .07)), '#000000') < 5.5) accentColor = mix(accentColor, white, .05)
  const surface = hex(ivory)
  const chrome = hex(mix([242, 240, 234], accentColor, .08))
  const action = hex(accentColor), hover = hex(mix(accentColor, black, .07))
  const selected = hex(mix(accentColor, ivory, .53))
  const user = hex(mix(accentColor, ivory, .78))
  const selection = hex(mix(accentColor, ivory, .35))
  const readable = (base: RGB, backgrounds: string[]) => {
    let color = base
    while (backgrounds.some(bg => contrast(hex(color), bg) < 4.5)) color = color.map(channel => Math.floor(channel * .9)) as RGB
    return hex(color)
  }
  const surfaces = [surface, chrome, action, hover, selected, user, selection]
  const ink = readable(taupe, surfaces)
  const muted = readable([115, 110, 102], [surface, chrome, selected, user])
  const emphasis = readable(seed, [surface, chrome, selected])
  return {
    '--companion-ink': ink, '--companion-muted': muted, '--companion-surface': surface,
    '--companion-chrome': chrome, '--companion-line': hex(mix([222, 218, 209], accentColor, .12)),
    '--companion-accent': emphasis, '--companion-action': action, '--companion-action-ink': ink,
    '--companion-action-hover': hover, '--companion-focus': emphasis,
    '--companion-selected': selected, '--companion-user': user,
    '--companion-selection': selection,
    '--companion-shadow-soft': `0 3px 8px ${ink}1f`, '--companion-shadow-panel': `0 3px 4px ${ink}1a`,
    '--companion-focus-ring': `${emphasis}29`,
  }
}
