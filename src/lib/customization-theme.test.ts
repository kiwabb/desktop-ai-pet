import { describe, expect, it } from 'vitest'
import { contrast, petTheme } from './customization-theme'

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))

describe('custom pet palette roles (unit fixtures)', () => {
  it.each(['#756a69', '#777777', '#000000', '#ffffff', '#b3b6bf'])(
    'keeps neutral coat %s warm and gives actions an apricot hierarchy', seed => {
      const theme = petTheme(seed)
      for (const role of ['surface', 'chrome', 'action', 'action-hover']) {
        const [r, g, b] = rgb(theme[`--companion-${role}`])
        expect(r).toBeGreaterThan(g)
        expect(g).toBeGreaterThan(b)
      }
      const [r, , b] = rgb(theme['--companion-action'])
      expect(r - b).toBeGreaterThan(70)
      const [sr, sg, sb] = rgb(theme['--companion-surface'])
      expect(Math.min(sr, sg, sb)).toBeGreaterThan(235)
      expect(theme['--companion-action']).not.toBe(theme['--companion-chrome'])
    },
  )

  it('keeps a cream reading surface while colorful coats personalize action hues', () => {
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
