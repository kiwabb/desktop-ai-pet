import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'

const MASTER_PATH = resolve('public/reference/desktop-pet-compact-reference.png')
const OUTPUT_PATH = resolve('public/reference/desktop-pet-closed-reference.png')
const CROP = { x: 1128, y: 48, width: 544, height: 893 }
const STRONG_ALPHA = 32
const EDGE_RADIUS = 3

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
  let offset = 8
  let width = 0
  let height = 0
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
        throw new Error('The approved reference must be a non-interlaced 8-bit RGBA PNG.')
    }
    if (type === 'IDAT')
      compressed.push(data)
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
        throw new Error(`Unsupported PNG filter ${filter}.`)
    }
    sourceOffset += stride
  }
  return { width, height, rgba }
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(data.length + 12)
  chunk.writeUInt32BE(data.length, 0)
  typeBytes.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), data.length + 8)
  return chunk
}

function encodeRgbaPng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 6, 0, 0, 0], 8)
  const scanlines = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y += 1)
    rgba.copy(scanlines, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function connectedComponents(master) {
  const { width, height, rgba } = master
  const pixelCount = width * height
  const labels = new Int32Array(pixelCount)
  labels.fill(-1)
  const queue = new Int32Array(pixelCount)
  const components = []

  for (let start = 0; start < pixelCount; start += 1) {
    if (labels[start] !== -1 || rgba[start * 4 + 3] < STRONG_ALPHA)
      continue

    const label = components.length
    let head = 0
    let tail = 1
    let count = 0
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0
    queue[0] = start
    labels[start] = label

    while (head < tail) {
      const index = queue[head++]
      const x = index % width
      const y = Math.floor(index / width)
      count += 1
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0)
            continue
          const nextX = x + dx
          const nextY = y + dy
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height)
            continue
          const next = nextY * width + nextX
          if (labels[next] === -1 && rgba[next * 4 + 3] >= STRONG_ALPHA) {
            labels[next] = label
            queue[tail++] = next
          }
        }
      }
    }
    components.push({ label, count, minX, minY, maxX, maxY })
  }
  return { labels, components }
}

const master = decodeRgbaPng(MASTER_PATH)
if (master.width !== 1672 || master.height !== 941)
  throw new Error(`Unexpected approved reference size ${master.width}x${master.height}.`)

const { labels, components } = connectedComponents(master)
const ranked = [...components].sort((left, right) => right.count - left.count)
const catAndStatusLabel = ranked[1]?.label
if (catAndStatusLabel === undefined)
  throw new Error('Could not locate the cat and status component.')

const keptLabels = new Set([catAndStatusLabel])
for (const component of components) {
  if (component.minX >= 1490 && component.minY < 540)
    keptLabels.add(component.label)
}

const selected = new Uint8Array(master.width * master.height)
for (let index = 0; index < labels.length; index += 1) {
  if (keptLabels.has(labels[index]))
    selected[index] = 1
}

// Preserve a narrow antialiased fringe around each approved subject while
// preventing the nearby chat-panel tail and shadow from entering the crop.
const dilated = new Uint8Array(selected.length)
for (let index = 0; index < selected.length; index += 1) {
  if (!selected[index])
    continue
  const x = index % master.width
  const y = Math.floor(index / master.width)
  for (let dy = -EDGE_RADIUS; dy <= EDGE_RADIUS; dy += 1) {
    for (let dx = -EDGE_RADIUS; dx <= EDGE_RADIUS; dx += 1) {
      const nextX = x + dx
      const nextY = y + dy
      if (nextX >= 0 && nextX < master.width && nextY >= 0 && nextY < master.height)
        dilated[nextY * master.width + nextX] = 1
    }
  }
}

const output = Buffer.alloc(CROP.width * CROP.height * 4)
for (let y = 0; y < CROP.height; y += 1) {
  for (let x = 0; x < CROP.width; x += 1) {
    const masterIndex = (CROP.y + y) * master.width + CROP.x + x
    if (!dilated[masterIndex] || master.rgba[masterIndex * 4 + 3] === 0)
      continue
    const outputIndex = (y * CROP.width + x) * 4
    master.rgba.copy(output, outputIndex, masterIndex * 4, masterIndex * 4 + 4)
  }
}

writeFileSync(OUTPUT_PATH, encodeRgbaPng(CROP.width, CROP.height, output))
console.log(`wrote ${OUTPUT_PATH} (${CROP.width}x${CROP.height})`)

// The chat panel uses the same master coordinate system but must not bring a
// second, differently scaled cat into the scene. Assign antialiased pixels to
// their nearest strong connected component so the panel's soft shadow is kept
// while the right-side pet, status badge, and doodles are excluded.
const nearest = new Int32Array(labels.length)
nearest.fill(-1)
const nearestQueue = new Int32Array(labels.length)
let nearestHead = 0
let nearestTail = 0
for (let index = 0; index < labels.length; index += 1) {
  if (labels[index] !== -1) {
    nearest[index] = labels[index]
    nearestQueue[nearestTail++] = index
  }
}
while (nearestHead < nearestTail) {
  const index = nearestQueue[nearestHead++]
  const componentLabel = nearest[index]
  const x = index % master.width
  const y = Math.floor(index / master.width)
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0)
        continue
      const nextX = x + dx
      const nextY = y + dy
      if (nextX < 0 || nextX >= master.width || nextY < 0 || nextY >= master.height)
        continue
      const next = nextY * master.width + nextX
      if (nearest[next] === -1 && master.rgba[next * 4 + 3] > 0) {
        nearest[next] = componentLabel
        nearestQueue[nearestTail++] = next
      }
    }
  }
}

const panelMask = new Uint8Array(labels.length)
const panelLabel = ranked[0].label
for (let index = 0; index < labels.length; index += 1)
  panelMask[index] = nearest[index] === panelLabel ? 1 : 0

const panelOutput = Buffer.alloc(master.width * master.height * 4)
for (let index = 0; index < panelMask.length; index += 1) {
  if (panelMask[index] && master.rgba[index * 4 + 3] > 0)
    master.rgba.copy(panelOutput, index * 4, index * 4, index * 4 + 4)
}
const PANEL_OUTPUT_PATH = resolve('public/reference/desktop-pet-chat-panel-reference.png')
writeFileSync(PANEL_OUTPUT_PATH, encodeRgbaPng(master.width, master.height, panelOutput))
console.log(`wrote ${PANEL_OUTPUT_PATH} (${master.width}x${master.height})`)
