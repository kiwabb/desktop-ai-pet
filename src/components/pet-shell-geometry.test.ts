import { expect, it } from 'vitest'
import { buildPetShellGeometry } from './pet-shell-geometry'

it('keeps the native platform at the cat scale when the reading column narrows', () => {
  for (const width of [300, 380, 475, 676]) {
    const geometry = buildPetShellGeometry({ width, height: 278 }, { scale: .6, preserveScale: true })
    expect(geometry.scale).toBe(.6)
    expect(geometry.canvasWidth - width).toBeCloseTo(214.4)
    expect(geometry.outline).not.toMatch(/NaN|Infinity/)
  }
})

it('retains fitted geometry for independent hosts and nonfinite measurements', () => {
  expect(buildPetShellGeometry({ width: 200, height: 200 }).scale).toBeLessThan(.6)
  expect(buildPetShellGeometry({ width: NaN, height: Infinity }).outline).not.toMatch(/NaN|Infinity/)
})
