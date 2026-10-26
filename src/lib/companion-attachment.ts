import type { PanelViewport } from './companion-preferences'

const GUTTER = 16
const CORNER_CLEARANCE = 48
const TAIL_HEIGHT = 48
const LEGACY_TAIL_REACH = 28
const MIN_LINKED_WIDTH = 320
const FIT_EPSILON = .000001

export interface CompanionAttachment {
  frame: { x: number; y: number; width: number; height: number }
  originY: number
  tail: { x: number; y: number; width: number; height: number; direction: 'left' | 'right' } | null
  silhouette: { path: string; width: number; height: number; originX: number; originY: number }
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

/** One perimeter owns the fill, outline and shadow; the corner has no seam. */
function speechSilhouette(frame: CompanionAttachment['frame'], centerY: number, direction: 'left' | 'right' | null, cornerRadius: number, tailReach: number) {
  const { x, y, width, height } = frame
  const right = x + width
  const bottom = y + height
  const radius = Math.min(cornerRadius, width / 2, height / 2)
  const tipShoulder = tailReach - 4
  const tipControl = tailReach + 4
  return [
    `M ${x + radius} ${y} H ${right - radius} A ${radius} ${radius} 0 0 1 ${right} ${y + radius}`,
    direction === 'right' ? `L ${right} ${centerY - 24} C ${right} ${centerY - 12} ${right + 10} ${centerY - 6} ${right + tipShoulder} ${centerY - 3} Q ${right + tipControl} ${centerY} ${right + tipShoulder} ${centerY + 3} C ${right + 13} ${centerY + 8} ${right} ${centerY + 14} ${right} ${centerY + 24}` : '',
    `L ${right} ${bottom - radius} A ${radius} ${radius} 0 0 1 ${right - radius} ${bottom} H ${x + radius} A ${radius} ${radius} 0 0 1 ${x} ${bottom - radius}`,
    direction === 'left' ? `L ${x} ${centerY + 24} C ${x} ${centerY + 14} ${x - 13} ${centerY + 8} ${x - tipShoulder} ${centerY + 3} Q ${x - tipControl} ${centerY} ${x - tipShoulder} ${centerY - 3} C ${x - 10} ${centerY - 6} ${x} ${centerY - 12} ${x} ${centerY - 24}` : '',
    `L ${x} ${y + radius} A ${radius} ${radius} 0 0 1 ${x + radius} ${y} Z`,
  ].filter(Boolean).join(' ')
}

/** Logical CSS pixels only. A missing native anchor retains the host's old CSS layout. */
export function resolveCompanionAttachment(viewport: PanelViewport | null, expanded: boolean, radius = 24): CompanionAttachment | null {
  const anchor = viewport?.petAnchor
  if (!viewport || !anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y) ||
      !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) ||
      viewport.width <= GUTTER * 2 || viewport.height <= GUTTER * 2) return null
  const availableHeight = viewport.height - GUTTER * 2
  const panelOnRight = viewport.side === 'right'
  const hasNativeReach = typeof viewport.tailReach === 'number' && Number.isFinite(viewport.tailReach) && viewport.tailReach >= 0
  const reach = hasNativeReach ? viewport.tailReach! : LEGACY_TAIL_REACH
  // A corner must not steal useful content space or extend through its target.
  // Native zero pairs an unlinked narrow backing with symmetric paint gutters.
  const fitsLinkedBody = viewport.width - GUTTER * 2 - reach >= MIN_LINKED_WIDTH - FIT_EPSILON
  const pointsOutward = panelOnRight ? anchor.x < GUTTER : anchor.x > viewport.width - GUTTER
  const showTail = reach >= 8 && pointsOutward && anchor.y >= GUTTER && anchor.y <= viewport.height - GUTTER &&
    availableHeight >= CORNER_CLEARANCE * 2 && fitsLinkedBody
  // Native placement and this corner share one reach. Moving the backing and
  // extending the corner by the same amount keeps the body clear of the fur.
  // The native gap already accounts for this reservation. Invalid targets
  // hide the decorative corner without moving the readable body into the cat.
  // Hosts without metadata retain their original decoration/fallback behavior.
  const reservation = hasNativeReach && reach >= 8 && fitsLinkedBody ? reach : showTail ? reach : 0
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
      x: panelOnRight ? frame.x - reach : frame.x + width,
      y: frame.y + originY - TAIL_HEIGHT / 2,
      width: reach,
      height: TAIL_HEIGHT,
      direction: panelOnRight ? 'left' : 'right',
    } : null,
    silhouette: {
      path: speechSilhouette(frame, frame.y + originY, direction, Number.isFinite(radius) ? clamp(radius,12,24) : 24, reach),
      width: viewport.width,
      height: viewport.height,
      // The SVG fills the backing, so use the same origin as the content frame
      // expressed in backing coordinates, never the speech corner's tip.
      originX: panelOnRight ? frame.x : frame.x + width,
      originY: frame.y + originY,
    },
  }
}
