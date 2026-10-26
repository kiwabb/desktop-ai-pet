import { describe, expect, it } from 'vitest'
import { contrast, petTheme, presetTheme } from './customization-theme'

// Legacy complete-theme fixtures remain readable after the gallery was removed.
const paletteChoices = (colors: string[] = []) => [
  [colors[0] || '#c48443', colors[1] || '#38312d'], ['#d88b4f','#dfa391'], ['#c86a91','#b695ca'], ['#459f87','#c5b567'], ['#5d91c5','#76b8af'], ['#9b7fc3','#d68ba4'],
].map(([primary,secondary]) => ({ theme: { palette: 'custom' as const, primary,secondary,strength:65 } }))
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))

describe('custom pet palette roles (unit fixtures)', () => {
  it.each(['#777777', '#000000', '#ffffff'])(
    'respects neutral accent %s without substituting orange or green', seed => {
      const theme = petTheme(seed)
      for (const role of ['action', 'action-hover']) {
        const [r, g, b] = rgb(theme[`--companion-${role}`])
        expect(r).toBe(g)
        expect(g).toBe(b)
      }
      expect(theme['--companion-action']).not.toBe(theme['--companion-chrome'])
      const surface = rgb(theme['--companion-surface'])
      expect(Math.min(...surface)).toBeGreaterThan(240)
      expect(Math.max(...surface) - Math.min(...surface)).toBeLessThan(8)
    },
  )

  it('retains the supplied iris color as a restrained olive-gold action', () => {
    const theme = petTheme('#b3a469')
    const [r, g, b] = rgb(theme['--companion-action'])
    expect(r - g).toBeGreaterThan(5)
    expect(r - g).toBeLessThan(20)
    expect(g - b).toBeGreaterThan(30)
    const [tr, , tb] = rgb(theme['--companion-ink'])
    expect(tr - tb).toBeLessThan(15)
  })

  it('does not replace a low-chroma blue or taupe selection with an unrelated hue', () => {
    const blue = rgb(petTheme('#b3b6bf')['--companion-action'])
    expect(blue[2]).toBeGreaterThan(blue[0])
    const taupe = rgb(petTheme('#756a69')['--companion-action'])
    expect(taupe[0]).toBeGreaterThan(taupe[1])
    expect(taupe[0] - taupe[2]).toBeLessThan(15)
  })

  it('keeps an ivory reading surface while colorful coats personalize action hues', () => {
    const blue = petTheme('#2040e0'), green = petTheme('#40c040'), pink = petTheme('#e04090')
    expect(blue['--companion-surface']).toBe(green['--companion-surface'])
    expect(green['--companion-surface']).toBe(pink['--companion-surface'])
    const [br, , bb] = rgb(blue['--companion-action'])
    const [gr, gg, gb] = rgb(green['--companion-action'])
    const [pr, pg] = rgb(pink['--companion-action'])
    expect(bb).toBeGreaterThan(br)
    expect(gg).toBeGreaterThan(Math.max(gr, gb))
    expect(pr).toBeGreaterThan(pg)
  })

  it('keeps text readable on reading, action, hover and selection surfaces across the color space', () => {
    const values = [0, 51, 102, 153, 204, 255]
    for (const r of values) for (const g of values) for (const b of values) {
      const theme = petTheme('#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''))
      for (const role of ['surface', 'chrome', 'action', 'action-hover', 'selected', 'user', 'selection']) {
        expect(contrast(theme['--companion-ink'], theme[`--companion-${role}`])).toBeGreaterThanOrEqual(4.5)
        expect(contrast(theme['--companion-control-line'], theme[`--companion-${role}`])).toBeGreaterThanOrEqual(3)
      }
      const surface = rgb(theme['--companion-surface']), chrome = rgb(theme['--companion-chrome'])
      const composerSurface = '#' + surface.map((v, i) => Math.round(v * .55 + chrome[i] * .45).toString(16).padStart(2, '0')).join('')
      expect(contrast(theme['--companion-control-line'], composerSurface)).toBeGreaterThanOrEqual(3)
      for (const role of ['surface', 'chrome', 'selected', 'user']) {
        expect(contrast(theme['--companion-muted'], theme[`--companion-${role}`])).toBeGreaterThanOrEqual(4.5)
      }
      for (const role of ['surface', 'chrome', 'selected']) {
        expect(contrast(theme['--companion-accent'], theme[`--companion-${role}`])).toBeGreaterThanOrEqual(4.5)
        expect(contrast(theme['--companion-focus'], theme[`--companion-${role}`])).toBeGreaterThanOrEqual(3)
      }
    }
  })
})


describe('complete coordinated palettes (algorithm fixtures)', () => {
  it('preserves legacy saved themes exactly until a palette is selected', () => {
    expect(presetTheme('#b3a469')).toEqual(petTheme('#b3a469'))
    expect(presetTheme('#777777', null)).toEqual(petTheme('#777777'))
  })
  it('changes reading and secondary surfaces, not only a button', () => {
    const choices = paletteChoices(['#c48443', '#38312d'])
    expect(choices[0].theme.primary).toBe('#c48443')
    expect(choices[0].theme.secondary).toBe('#38312d')
    for (const role of ['surface', 'chrome', 'action', 'user']) {
      expect(new Set(choices.map(c => presetTheme(c.theme.primary, c.theme)[`--companion-${role}`])).size).toBe(6)
    }
  })
  it('keeps all actual text, focus and control pairings readable at all strength limits', () => {
    for (const strength of [0, 50, 100]) for (const choice of [...paletteChoices(), ...['#000000', '#ffffff', '#0000ff', '#ff0000', '#00ff00'].map(primary => ({ theme: { palette: 'custom' as const, primary, secondary: '#000000', strength } }))]) {
      const theme = presetTheme(choice.theme.primary, { ...choice.theme, strength })
      for (const role of ['surface', 'chrome', 'action', 'action-hover', 'selected', 'user', 'selection']) {
        expect(contrast(theme['--companion-ink'], theme[`--companion-${role}`])).toBeGreaterThanOrEqual(4.5)
        expect(contrast(theme['--companion-focus'], theme[`--companion-${role}`])).toBeGreaterThanOrEqual(3)
      }
      for (const role of ['surface', 'chrome', 'selected', 'user']) expect(contrast(theme['--companion-muted'], theme[`--companion-${role}`])).toBeGreaterThanOrEqual(4.5)
    }
  })
})

// Arbitrary pairs cover light and dark secondary colors, independent of presets.
it('keeps rich-theme input boundaries distinct from every supported control surface', () => {
  const colors = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ff00ff', '#00ffff', '#ffff00', '#888888']
  for (const primary of colors) for (const secondary of colors) for (const strength of [0, 50, 100]) {
    const theme = presetTheme(primary, { palette: 'custom', primary, secondary, strength })
    for (const role of ['surface', 'chrome', 'action', 'action-hover', 'selected', 'user', 'selection']) {
      expect(contrast(theme['--companion-control-line'], theme[`--companion-${role}`])).toBeGreaterThanOrEqual(3)
      expect(contrast(theme['--companion-ink'], theme[`--companion-${role}`])).toBeGreaterThanOrEqual(4.5)
    }
  }
})


describe('AI theme design renderer (synthetic JSON, not model outputs)', () => {
  const design = { version: 1 as const, name: 'fixture', summary: 'fixture', colors: { surface:'#fff3e8', surface_alt:'#efe2d3', text:'#574238', muted:'#907562', primary:'#d88a55', secondary:'#998b65', accent_soft:'#f2d2b6', line:'#ad8a73' }, material:'matte' as const, radius:18, border_width:1, shadow:2, control:'soft' as const }
  const theme = { palette:'custom' as const, primary:'#d88a55', secondary:'#998b65', strength:65, design }
  it('makes material, radius, border and control style real tokens', () => {
    const matte = presetTheme(theme.primary,theme)
    const glaze = presetTheme(theme.primary,{...theme,design:{...design,material:'glaze',radius:24,border_width:2,control:'outlined'}})
    expect(matte['--companion-material']).not.toEqual(glaze['--companion-material'])
    expect(glaze['--companion-radius']).toBe('24px')
    expect(glaze['--companion-border-width']).toBe('2px')
    expect(glaze['--companion-action']).toBe(glaze['--companion-surface'])
    expect(glaze['--companion-action-border']).not.toBe('transparent')
  })
  it('protects text and boundary contrast even for invalidly dark or pale provider color choices', () => {
    for (const seed of ['#000000','#ffffff','#ff0000','#0000ff','#00ff00','#777777']) for (const control of ['soft','solid','outlined'] as const) {
      const style = presetTheme(seed,{...theme,design:{...design,control,colors:{surface:seed,surface_alt:seed,text:seed,muted:seed,primary:seed,secondary:seed,accent_soft:seed,line:seed}}})
      for (const role of ['surface','chrome','action','action-hover','selected','user','selection']) {
        expect(contrast(style['--companion-ink'],style[`--companion-${role}`])).toBeGreaterThanOrEqual(4.5)
        expect(contrast(style['--companion-muted'],style[`--companion-${role}`])).toBeGreaterThanOrEqual(4.5)
        expect(contrast(style['--companion-focus'],style[`--companion-${role}`])).toBeGreaterThanOrEqual(3)
        expect(contrast(style['--companion-control-line'],style[`--companion-${role}`])).toBeGreaterThanOrEqual(3)
      }
    }
  })
  it('protects actual material tones when differently colored surfaces blend', () => {
    const seeds = ['#ff0000', '#0000ff', '#777777', '#ffffff']
    for (const surface of seeds) for (const surface_alt of seeds) for (const material of ['paper', 'glaze'] as const) {
      const style = presetTheme(theme.primary, { ...theme, design: { ...design, material, colors: { ...design.colors, surface, surface_alt, text: '#888888', muted: '#888888' } } })
      for (const role of ['material-top', 'material-bottom']) {
        expect(contrast(style['--companion-ink'], style[`--companion-${role}`])).toBeGreaterThanOrEqual(4.5)
        expect(contrast(style['--companion-muted'], style[`--companion-${role}`])).toBeGreaterThanOrEqual(4.5)
        expect(contrast(style['--companion-control-line'], style[`--companion-${role}`])).toBeGreaterThanOrEqual(3)
      }
    }
  })
  it('rejects executable or unbounded provider styling', () => {
    expect(() => presetTheme(theme.primary,{...theme,design:{...design,colors:{...design.colors,surface:'url(https://invalid)'}}})).toThrow()
    expect(() => presetTheme(theme.primary,{...theme,design:{...design,radius:1000}})).toThrow()
  })
})
