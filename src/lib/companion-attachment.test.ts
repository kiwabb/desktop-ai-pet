import { describe, expect, it } from 'vitest'
import { resolveCompanionAttachment } from './companion-attachment'
import { parsePanelViewport } from './companion-preferences'
import type { PanelViewport } from './companion-preferences'

const viewport: PanelViewport = { width: 720, height: 680, side: 'left', petAnchor: { x: 834.36, y: 445.56 } }

describe('native companion viewport boundary', () => {
  it('accepts logical off-backing coordinates from either command or event', () => {
    expect(parsePanelViewport(viewport)).toEqual(viewport)
    const mirrored = { ...viewport, side: 'right', petAnchor: { x: -141.64, y: 445.56 } }
    expect(parsePanelViewport(mirrored)).toEqual(mirrored)
  })

  it('preserves compatible dimensions but drops absent or invalid attachment metadata', () => {
    for (const petAnchor of [undefined, null, {}, { x: NaN, y: 40 }, { x: 30, y: Infinity }, { x: '30', y: 40 }]) {
      expect(parsePanelViewport({ width: 720, height: 680, petAnchor })).toEqual({ width: 720, height: 680, side: 'left', petAnchor: null })
    }
    expect(parsePanelViewport({ width: 720, height: 680 })).toEqual({ width: 720, height: 680, side: 'left', petAnchor: null })
  })

  it('rejects unmeasurable backing dimensions instead of positioning against them', () => {
    for (const value of [null, {}, { width: 0, height: 680 }, { width: -1, height: 680 }, { width: '720', height: 680 }, { width: 720, height: Infinity }])
      expect(parsePanelViewport(value)).toBeNull()
  })

  it('accepts finite nonnegative native reach and safely ignores invalid metadata', () => {
    expect(parsePanelViewport({ ...viewport, tailReach: 60 })?.tailReach).toBe(60)
    expect(parsePanelViewport({ ...viewport, tailReach: 0 })?.tailReach).toBe(0)
    expect(resolveCompanionAttachment(parsePanelViewport({ ...viewport, tailReach: 0 }), false)?.tail).toBeNull()
    for (const tailReach of [null, '44', NaN, Infinity, -1]) {
      const parsed = parsePanelViewport({ ...viewport, tailReach })
      expect(parsed).toEqual(viewport)
      expect(resolveCompanionAttachment(parsed, false)?.tail?.width).toBe(28)
    }
    for (const tailReach of [4, 1000])
      expect(resolveCompanionAttachment(parsePanelViewport({ ...viewport, tailReach }), false)?.tail).toBeNull()
  })
})

describe('cat-facing panel attachment', () => {
  it('preserves the legacy corner for hosts without native reach metadata', () => {
    const result = resolveCompanionAttachment(viewport, false)
    expect(result?.frame).toEqual({ x: 256, y: 284, width: 420, height: 380 })
    expect(result?.tail).toEqual({ x: 676, y: 421.56, width: 28, height: 48, direction: 'right' })
    expect(result && result.tail && result.tail.x + result.tail.width).toBe(704)
  })

  it('mirrors left-pointing decoration without changing size or useful gutter', () => {
    const result = resolveCompanionAttachment({ ...viewport, side: 'right', petAnchor: { x: -141.64, y: 445.56 } }, false)
    expect(result?.frame).toEqual({ x: 44, y: 284, width: 420, height: 380 })
    expect(result?.tail).toEqual({ x: 16, y: 421.56, width: 28, height: 48, direction: 'left' })
  })

  it('clamps at the top and bottom and clears the rounded corners', () => {
    const top = resolveCompanionAttachment({ ...viewport, petAnchor: { x: 834, y: 20 } }, false)
    const bottom = resolveCompanionAttachment({ ...viewport, petAnchor: { x: 834, y: 660 } }, false)
    expect(top?.frame.y).toBe(16)
    expect(top?.originY).toBe(48)
    expect(top?.tail?.y).toBe(40)
    expect(bottom?.frame.y).toBe(284)
    expect(bottom?.originY).toBe(332)
    expect(bottom?.tail?.y).toBe(592)
  })

  it('keeps the same desktop target and tail center when compact reading expands', () => {
    const compact = resolveCompanionAttachment(viewport, false)
    const expanded = resolveCompanionAttachment(viewport, true)
    expect(expanded?.frame).toEqual({ x: 16, y: 16, width: 660, height: 648 })
    expect(compact?.tail).toEqual(expanded?.tail)
    const highFace = { ...viewport, petAnchor: { x: 834, y: 180 } }
    expect(resolveCompanionAttachment(highFace, false)?.frame.y).toBe(24)
    expect(resolveCompanionAttachment(highFace, false)?.tail).toEqual(resolveCompanionAttachment(highFace, true)?.tail)
  })

  it('returns the corner reservation to usable content on narrow backing dimensions', () => {
    for (const width of [320, 360]) {
      for (const side of ['left', 'right'] as const) {
        const small = { width, height: 320, side, petAnchor: { x: side === 'left' ? 410 : -100, y: 180 } }
        const compact = resolveCompanionAttachment(small, false)
        const expanded = resolveCompanionAttachment(small, true)
        expect(compact?.frame).toEqual({ x: 16, y: 16, width: width - 32, height: 288 })
        expect(compact).toEqual(expanded)
        expect(compact?.tail).toBeNull()
      }
    }
    const threshold = resolveCompanionAttachment({ width: 380, height: 320, petAnchor: { x: 440, y: 180 } }, false)
    expect(threshold?.frame.width).toBe(320)
    expect(threshold?.tail?.width).toBe(28)
  })

  it('consumes explicit native zero without restoring the legacy corner or inward body offset', () => {
    for (const [side, backingX, width, anchorX, bodyEdge] of [
      ['left', 12, 315, 409.36, 311],
      ['right', 505, 327, -109.64, 521],
    ] as const) {
      const parsed = parsePanelViewport({ width, height: 680, side, tailReach: 0, petAnchor: { x: anchorX, y: 445.56 } })
      for (const expanded of [false, true]) {
        const result = resolveCompanionAttachment(parsed, expanded)!
        expect(result.tail).toBeNull()
        expect(result.frame.x).toBe(16)
        expect(result.frame.width).toBe(width - 32)
        expect(backingX + result.frame.x + (side === 'left' ? result.frame.width : 0)).toBe(bodyEdge)
      }
    }
  })

  it('keeps an above or below native fallback unlinked and fully inside its backing', () => {
    for (const [height, anchorY, backingY, bodyBoundary] of [
      [480, 593.56, 12, 476],
      [668, -242.44, 360, 376],
    ] as const) {
      for (const expanded of [false, true]) {
        const result = resolveCompanionAttachment({ width: 720, height, side: 'left', tailReach: 0, petAnchor: { x: 346.36, y: anchorY } }, expanded)!
        expect(result.tail).toBeNull()
        expect(result.frame.width).toBe(expanded ? 688 : 420)
        expect(result.frame.height).toBe(expanded ? height - 32 : 380)
        expect(result.frame.y).toBeGreaterThanOrEqual(16)
        expect(result.frame.y + result.frame.height).toBeLessThanOrEqual(height - 16)
        const actualBoundary = backingY + result.frame.y + (anchorY > height ? result.frame.height : 0)
        expect(actualBoundary).toBe(bodyBoundary)
      }
    }
  })

  it('keeps native body reservation when the anchor cannot safely draw a corner', () => {
    for (const side of ['left', 'right'] as const) {
      const tailReach = side === 'left' ? 44 : 60
      const valid = resolveCompanionAttachment({ ...viewport, side, tailReach, petAnchor: { x: side === 'left' ? 834 : -142, y: 445 } }, false)!
      for (const petAnchor of [{ x: 400, y: 445 }, { x: side === 'left' ? 834 : -142, y: -20 }, { x: side === 'left' ? 834 : -142, y: 690 }]) {
        const result = resolveCompanionAttachment({ ...viewport, side, tailReach, petAnchor }, false)!
        expect(result.tail).toBeNull()
        expect(result.frame.x).toBe(valid.frame.x)
        expect(result.frame.width).toBe(valid.frame.width)
      }
    }
  })

  it('matches native width thresholds for both sides and all pet sizes', () => {
    for (const side of ['left', 'right'] as const) {
      for (const preset of [.8, 1, 1.2]) {
        const reach = (side === 'left' ? 44 : 60) * preset
        for (const bodyBudget of [319.99, 320, 320.01]) {
          const linked = bodyBudget >= 320
          const tailReach = linked ? reach : 0
          const width = 32 + bodyBudget + tailReach
          const result = resolveCompanionAttachment({ width, height: 680, side, tailReach, petAnchor: { x: side === 'left' ? width + 100 : -100, y: 445 } }, false)!
          expect(result.frame.width).toBeCloseTo(bodyBudget)
          expect(result.tail?.width ?? 0).toBeCloseTo(tailReach)
          expect(result.frame.x).toBeCloseTo(side === 'right' ? 16 + tailReach : 16)
        }
      }
    }
  })

  it('omits decoration for overlap, opposite-side targets and unusable vertical space', () => {
    for (const petAnchor of [{ x: 400, y: 400 }, { x: 20, y: 400 }, { x: 698, y: 400 }, { x: 834, y: -20 }, { x: 834, y: 690 }]) {
      const result = resolveCompanionAttachment({ ...viewport, petAnchor }, false)
      expect(result?.tail).toBeNull()
      expect(result?.frame.x).toBe(284)
    }
    expect(resolveCompanionAttachment({ width: 340, height: 90, petAnchor: { x: 410, y: 50 } }, false)?.tail).toBeNull()
  })

  it('leaves old CSS placement untouched without a finite native anchor', () => {
    for (const value of [null, { width: 720, height: 680 }, { ...viewport, petAnchor: null }, { ...viewport, petAnchor: { x: NaN, y: 50 } }])
      expect(resolveCompanionAttachment(value, false)).toBeNull()
  })

  it('does not overshoot a target inside the drawing gutter', () => {
    for (const side of ['left', 'right'] as const) {
      const petAnchor = { x: side === 'left' ? 700 : 20, y: 445 }
      const result = resolveCompanionAttachment({ ...viewport, side, petAnchor }, false)
      expect(result?.tail).toBeNull()
      expect(result?.frame.width).toBe(420)
    }
  })

  it('keeps the actual rounded tip inside the paint buffer in both directions', () => {
    for (const side of ['left', 'right'] as const) {
      const result = resolveCompanionAttachment({ ...viewport, side, tailReach: side === 'left' ? 44 : 60, petAnchor: { x: side === 'left' ? 834 : -142, y: 445 } }, false)!
      // The quadratic tip's midpoint, not its off-curve control point, is the
      // painted extremum. Verify the SVG agrees with the attachment metadata.
      const curve = /([\d.-]+) ([\d.-]+) Q ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)/.exec(result.silhouette.path)!
      const startX = Number(curve[1]), controlX = Number(curve[3]), endX = Number(curve[5])
      const tipX = .25 * startX + .5 * controlX + .25 * endX
      expect(tipX).toBe(side === 'left' ? result.tail!.x + result.tail!.width : result.tail!.x)
      expect(Math.min(tipX, viewport.width - tipX)).toBeGreaterThanOrEqual(16)
    }
  })

  it('pairs a closer native backing with a longer corner without advancing the body into the cat', () => {
    for (const side of ['left', 'right'] as const) {
      for (const preset of [.8, 1, 1.2]) {
        const originalAnchor = { x: side === 'left' ? 834 : -142, y: 445 }
        const original = resolveCompanionAttachment({ ...viewport, side, petAnchor: originalAnchor }, false)!
        const reach = (side === 'left' ? 44 : 60) * preset
        const delta = (reach - 28) * (side === 'left' ? 1 : -1)
        const updated = resolveCompanionAttachment({ ...viewport, side, tailReach: reach, petAnchor: { ...originalAnchor, x: originalAnchor.x - delta } }, false)!
        expect(updated.frame.width).toBe(original.frame.width)
        expect(updated.frame.x + delta).toBeCloseTo(original.frame.x)
        expect(updated.frame.y).toBe(original.frame.y)
        const oldTip = original.tail!.x + (side === 'left' ? original.tail!.width : 0)
        const newTip = updated.tail!.x + (side === 'left' ? updated.tail!.width : 0) + delta
        expect(Math.abs(originalAnchor.x - newTip)).toBeLessThan(Math.abs(originalAnchor.x - oldTip))
      }
    }
  })

  it('uses one closed outline and the same physical entrance origin as the content', () => {
    for (const side of ['left', 'right'] as const) {
      for (const expanded of [false, true]) {
        const result = resolveCompanionAttachment({ ...viewport, side, petAnchor: { x: side === 'left' ? 834 : -142, y: 445 } }, expanded)
        expect(result?.silhouette.path.match(/M /g)).toHaveLength(1)
        expect(result?.silhouette.path.match(/ Z/g)).toHaveLength(1)
        expect(result?.silhouette.path.match(/ A /g)).toHaveLength(4)
        expect(result?.silhouette.originX).toBe(result && result.frame.x + (side === 'left' ? result.frame.width : 0))
        expect(result?.silhouette.originY).toBe(result && result.frame.y + result.originY)
        expect(result?.silhouette.width).toBe(720)
        expect(result?.silhouette.height).toBe(680)
      }
    }
  })
})


it('matches bounded AI panel corner radius without changing anchor or tail geometry', () => {
  const standard = resolveCompanionAttachment(viewport,false)!
  const designed = resolveCompanionAttachment(viewport,false,12)!
  expect(designed.frame).toEqual(standard.frame); expect(designed.tail).toEqual(standard.tail)
  expect(designed.silhouette.path).toContain('A 12 12')
  expect(resolveCompanionAttachment(viewport,false,1000)!.silhouette.path).toBe(standard.silhouette.path)
  expect(resolveCompanionAttachment(viewport,false,NaN)!.silhouette.path).toBe(standard.silhouette.path)
})
