/** Public placement controls for the integrated decoration, in CSS pixels. */
export interface ChatBubbleDockConfig {
  /** Fixed artwork scale; the component reduces it only when the frame is too small. */
  scale?: number
  /** Translate the platform; upward movement stops before its joint would fold. */
  offsetX?: number
  offsetY?: number
}

interface ShellSize { width: number; height: number }

/** Panel-local version of the approved HTML's shared PetShell perimeter. */
export function buildPetShellGeometry({ width, height }: ShellSize, dock: ChatBubbleDockConfig = {}) {
  const w = Math.max(132, width)
  const h = Math.max(132, height)
  const requestedScale = Number.isFinite(dock.scale) && dock.scale! > 0 ? dock.scale! : 0.6
  const k = Math.min(requestedScale, w / 680, h / 440)
  const dx = Number.isFinite(dock.offsetX) ? dock.offsetX! : 0
  const requestedY = Number.isFinite(dock.offsetY) ? dock.offsetY! : 0
  const p = (x: number, y: number) => `${+x.toFixed(3)} ${+y.toFixed(3)}`
  const r = 72
  const tr = 42 * k
  const s = Math.max(158 * k, Math.min(h - 370 * k, 222 * k))
  // Upward movement stops before the short-height joint would fold backward.
  const dy = Math.max(requestedY, s + 271 * k - h)
  const d = (x: number, y: number) => p(w + (x - 1046) * k + dx, h + (y - 940) * k + dy)
  let outline = `M${p(r, 0)}H${w - tr}Q${p(w, 0)} ${p(w, tr)}V${79 * k}`
  outline += `Q${p(w, 91 * k)} ${p(w + 12 * k, 97 * k)}C${p(w + 31 * k, 107 * k)} ${p(w + 37 * k, 124 * k)} ${p(w + 37 * k, 149 * k)}V${s}`
  outline += `C${p(w + 37 * k, s + 17 * k)} ${p(w + 45 * k, s + 25 * k)} ${p(w + 59 * k, s + 32 * k)}C${p(w + 99 * k, s + 49 * k)} ${p(w + 96 * k, s + 92 * k)} ${p(w + 71 * k, s + 109 * k)}`
  outline += `C${p(w + 61 * k, s + 116 * k)} ${p(w + 48 * k, s + 116 * k)} ${p(w + 37 * k, s + 125 * k)}Q${p(w + 24 * k, s + 136 * k)} ${p(w + 24 * k, s + 158 * k)}`
  const end = h - 113 * k + dy
  if (h - 300 * k + dy >= s + 158 * k) {
    outline += `V${h - 300 * k + dy}Q${p(w + 24 * k, h - 272 * k + dy)} ${p(w + 47 * k + dx, h - 260 * k + dy)}Q${p(w + 59 * k + dx, h - 252 * k + dy)} ${p(w + 59 * k + dx, h - 230 * k + dy)}V${end}`
  } else {
    const mid = (s + 158 * k + end) / 2
    outline += `C${p(w + 24 * k, mid)} ${p(w + 59 * k + dx, mid)} ${p(w + 59 * k + dx, end)}`
  }
  outline += `C${d(1140, 819)} ${d(1200, 818)} ${d(1250, 821)}C${d(1323, 823)} ${d(1390, 839)} ${d(1390, 868)}V${h - 36 * k + dy}`
  outline += `C${d(1390, 930)} ${d(1305, 948)} ${d(1230, 948)}C${d(1160, 948)} ${d(1115, 937)} ${d(1080, 937)}C${d(1060, 937)} ${d(1040, 940)} ${d(1018, 940)}`
  outline += `H28A28 28 0 0 1 ${p(0, h - 28)}V${r}A${r} ${r} 0 0 1 ${p(r, 0)}Z`
  // The approved HTML's scene-top p4 is off-screen in the fixed native
  // compact window. Anchor it to the retained cat/platform instead: at the
  // native scale it sits about 40px above the status bubble (screen y≈5/364).
  const upperPrintY = h - 568 * k
  const footprint = (name: string, x: number, y: number, width: number, height: number, rotation: number, fill = '#ffc693', opacity = 1) =>
    ({ name, x, y, width: width * k, height: height * k, rotation, fill, opacity })
  const sideFootprints = [
    footprint('shoulder', w - 6 * k, 166 * k, 29, 33, 15),
    footprint('curve', w + 22 * k, s + 44 * k, 45, 51, -16),
    footprint('lower-curve', w + k + dx, h - 216 * k + dy, 42, 44, -16, '#ffc693', .7),
    footprint('floating', w + 114 * k + dx, upperPrintY + dy, 32, 35, 12, '#ffe9cb'),
    footprint('saddle', w - 53 * k + dx, h - 45 * k + dy, 36, 36, -18, '#ffdfb9'),
  ]
  const footerFootprints = [
    footprint('footer-left', 24 * k, h - 53 * k, 43, 43, -14, '#ffe7c6'),
    footprint('footer-center', w * .55, h - 53 * k, 43, 43, -12, '#ffe7c6'),
  ]
  return {
    sideFootprints, footerFootprints,
    outline, scale: k, width: w, height: h,
    canvasWidth: Math.max(w, w + 344 * k + dx) + 8,
    canvasHeight: Math.max(h, h + 8 * k + dy) + 8,
    dockTransform: `translate(${w - 1046 * k + dx} ${h - 940 * k + dy}) scale(${k})`,
  }
}
