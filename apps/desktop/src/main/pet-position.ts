export interface PetPosition {
  x: number
  y: number
}

export interface WorkArea {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowSize {
  width: number
  height: number
}

export function parsePetPosition(value: unknown): PetPosition | null {
  if (!isRecord(value) || typeof value.x !== 'number' || typeof value.y !== 'number') return null
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return null
  return { x: value.x, y: value.y }
}

export function clampPetPosition(position: PetPosition, workArea: WorkArea, size: WindowSize): PetPosition {
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - size.width)
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - size.height)
  return {
    x: clamp(position.x, workArea.x, maxX),
    y: clamp(position.y, workArea.y, maxY),
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
