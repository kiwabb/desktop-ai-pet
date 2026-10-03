import { describe, expect, it } from 'vitest'
import { contrast, petTheme, presetTheme, paletteChoices } from './customization-theme'

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
      }
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
