import { describe, expect, it } from 'vitest'

import { clampPetPosition, parsePetPosition } from './pet-position'

describe('pet position recovery', () => {
  it('accepts finite coordinates and rejects malformed or unsafe values', () => {
    expect(parsePetPosition({ version: 1, x: -120, y: 80 })).toEqual({ x: -120, y: 80 })
    expect(parsePetPosition({ x: Number.NaN, y: 80 })).toBeNull()
    expect(parsePetPosition({ x: 1, y: '80' })).toBeNull()
    expect(parsePetPosition(null)).toBeNull()
  })

  it('keeps a saved window inside a work area with negative origins', () => {
    const workArea = { x: -1920, y: -40, width: 1920, height: 1080 }
    expect(clampPetPosition({ x: -2500, y: -200 }, workArea, { width: 280, height: 280 })).toEqual({ x: -1920, y: -40 })
    expect(clampPetPosition({ x: -10, y: 999 }, workArea, { width: 280, height: 280 })).toEqual({ x: -280, y: 760 })
  })
})
