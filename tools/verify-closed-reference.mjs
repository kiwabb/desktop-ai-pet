import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { inflateSync } from 'node:zlib'

const MASTER_SHA256 = '9603c303514e39bae21ba6c6c347ff6e903f817b3571ad6fe8df4917f1089d17'
const CLOSED_SHA256 = '3d70acef291a8c9dfc3f9fdb73172324c669e8e7b997628743cbe1aaedf1dea6'
const WIDTH = 544
const HEIGHT = 893
const CROP_X = 1128
const CROP_Y = 48
const masterPath = resolve('public/reference/desktop-pet-compact-reference.png')
const closedPath = resolve('public/reference/desktop-pet-closed-reference.png')

function fail(message) {
  console.error(`closed reference verification failed: ${message}`)
  process.exit(1)
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upperLeftDistance = Math.abs(estimate - upperLeft)
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance)
    return left
  return upDistance <= upperLeftDistance ? up : upperLeft
}

function decodeRgbaPng(path) {
  const png = readFileSync(path)
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (!png.subarray(0, 8).equals(signature))
    fail(`${path} is not a PNG`)

  let offset = 8
  let width = 0
  let height = 0
  let hasIccProfile = false
  const compressed = []
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    const data = png.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      const [bitDepth, colorType, compression, filter, interlace] = data.subarray(8, 13)
      if (bitDepth !== 8 || colorType !== 6 || compression !== 0 || filter !== 0 || interlace !== 0)
        fail(`${path} must be a non-interlaced 8-bit RGBA PNG`)
    }
    if (type === 'IDAT')
      compressed.push(data)
    if (type === 'iCCP')
      hasIccProfile = true
    offset += length + 12
  }

  const stride = width * 4
  const filtered = inflateSync(Buffer.concat(compressed))
  const rgba = Buffer.alloc(width * height * 4)
  let sourceOffset = 0
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[sourceOffset]
    sourceOffset += 1
    const rowOffset = y * stride
    for (let x = 0; x < stride; x += 1) {
      const raw = filtered[sourceOffset + x]
      const left = x >= 4 ? rgba[rowOffset + x - 4] : 0
      const up = y > 0 ? rgba[rowOffset - stride + x] : 0
      const upperLeft = y > 0 && x >= 4 ? rgba[rowOffset - stride + x - 4] : 0
      if (filter === 0)
        rgba[rowOffset + x] = raw
      else if (filter === 1)
        rgba[rowOffset + x] = (raw + left) & 0xff
      else if (filter === 2)
        rgba[rowOffset + x] = (raw + up) & 0xff
      else if (filter === 3)
        rgba[rowOffset + x] = (raw + Math.floor((left + up) / 2)) & 0xff
      else if (filter === 4)
        rgba[rowOffset + x] = (raw + paeth(left, up, upperLeft)) & 0xff
      else
        fail(`${path} uses unsupported PNG filter ${filter}`)
    }
    sourceOffset += stride
  }
  return { width, height, rgba, hasIccProfile }
}

function normalizeToSrgb(path) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'desktop-pet-closed-srgb-'))
  const outputPath = join(temporaryDirectory, 'capture-srgb.png')
  try {
    const conversion = spawnSync('/usr/bin/sips', [
      '--matchTo',
      '/System/Library/ColorSync/Profiles/sRGB Profile.icc',
      path,
      '--out',
      outputPath,
    ], { encoding: 'utf8' })
    if (conversion.status !== 0)
      fail(`failed to normalize native capture: ${conversion.stderr.trim() || conversion.stdout.trim()}`)
    return decodeRgbaPng(outputPath)
  }
  finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

function verifyHash(path, expected) {
  const actual = createHash('sha256').update(readFileSync(path)).digest('hex')
  if (actual !== expected)
    fail(`${path} checksum changed (${actual})`)
}

verifyHash(masterPath, MASTER_SHA256)
verifyHash(closedPath, CLOSED_SHA256)
const master = decodeRgbaPng(masterPath)
const closed = decodeRgbaPng(closedPath)
if (closed.width !== WIDTH || closed.height !== HEIGHT)
  fail(`closed asset is ${closed.width}x${closed.height}, expected ${WIDTH}x${HEIGHT}`)

let visiblePixels = 0
for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    const outputIndex = (y * WIDTH + x) * 4
    if (closed.rgba[outputIndex + 3] === 0)
      continue
    visiblePixels += 1
    const masterIndex = ((CROP_Y + y) * master.width + CROP_X + x) * 4
    for (let channel = 0; channel < 4; channel += 1) {
      if (closed.rgba[outputIndex + channel] !== master.rgba[masterIndex + channel])
        fail(`closed pixel ${x},${y} is not copied exactly from the approved master`)
    }
  }
}
if (visiblePixels !== 252085)
  fail(`closed semantic mask contains ${visiblePixels} visible pixels, expected 252085`)

const component = readFileSync(resolve('src/components/PetStage.tsx'), 'utf8')
if (!component.includes('/reference/desktop-pet-closed-reference.png') || !component.includes("'reference-closed'"))
  fail('PetStage does not use the approved closed reference mode')
if (!component.includes('onContextMenu') || !component.includes('event.preventDefault()'))
  fail('PetStage does not expose the native right-click menu entry point')
const app = readFileSync(resolve('src/App.tsx'), 'utf8')
if (!app.includes('mode="reference-closed"') || app.includes("? 'interaction-only'") || app.includes(": 'animated'"))
  fail('App does not keep the same reference cat layer across closed, compact, and expanded states')
const mainHost = app.slice(app.lastIndexOf('  return ('))
if (!mainHost.includes('pet-chat-closed') || mainHost.includes('<ChatPanel'))
  fail('main must keep a fixed cat-only host independently of chat resizing')
if (!app.includes("text: '重置位置'") || !app.includes("text: '退出橘伴'") || !app.includes("menu.popup(undefined, currentWindow)"))
  fail('App does not expose the requested native right-click actions')
const css = readFileSync(resolve('src/styles.css'), 'utf8')
const frameCss = readFileSync(resolve('src/components/ChatBubbleFrame.css'), 'utf8')
if (!css.includes('.pet-shell.pet-chat-closed .pet-stage') || !css.includes('width: 232px;') || !css.includes('height: 380.9px;'))
  fail('closed reference CSS geometry is missing')
if (!css.includes('.pet-shell.pet-chat-expanded .pet-stage') || !css.includes('.pet-shell.pet-chat-expanded .pet-character-hitbox'))
  fail('expanded mode does not preserve the reference cat geometry')
if (!css.includes('.pet-shell.pet-chat-resizing .pet-stage'))
  fail('native resize guard CSS is missing')
if (!app.includes("visible={chatMode !== 'closed' && !panelPreparing}") || !frameCss.includes('.chat-panel.is-hidden'))
  fail('open panel must remain visible during native resize; explicit frame visibility remains supported')
const chatPreviewEntry = readFileSync(resolve('qa/chat-preview.tsx'), 'utf8')
if (!chatPreviewEntry.includes("import('./chat-panel-preview')"))
  fail('chat preview no longer routes to the verified panel entry')
const chatPreview = readFileSync(resolve('qa/chat-panel-preview.tsx'), 'utf8')
if (!chatPreview.includes('mode="reference-closed"') || chatPreview.includes("? 'animated'"))
  fail('chat preview swaps the reference cat when settings expand')
const chatPanel = readFileSync(resolve('src/components/ChatPanel.tsx'), 'utf8')
const chatBubbleFrame = readFileSync(resolve('src/components/ChatBubbleFrame.tsx'), 'utf8')
const illustrations = readFileSync(resolve('src/components/ReferenceIllustrations.tsx'), 'utf8')
if (!chatPanel.includes('<ChatBubbleFrame') || !illustrations.includes('export function ReferenceChatBubbleTail') || !chatBubbleFrame.includes('<ReferenceChatBubbleTail className="chat-bubble-tail"'))
  fail('chat and settings content do not share the ChatBubbleFrame shell and bubble-tail SVG')
if (app.includes('chat-cat-connector') || chatPreview.includes('chat-cat-connector') || css.includes('.chat-cat-connector'))
  fail('legacy external settings-tail mounting still exists outside ChatBubbleFrame')
if (!chatBubbleFrame.includes("compact: { top: 132, right: -16, width: 24, height: 30 }") || !chatBubbleFrame.includes("expanded: { top: '67%', right: -20, width: 30, height: 36 }"))
  fail('bubble tail defaults no longer match the approved lower, smaller geometry')
for (const declaration of ['top: var(--chat-tail-top);', 'right: var(--chat-tail-right);', 'width: var(--chat-tail-width);', 'height: var(--chat-tail-height);', 'transform: translateY(-50%);']) {
  if (!frameCss.includes(declaration))
    fail(`bubble tail is missing shared configurable geometry: ${declaration}`)
}
// Independent width/height must scale the actual path, not a letterboxed
// viewport: otherwise a width-only override moves the seam away from the frame.
const tailSvg = illustrations.match(/export function ReferenceChatBubbleTail[\s\S]*?<svg\b([^>]+)>/)
if (!tailSvg || !/preserveAspectRatio="none"/.test(tailSvg[1]))
  fail('configurable tail must scale its path to the full viewport to preserve seam overlap')
const expandedTailRule = frameCss.match(/\.chat-panel\.is-attached\.is-expanded > \.chat-bubble-tail \{([^}]+)\}/)
if (expandedTailRule && /(?:top|right|width|height|transform):/.test(expandedTailRule[1]))
  fail('expanded tail geometry must not override the shared configurable rule')
if (!expandedTailRule || !/filter:\s*none/.test(expandedTailRule[1]))
  fail('expanded tail must not have an independent sticker-like shadow')
const expandedOutlineRule = frameCss.match(/\.chat-panel\.is-attached\.is-expanded > \.chat-bubble-tail \.chat-bubble-tail-outline \{([^}]+)\}/)
if (!expandedOutlineRule || !/stroke-width:\s*1;/.test(expandedOutlineRule[1]) || !expandedOutlineRule[1].includes('stroke: rgba(240, 199, 158, 0.95);'))
  fail('expanded tail outline must match the light frame border')
if (!chatBubbleFrame.includes('className="chat-bubble-tail" variant={variant}') || !illustrations.includes("'M18 1 C18 12 34 20 47 28 Q51 31 47 34 C34 42 18 50 18 61'"))
  fail('expanded tail must use the rounded tip with outline starting at the frame seam')
const rust = readFileSync(resolve('src-tauri/src/lib.rs'), 'utf8')
if (!rust.includes('fn reset_pet_position') || !rust.includes('fn quit_app') || !rust.includes('reset_pet_position,') || !rust.includes('quit_app,'))
  fail('native right-click commands are missing')
if (!/PET_CLOSED_WIDTH:\s*f64\s*=\s*232\.0/.test(rust) || !/PET_CLOSED_HEIGHT:\s*f64\s*=\s*380\.9/.test(rust))
  fail('native closed window geometry is not 232x380.9 logical pixels')
if (!rust.includes('position.x + size.width as i32 - physical_window_pixels(width, scale)') || !rust.includes('position.y + size.height as i32 - physical_window_pixels(height, scale)'))
  fail('native resize does not preserve the bottom-right anchor')
if (!rust.includes('setFrameOrigin: frame.origin'))
  fail('chat reopening must reposition without resizing the backing')
const tauriConfig = JSON.parse(readFileSync(resolve('src-tauri/tauri.conf.json'), 'utf8'))
const mainWindow = tauriConfig.app.windows.find(window => window.label === 'main')
if (mainWindow?.width !== 232 || mainWindow?.height !== 380.9)
  fail('initial native window geometry has drifted')

const renderedArgument = process.argv.slice(2).find(argument => argument !== '--')
if (!renderedArgument) {
  console.log(`closed reference static verification passed: ${WIDTH}x${HEIGHT}, ${visiblePixels} source-exact visible pixels`)
  process.exit(0)
}

const renderedPath = resolve(renderedArgument)
const rendered = decodeRgbaPng(renderedPath)
const logicalCapture = rendered.width === 232 && rendered.height === 381
const physicalCapture = rendered.width === 464 && [762, 763].includes(rendered.height)
if (!logicalCapture && !physicalCapture)
  fail(`native capture is ${rendered.width}x${rendered.height}, expected 232x381 logical or 464x762/763 physical pixels`)
const renderedVisiblePixels = [...Array(rendered.width * rendered.height).keys()]
  .reduce((count, pixel) => count + (rendered.rgba[pixel * 4 + 3] > 0 ? 1 : 0), 0)
if (renderedVisiblePixels < 1000)
  fail('native closed capture contains no visible pet artwork')
console.log(`closed reference native geometry passed: ${rendered.width}x${rendered.height}, ${renderedVisiblePixels} visible pixels (${logicalCapture ? 'logical' : 'physical'} capture; intentional 15% downscale)`)
