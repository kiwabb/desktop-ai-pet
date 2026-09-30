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
})

describe('cat-facing panel attachment', () => {
  it('reserves a visible 28px corner plus a 16px paint gutter without shrinking compact content', () => {
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
