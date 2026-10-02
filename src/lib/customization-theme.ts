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
/** Fur provides a coordinated accent, not a paint bucket for every UI role.
 * Neutral coats keep the companion's cream/apricot/cocoa identity. This is
 * derived at render time so saved presets improve without rewriting assets.
 */
export function petTheme(accent: string): ThemeStyle {
  if (!/^#[\da-f]{6}$/i.test(accent)) throw new Error('主题色需要是六位十六进制颜色。')
  const seed = [1, 3, 5].map(i => parseInt(accent.slice(i, i + 2), 16)) as RGB
  const white: RGB = [255, 255, 255], black: RGB = [0, 0, 0]
  const cream: RGB = [255, 250, 244], apricot: RGB = [244, 189, 126]
  const cocoa: RGB = [108, 70, 49]
  const min = Math.min(...seed), max = Math.max(...seed)
  const chroma = (max - min) / 255
  // Fade into hue-derived accents; tiny differences in gray fur must not
  // turn actions slate-colored, nor cause a hard palette jump at a cutoff.
  const colorWeight = Math.max(0, Math.min(1, (chroma - .12) / .18))
  const hueColor = max === min ? apricot : seed.map(v => Math.round(96 + (v - min) / (max - min) * 159)) as RGB
  const accentColor = mix(apricot, mix(hueColor, white, .35), colorWeight)
  const surface = hex(cream)
  const chrome = hex(mix([255, 240, 221], accentColor, .08 * colorWeight))
  const action = hex(accentColor), hover = hex(mix(accentColor, cocoa, .08))
  const selected = hex(mix(accentColor, cream, .53))
  const user = hex(mix(accentColor, cream, .7))
  const selection = hex(mix(accentColor, cream, .35))
  const readable = (base: RGB, backgrounds: string[]) => {
    let color = base
    while (backgrounds.some(bg => contrast(hex(color), bg) < 4.5)) color = mix(color, black, .1)
    return hex(color)
  }
  const surfaces = [surface, chrome, action, hover, selected, user, selection]
  const ink = readable(mix(cocoa, seed, .08), surfaces)
  const muted = readable([139, 103, 83], [surface, chrome, selected, user])
  const emphasis = readable(mix([164, 91, 43], seed, .6 * colorWeight), [surface, chrome, selected])
  return {
    '--companion-ink': ink, '--companion-muted': muted, '--companion-surface': surface,
    '--companion-chrome': chrome, '--companion-line': hex(mix([238, 216, 191], accentColor, .15 * colorWeight)),
    '--companion-accent': emphasis, '--companion-action': action, '--companion-action-ink': ink,
    '--companion-action-hover': hover, '--companion-focus': emphasis,
    '--companion-selected': selected, '--companion-user': user,
    '--companion-selection': selection,
    '--companion-shadow-soft': `0 3px 8px ${ink}1f`, '--companion-shadow-panel': `0 3px 4px ${ink}1a`,
    '--companion-focus-ring': `${emphasis}29`,
  }
}
