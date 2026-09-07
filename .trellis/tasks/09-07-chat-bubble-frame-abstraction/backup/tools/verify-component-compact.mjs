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
  'component-compact',
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

if (component.includes('ReferenceCatBadge') || css.includes('assistant-cat-badge'))
  fail('temporary cat-face replacement is still rendered')

for (const selector of [
  '.chat-panel.component-compact:not(.is-entering)',
  '.chat-panel.component-compact.is-entering',
  '.composer-tool:focus-visible',
  '.quick-prompts button:focus-visible',
]) {
  if (!css.includes(selector))
    fail(`component compact CSS is missing ${selector}`)
}

if (!/PET_CHAT_COMPACT_WIDTH:\s*f64\s*=\s*713\.0/.test(rust))
  fail('native compact width is not 713 logical pixels')
if (!/PET_CHAT_COMPACT_HEIGHT:\s*f64\s*=\s*401\.0/.test(rust))
  fail('native compact height is not 401 logical pixels')

// Paw badge placement. These numbers are measured off the approved master, not
// chosen by eye: badge ink bbox is master 76-200 x 172-310 and the panel origin
// is master (64, 158), so at the 713/1672 compact scale the ink is 53.3 x 59.27
// CSS px sitting (5.12, 5.97) inside the panel's top-left corner. The badge is
// upright and fully inside the panel — it overlaps the corner arc but never
// protrudes. Regressions here are invisible to a selector check, which is how
// the badge drifted before: the viewBox disagreed with the artwork bbox, so the
// rendered offset never matched the CSS offset.
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

const compactBadge = css.match(/\.pet-shell\.pet-chat-compact \.assistant-paw-badge \{([^}]+)\}/)
if (!compactBadge)
  fail('compact paw badge rule is missing')
const badgeRule = compactBadge[1]
for (const [prop, expected] of [
  ['width', '53.3px'],
  ['height', '59.27px'],
  ['margin', '-5px 0 0 -9.88px'],
  ['transform', 'none'],
]) {
  const found = badgeRule.match(new RegExp(`(?:^|;|\\n)\\s*${prop}:\\s*([^;]+)`))
  if (!found)
    fail(`compact paw badge is missing ${prop}`)
  if (found[1].trim() !== expected)
    fail(`compact paw badge ${prop} must be "${expected}" (measured off the master), found "${found[1].trim()}"`)
}

// The badge is a flex item whose top margin is the measured inset; `center`
// would re-centre it against the identity row's height and eat that offset.
const identityRule = css.match(/\.pet-shell\.pet-chat-compact \.assistant-identity \{([^}]+)\}/)
if (!identityRule || !/align-items:\s*flex-start/.test(identityRule[1]))
  fail('compact assistant-identity must set align-items: flex-start so the badge margin is not re-centred')

// The reference main pad is LIGHTER than the toe pads.
const toeFill = css.match(/\.paw-pad \{[^}]*fill:\s*(#[0-9a-fA-F]{6})/)
const mainFill = css.match(/\.paw-main-pad \{[^}]*fill:\s*(#[0-9a-fA-F]{6})/)
if (!toeFill || !mainFill)
  fail('paw pad fills are missing')
const luma = hex => {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * ((n >> 16) & 0xff) + 0.7152 * ((n >> 8) & 0xff) + 0.0722 * (n & 0xff)
}
if (luma(mainFill[1]) <= luma(toeFill[1]))
  fail(`main pad ${mainFill[1]} must be lighter than the toe pads ${toeFill[1]}, as in the reference`)

console.log('component compact verification passed: locked visual reference, real DOM controls, measured paw-badge placement, no runtime panel screenshot')
