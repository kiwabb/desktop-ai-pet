export const COMPANION_SIZES = [
  { scale: 0.8, label: '小' },
  { scale: 1, label: '标准' },
  { scale: 1.2, label: '大' },
] as const
export interface CompanionPreferences {
  scale: 0.8 | 1 | 1.2
  alwaysOnTop: boolean
}
export const DEFAULT_COMPANION_PREFERENCES: CompanionPreferences = { scale: 1, alwaysOnTop: true }
export interface PanelViewport {
  width: number
  height: number
  side?: 'left' | 'right'
  petAnchor?: { x: number; y: number } | null
}

/** Commands and events cross the same boundary; older native hosts omit the anchor. */
export function parsePanelViewport(value: unknown): PanelViewport | null {
  if (typeof value !== 'object' || value === null ||
      !('width' in value) || typeof value.width !== 'number' || !Number.isFinite(value.width) || value.width <= 0 ||
      !('height' in value) || typeof value.height !== 'number' || !Number.isFinite(value.height) || value.height <= 0) return null
  const anchor = 'petAnchor' in value ? value.petAnchor : null
  return {
    width: value.width,
    height: value.height,
    side: 'side' in value && value.side === 'right' ? 'right' : 'left',
    petAnchor: typeof anchor === 'object' && anchor !== null &&
      'x' in anchor && typeof anchor.x === 'number' && Number.isFinite(anchor.x) &&
      'y' in anchor && typeof anchor.y === 'number' && Number.isFinite(anchor.y)
      ? { x: anchor.x, y: anchor.y } : null,
  }
}
