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
  '<Paperclip',
  '<Mic',
  '<Send',
]) {
  if (!compactUi.includes(required))
    fail(`real compact component is missing ${required}`)
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

if (!/PET_CHAT_COMPACT_WIDTH:\s*f64\s*=\s*713\.0/.test(rust))
  fail('native compact width is not 713 logical pixels')
if (!/PET_CHAT_COMPACT_HEIGHT:\s*f64\s*=\s*401\.0/.test(rust))
  fail('native compact height is not 401 logical pixels')

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
if (badgeRules.length !== 1 || !badgeRules[0][1].trim().endsWith('.chat-panel > .assistant-paw-badge'))
  fail('paw badge must have exactly one shared root-child rule, with no variant overrides')
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

console.log('component compact verification passed: locked visual reference, real DOM controls, shared corner paw-badge geometry, no runtime panel screenshot')
