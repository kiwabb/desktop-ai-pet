import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REFERENCE_WIDTH = 1672
const REFERENCE_HEIGHT = 941
const REFERENCE_SHA256 = '9603c303514e39bae21ba6c6c347ff6e903f817b3571ad6fe8df4917f1089d17'

function fail(message) {
  console.error(`component compact verification failed: ${message}`)
  process.exit(1)
}

function readPngSize(bytes) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (!bytes.subarray(0, 8).equals(signature))
    fail('approved compact reference is not a PNG')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

const reference = readFileSync(resolve('public/reference/desktop-pet-compact-reference.png'))
const referenceHash = createHash('sha256').update(reference).digest('hex')
const referenceSize = readPngSize(reference)
if (referenceHash !== REFERENCE_SHA256)
  fail(`approved reference checksum changed (${referenceHash})`)
if (referenceSize.width !== REFERENCE_WIDTH || referenceSize.height !== REFERENCE_HEIGHT)
  fail(`approved reference dimensions changed (${referenceSize.width}x${referenceSize.height})`)

const component = readFileSync(resolve('src/components/ChatPanel.tsx'), 'utf8')
const frame = readFileSync(resolve('src/components/ChatBubbleFrame.tsx'), 'utf8')
const frameCss = readFileSync(resolve('src/components/ChatBubbleFrame.css'), 'utf8')
const app = readFileSync(resolve('src/App.tsx'), 'utf8')
const html = readFileSync(resolve('index.html'), 'utf8')
const css = readFileSync(resolve('src/styles.css'), 'utf8')
const rust = readFileSync(resolve('src-tauri/src/lib.rs'), 'utf8')

for (const [name, source] of [['ChatPanel', component], ['ChatBubbleFrame', frame], ['App', app], ['index.html', html]]) {
  if (source.includes('desktop-pet-chat-panel-reference.png'))
    fail(`${name} still loads the raster chat-panel reference at runtime`)
}

for (const forbidden of ['exact-reference-art', 'exact-hotspot', 'exact-composer', 'exact-quick-prompts']) {
  if (component.includes(forbidden))
    fail(`ChatPanel still renders the legacy ${forbidden} overlay`)
}

const compactUi = `${component}\n${frame}`
for (const required of [
  'is-${variant}',
  'is-${appearance}',
  'is-hidden',
  'is-entering',
  'ReferencePawBadge',
  'className="chat-header"',
  'className="composer"',
  'className="quick-prompts"',
  '<textarea',
  '<Settings2',
  '<Send',
]) {
  if (!compactUi.includes(required))
    fail(`real compact component is missing ${required}`)
}

// The approved composer now contains working text/send controls only. Keep
// verifying their real form wiring rather than requiring unavailable tools.
const composer = component.match(/<form\b[^>]*className="composer"[\s\S]*?<\/form>/)?.[0]
if (!composer || !composer.includes('onSubmit={submit}'))
  fail('compact composer must retain the real submit form')
if ((composer?.match(/<textarea\b/g) ?? []).length !== 1
    || !composer?.includes('value={draft}')
    || !composer?.includes('setDraft(event.target.value)'))
  fail('compact composer must retain one editable controlled textarea')
const sendControl = composer?.match(/<button\b[^>]*className="send-button"[\s\S]*?<\/button>/)?.[0]
if (!sendControl?.includes('type="submit"') || !sendControl.includes('<Send'))
  fail('compact composer must retain its real Send submit control')
for (const unavailable of ['<Paperclip', '<Mic', 'className="composer-tool"', '附件功能即将支持', '语音输入即将支持']) {
  if (composer?.includes(unavailable))
    fail(`compact composer still renders the removed unavailable placeholder: ${unavailable}`)
}

if (compactUi.includes('contentKind'))
  fail('the frame still carries contentKind business knowledge')

if (component.includes('ReferenceCatBadge') || css.includes('assistant-cat-badge'))
  fail('temporary cat-face replacement is still rendered')

// Visibility and entrance motion are owned by the component stylesheet, scoped
// to the frame root — no pet-shell/pet-chat-* ancestor may be required.
for (const selector of [
  '.chat-panel.is-hidden',
  '.chat-panel.is-attached.is-compact.is-entering',
]) {
  if (!frameCss.includes(selector))
    fail(`ChatBubbleFrame.css is missing ${selector}`)
}

for (const selector of [
  '.composer-tool:focus-visible',
  '.quick-prompts button:focus-visible',
]) {
  if (!css.includes(selector))
    fail(`component compact CSS is missing ${selector}`)
}

if (css.includes('.pet-shell.pet-chat-compact .assistant-paw-badge'))
  fail('compact paw badge rule still lives in the global stylesheet instead of ChatBubbleFrame.css')

const compactScene = css.match(/\.pet-chat-scene\.pet-chat-compact\s*\{([^}]+)\}/)?.[1] ?? ''
if (!compactScene.includes('width: 713px') || !compactScene.includes('height: 401px'))
  fail('compact inner scene must remain 713x401 within the stable native backing')

// The approved corner sticker keeps the compact reference's 53.3 x 59.27
// dimensions in every mode. One root-relative rule must replace all old flex
// offsets and per-variant sizes; the top edge deliberately protrudes slightly.
const illustrations = readFileSync(resolve('src/components/ReferenceIllustrations.tsx'), 'utf8')

const badgeViewBox = illustrations.match(/export function ReferencePawBadge[\s\S]*?viewBox="([^"]+)"/)
if (!badgeViewBox)
  fail('ReferencePawBadge has no viewBox')
if (badgeViewBox[1] !== '0 0 125 139')
  fail(`paw badge viewBox must equal its ink bbox "0 0 125 139", found "${badgeViewBox[1]}"`)

const badgeBody = illustrations.slice(
  illustrations.indexOf('export function ReferencePawBadge'),
  illustrations.indexOf('export function ReferenceSparkle'),
)
const padCount = (badgeBody.match(/className="paw-pad"/g) ?? []).length
if (padCount !== 3)
  fail(`paw badge must draw exactly 3 toe pads (the reference has 3), found ${padCount}`)
if (!badgeBody.includes('className="paw-pad paw-main-pad"'))
  fail('paw badge is missing the main pad')
if (/<ellipse/.test(badgeBody))
  fail('paw badge pads must be traced paths, not ellipses')

const badgeRules = [...frameCss.matchAll(/([^{}]+)\{([^{}]+)\}/g)]
  .filter(match => match[1].includes('.assistant-paw-badge'))
  .filter(match => !/^\s*animation\s*:[^;]+;\s*$/.test(match[2]))
  // The transient frame-morph state strips the badge's drop-shadow filters for
  // repaint cost; it is not a variant override of the shared settled rule.
  .filter(match => !match[1].includes('[data-frame-morphing]'))
if (badgeRules.length !== 1 || !badgeRules[0][1].trim().endsWith('.chat-panel > .assistant-paw-badge'))
  fail('paw badge must have exactly one shared root-child rule, with no variant overrides')
if (!frameCss.includes('.chat-panel[data-frame-morphing] > .assistant-paw-badge'))
  fail('the morph-state badge filter relief rule is missing from ChatBubbleFrame.css')
const badgeRule = badgeRules[0][2]
for (const [prop, expected] of [
  ['position', 'absolute'],
  ['top', '-5px'],
  ['left', '4.12px'],
  ['width', '53.3px'],
  ['height', '59.27px'],
  ['z-index', '6'],
  ['pointer-events', 'none'],
]) {
  const found = badgeRule.match(new RegExp(`(?:^|;|\\n)\\s*${prop}:\\s*([^;]+)`))
  if (!found || found[1].trim() !== expected)
    fail(`shared corner badge ${prop} must be "${expected}"`)
}
if (/\b(?:margin|transform):/.test(badgeRule))
  fail('corner badge must not depend on flex margins or transforms')
const badgeNodes = frame.match(/<ReferencePawBadge\b/g) ?? []
if (badgeNodes.length !== 1 || !/<section\b[^>]*>\s*<ReferencePawBadge className="assistant-paw-badge" \/>/.test(frame))
  fail('the shared paw badge must be a direct frame child, outside the header')
if (!badgeBody.includes('aria-hidden="true"'))
  fail('the shared corner badge must remain decorative')
const rootRule = frameCss.match(/\.chat-panel \{([^}]+)\}/)
if (!rootRule || !/overflow:\s*visible/.test(rootRule[1]))
  fail('the frame clips its protruding corner badge')

// A shared badge offset alone is insufficient: every painted surface must
// retain the same full-height left corner instead of a normalized header arc.
if (!rootRule[1].includes('--chat-frame-corner-radius: 72px;') || !rootRule[1].includes('border-radius: var(--chat-frame-corner-radius) var(--chat-frame-top-right-radius) var(--chat-frame-bottom-right-radius) var(--chat-frame-bottom-left-radius);'))
  fail('the shared frame must own the approved 72px top-left corner')
const frameVariantRules = [...frameCss.matchAll(/([^{}]+)\{([^{}]+)\}/g)]
  .filter(match => /\.chat-panel\.is-[a-z.-]+\s*$/.test(match[1].trim()))
if (frameVariantRules.some(match => /(?:border-radius|border-top-left-radius|--chat-frame-corner-radius)\s*:/.test(match[2])))
  fail('a frame variant overrides the shared top-left corner geometry')
const surfaceRule = frameCss.match(/\.chat-panel > \.chat-panel-surface \{([^}]+)\}/)
if (!surfaceRule || !/overflow:\s*hidden/.test(surfaceRule[1]) || !/border-radius:\s*inherit/.test(surfaceRule[1]))
  fail('a full-height shared surface must clip header and body to the same corner')
if (!/<div className="chat-panel-surface">\s*<header/.test(frame) || frame.indexOf('className="chat-panel-body"') < frame.indexOf('className="chat-panel-surface"'))
  fail('the shared clipped surface must contain the header and body')

// Empty content must not shrink either the outer frame or clipped surface
// below any adjacent radius sum, including the root's border thickness.
for (const axis of ['width', 'height']) {
  if (!rootRule[1].includes(`min-${axis}: calc(var(--chat-frame-min-${axis}) + 2 * var(--chat-frame-border-width));`) || !surfaceRule[1].includes(`min-${axis}: var(--chat-frame-min-${axis});`))
    fail(`the frame/surface minimum ${axis} must preserve the shared corner even with empty slots`)
}
for (const sum of [
  'var(--chat-frame-corner-radius) + var(--chat-frame-top-right-radius)',
  'var(--chat-frame-bottom-left-radius) + var(--chat-frame-bottom-right-radius)',
  'var(--chat-frame-corner-radius) + var(--chat-frame-bottom-left-radius)',
  'var(--chat-frame-top-right-radius) + var(--chat-frame-bottom-right-radius)',
]) {
  if (!rootRule[1].includes(sum))
    fail(`the minimum frame size omits adjacent corner sum ${sum}`)
}
const compactSurfaceRule = frameCss.match(/\.chat-panel\.is-attached\.is-compact > \.chat-panel-surface \{([^}]+)\}/)
const compactHeaderRule = frameCss.match(/\.chat-panel\.is-attached\.is-compact \.chat-header \{([^}]+)\}/)
const compactRootRule = frameCss.match(/\.chat-panel\.is-attached\.is-compact \{([^}]+)\}/)
if (!compactSurfaceRule || !/overflow:\s*visible/.test(compactSurfaceRule[1]))
  fail('compact inline errors must not cause surface clipping of quick-prompt controls')
if (!compactHeaderRule || !/background:\s*transparent/.test(compactHeaderRule[1]) || !/border-bottom:\s*0/.test(compactHeaderRule[1]) || !compactRootRule?.[1].includes('--chat-frame-rows: 84px auto auto;'))
  fail('unclipped compact surface requires a transparent 84px header covering the entire 72px corner')

// The reference main pad is LIGHTER than the toe pads.
const toeFill = frameCss.match(/\.paw-pad \{[^}]*fill:\s*(#[0-9a-fA-F]{6})/)
const mainFill = frameCss.match(/\.paw-main-pad \{[^}]*fill:\s*(#[0-9a-fA-F]{6})/)
if (!toeFill || !mainFill)
  fail('paw pad fills are missing')
const luma = hex => {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * ((n >> 16) & 0xff) + 0.7152 * ((n >> 8) & 0xff) + 0.0722 * (n & 0xff)
}
if (luma(mainFill[1]) <= luma(toeFill[1]))
  fail(`main pad ${mainFill[1]} must be lighter than the toe pads ${toeFill[1]}, as in the reference`)

// Exercise real shared geometry at native and small neutral-host sizes.
const { buildPetShellGeometry } = await import('../src/components/pet-shell-geometry.ts')
for (const [width, height] of [[475, 278], [676, 665], [132, 132], [200, 160], [1000, 900]]) {
  for (const dock of [{}, { offsetX: 12, offsetY: 18 }, { offsetY: -200, scale: 0.8 }]) {
    const geometry = buildPetShellGeometry({ width, height }, dock)
    if (/NaN|Infinity/.test(geometry.outline) || !geometry.outline.startsWith('M72 0') || !geometry.outline.endsWith('Z') || (geometry.outline.match(/M/g) ?? []).length !== 1)
      fail(`integrated shell is not one finite closed perimeter at ${width}x${height}`)
    if (geometry.scale * 440 > geometry.height + 0.001 || geometry.scale * 680 > geometry.width + 0.001)
      fail('small shell scales the fixed artwork beyond its available shoulder room')
    if (geometry.canvasWidth <= width || geometry.canvasHeight <= height)
      fail('integrated platform is outside the SVG canvas')
  }
}
const integratedRule = frameCss.match(/\.chat-panel\.is-attached\.is-integrated \{([^}]+)\}/)
const minimumShell = buildPetShellGeometry({ width: 1, height: 1 })
for (const axis of ['width', 'height']) {
  if (!integratedRule?.[1].includes(`min-${axis}: max(${minimumShell[axis]}px,`))
    fail(`integrated CSS minimum ${axis} disagrees with the geometry minimum`)
}
// Follow the actual generated SVG commands up to the fixed platform curve.
// Both short/tall branches must arrive at the same x when height crosses its
// switch point, including when the caller offsets the platform horizontally.
function platformJoin(width, height) {
  const g = buildPetShellGeometry({ width, height }, { offsetX: 13.3 })
  let x = 0, y = 0
  const firstControl = [width + 94 * g.scale + 13.3, height - 121 * g.scale]
  for (const command of g.outline.match(/[A-Za-z][^A-Za-z]*/g) ?? []) {
    const kind = command[0]
    const values = command.slice(1).trim().split(/[ ,]+/).map(Number)
    if (kind === 'C' && Math.abs(values[0] - firstControl[0]) < .001 && Math.abs(values[1] - firstControl[1]) < .001) return { x, y }
    if (kind === 'H') x = values[0]
    else if (kind === 'V') y = values[0]
    else if (kind !== 'Z') [x, y] = values.slice(-2)
  }
  fail('shared outline does not reach the platform curve')
}
const shortJoin = platformJoin(676, 407.9)
const tallJoin = platformJoin(676, 408.1)
if (Math.abs(shortJoin.x - tallJoin.x) > .001 || Math.abs(tallJoin.y - shortJoin.y - .2) > .001)
  fail('platform offset jumps when switching between short and tall frame geometry')

const compactShell = buildPetShellGeometry({ width: 475, height: 278 })
const expandedShell = buildPetShellGeometry({ width: 676, height: 665 })
if (compactShell.scale !== 0.6 || expandedShell.scale !== compactShell.scale)
  fail('native mode changes stretch the fixed-size platform artwork')
const shellSource = readFileSync(resolve('src/components/ChatBubbleShell.tsx'), 'utf8')
if (compactShell.sideFootprints.length !== 5 || expandedShell.footerFootprints.length !== 2)
  fail('reference footprints require five side prints and two expanded footer prints')
const footprintArt = shellSource.slice(shellSource.indexOf("<g id={id('footprint')}>"), shellSource.indexOf("<path data-shell-outline="))
if ((footprintArt.match(/<ellipse/g) ?? []).length !== 4 || !footprintArt.includes('M17 43c3-8 6-14 14-14'))
  fail('side/footer footprints must use the reference four-toe artwork, not the corner badge')
if (Math.abs(compactShell.sideFootprints[3].y + 68 - 5.2) > .001 || Math.abs(expandedShell.sideFootprints[3].y + 40 - 364.2) > .001)
  fail('floating reference footprint must remain visible above the native cat status bubble')
const movedFootprints = buildPetShellGeometry({ width: 475, height: 278 }, { offsetX: 12, offsetY: 18 }).sideFootprints
for (let index = 0; index < 5; index++) {
  const original = compactShell.sideFootprints[index], moved = movedFootprints[index]
  const expectedX = index < 2 ? 0 : 12, expectedY = index < 2 ? 0 : 18
  if (Math.abs(moved.x - original.x - expectedX) > .001 || Math.abs(moved.y - original.y - expectedY) > .001)
    fail(`footprint ${original.name} does not follow its shoulder/platform anchor`)
}
if (!shellSource.includes("showFooterFootprints ? [...g.sideFootprints, ...g.footerFootprints] : g.sideFootprints") || !frame.includes("showFooterFootprints={variant === 'expanded' && footer == null}") || !frame.includes("attached && !integrated && variant === 'compact'"))
  fail('integrated footprint counts or legacy-only mini trail regressed')
if (!shellSource.includes('useId()') || !shellSource.includes('clipPath') || !frame.includes('observer.disconnect()'))
  fail('integrated shell lacks isolated SVG IDs, paint clipping or resize cleanup')
if (!frame.includes('Object.values(tail).some(value => value !== undefined)') || !frame.includes('attached && explicitTail'))
  fail('explicit tail compatibility or default empty-tail integrated behavior regressed')

console.log('component compact verification passed: locked visual reference, real DOM controls, shared corner paw-badge geometry, no runtime panel screenshot')
