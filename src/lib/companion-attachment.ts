import type { PanelViewport } from './companion-preferences'

const GUTTER = 16
const CORNER_CLEARANCE = 48
const TAIL_HEIGHT = 48
const TAIL_REACH = 28
const MIN_LINKED_WIDTH = 320

export interface CompanionAttachment {
  frame: { x: number; y: number; width: number; height: number }
  originY: number
  tail: { x: number; y: number; width: number; height: number; direction: 'left' | 'right' } | null
  silhouette: { path: string; width: number; height: number; originX: number; originY: number }
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

/** One perimeter owns the fill, outline and shadow; the corner has no seam. */
function speechSilhouette(frame: CompanionAttachment['frame'], centerY: number, direction: 'left' | 'right' | null) {
  const { x, y, width, height } = frame
  const right = x + width
  const bottom = y + height
  const radius = Math.min(24, width / 2, height / 2)
  return [
    `M ${x + radius} ${y} H ${right - radius} A ${radius} ${radius} 0 0 1 ${right} ${y + radius}`,
    direction === 'right' ? `L ${right} ${centerY - 24} C ${right} ${centerY - 12} ${right + 10} ${centerY - 6} ${right + 24} ${centerY - 3} Q ${right + 32} ${centerY} ${right + 24} ${centerY + 3} C ${right + 13} ${centerY + 8} ${right} ${centerY + 14} ${right} ${centerY + 24}` : '',
    `L ${right} ${bottom - radius} A ${radius} ${radius} 0 0 1 ${right - radius} ${bottom} H ${x + radius} A ${radius} ${radius} 0 0 1 ${x} ${bottom - radius}`,
    direction === 'left' ? `L ${x} ${centerY + 24} C ${x} ${centerY + 14} ${x - 13} ${centerY + 8} ${x - 24} ${centerY + 3} Q ${x - 32} ${centerY} ${x - 24} ${centerY - 3} C ${x - 10} ${centerY - 6} ${x} ${centerY - 12} ${x} ${centerY - 24}` : '',
    `L ${x} ${y + radius} A ${radius} ${radius} 0 0 1 ${x + radius} ${y} Z`,
  ].filter(Boolean).join(' ')
}

/** Logical CSS pixels only. A missing native anchor retains the host's old CSS layout. */
export function resolveCompanionAttachment(viewport: PanelViewport | null, expanded: boolean): CompanionAttachment | null {
  const anchor = viewport?.petAnchor
  if (!viewport || !anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y) ||
      !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) ||
      viewport.width <= GUTTER * 2 || viewport.height <= GUTTER * 2) return null
  const availableHeight = viewport.height - GUTTER * 2
  const panelOnRight = viewport.side === 'right'
  // A corner must not steal useful content space or extend through its target.
  // Narrow/overlapping placements retain only the symmetric paint gutters.
  const pointsOutward = panelOnRight ? anchor.x < GUTTER : anchor.x > viewport.width - GUTTER
  const showTail = pointsOutward && anchor.y >= GUTTER && anchor.y <= viewport.height - GUTTER &&
    availableHeight >= CORNER_CLEARANCE * 2 && viewport.width - GUTTER * 2 - TAIL_REACH >= MIN_LINKED_WIDTH
  const reservation = showTail ? TAIL_REACH : 0
  const availableWidth = viewport.width - GUTTER * 2 - reservation
  const width = expanded ? availableWidth : Math.min(420, availableWidth)
  const height = expanded ? availableHeight : Math.min(380, availableHeight)
  const frame = {
    x: panelOnRight ? GUTTER + reservation : expanded ? GUTTER : viewport.width - GUTTER - reservation - width,
    y: expanded ? GUTTER : clamp(anchor.y - 156, GUTTER, viewport.height - height - GUTTER),
    width,
    height,
  }
  const originY = height < CORNER_CLEARANCE * 2 ? height / 2 : clamp(anchor.y - frame.y, CORNER_CLEARANCE, height - CORNER_CLEARANCE)
  const direction = showTail ? panelOnRight ? 'left' : 'right' : null
  return {
    frame,
    originY,
    tail: showTail ? {
      x: panelOnRight ? frame.x - TAIL_REACH : frame.x + width,
      y: frame.y + originY - TAIL_HEIGHT / 2,
      width: TAIL_REACH,
      height: TAIL_HEIGHT,
      direction: panelOnRight ? 'left' : 'right',
    } : null,
    silhouette: {
      path: speechSilhouette(frame, frame.y + originY, direction),
      width: viewport.width,
      height: viewport.height,
      // The SVG fills the backing, so use the same origin as the content frame
      // expressed in backing coordinates, never the speech corner's tip.
      originX: panelOnRight ? frame.x : frame.x + width,
      originY: frame.y + originY,
    },
  }
}
