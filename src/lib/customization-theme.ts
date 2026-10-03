import type { CSSProperties } from 'react'
import type { PetTheme } from './customization'
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
    '--companion-control-line': hex(mix([222, 218, 209], accentColor, .12)),
    '--companion-accent': emphasis, '--companion-action': action, '--companion-action-ink': ink,
    '--companion-action-hover': hover, '--companion-focus': emphasis,
    '--companion-selected': selected, '--companion-user': user,
    '--companion-selection': selection,
    '--companion-shadow-soft': `0 3px 8px ${ink}1f`, '--companion-shadow-panel': `0 3px 4px ${ink}1a`,
    '--companion-focus-ring': `${emphasis}29`,
  }
}

export type PaletteChoice = { name: string; theme: PetTheme }
export function paletteChoices(colors: string[] = [], accent = '#d39964'): PaletteChoice[] {
  const make = (palette: PetTheme['palette'], name: string, primary: string, secondary: string): PaletteChoice => ({ name, theme: { palette, primary, secondary, strength: 65 } })
  return [
    make('character', '它的原色', colors[0] || accent, colors[1] || '#c596a1'),
    make('apricot', '杏桃奶糖', '#d88b4f', '#dfa391'),
    make('rose', '莓果软糖', '#c86a91', '#b695ca'),
    make('mint', '薄荷花园', '#459f87', '#c5b567'),
    make('sky', '晴空汽水', '#5d91c5', '#76b8af'),
    make('lilac', '紫藤来信', '#9b7fc3', '#d68ba4'),
  ]
}
/** Complete two-color palette; absence preserves the exact legacy theme. */
export function presetTheme(accent: string, theme?: PetTheme | null): ThemeStyle {
  if (!theme) return petTheme(accent)
  if (!/^#[\da-f]{6}$/i.test(theme.primary) || !/^#[\da-f]{6}$/i.test(theme.secondary) || !Number.isInteger(theme.strength) || theme.strength < 0 || theme.strength > 100) throw new Error('主题颜色或浓度无效。')
  const rgb = (color: string) => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)) as RGB
  const white: RGB = [255,255,255]
  const primary = rgb(theme.primary), secondary = rgb(theme.secondary)
  const amount = theme.strength / 100
  const tint = (color: RGB, weight: number) => {
    let result = mix(white, color, weight)
    while (contrast(hex(result), '#000000') < 5.5) result = mix(result, white, .05)
    return hex(result)
  }
  const surface = tint(primary, .035 + amount * .095)
  const chrome = tint(secondary, .08 + amount * .18)
  const action = tint(primary, .36 + amount * .28)
  const hover = tint(primary, .43 + amount * .28)
  const selected = tint(primary, .18 + amount * .22)
  const user = tint(secondary, .13 + amount * .24)
  const selection = tint(secondary, .3 + amount * .25)
  const backgrounds = [surface, chrome, action, hover, selected, user, selection]
  const readable = (seed: RGB, surfaces: string[], ratio: number) => {
    let color = seed
    while (surfaces.some(bg => contrast(hex(color), bg) < ratio)) color = color.map(v => Math.floor(v * .9)) as RGB
    return hex(color)
  }
  const ink = readable(mix(primary, [30,25,35], .78), backgrounds, 4.5)
  const muted = readable(mix(primary, [108,99,111], .7), [surface, chrome, selected, user], 4.5)
  const emphasis = readable(primary, [surface, chrome, selected], 4.5)
  return {
    '--companion-ink': ink, '--companion-muted': muted, '--companion-surface': surface,
    '--companion-chrome': chrome, '--companion-line': tint(primary, .22 + amount * .12),
    '--companion-control-line': readable(mix(primary, white, .4), backgrounds, 3),
    '--companion-accent': emphasis, '--companion-action': action, '--companion-action-ink': ink,
    '--companion-action-hover': hover, '--companion-focus': readable(primary, backgrounds, 3),
    '--companion-selected': selected, '--companion-user': user, '--companion-selection': selection,
    '--companion-shadow-soft': `0 3px 8px ${ink}1f`, '--companion-shadow-panel': `0 3px 4px ${ink}1a`,
    '--companion-focus-ring': `${emphasis}29`,
  }
}
