import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const assetDir = path.join(root, 'public/pets/white-cat-v2')
const expected = ['idle.png', 'blink.png', 'talk.png']

function pngSize(filePath) {
  const buffer = fs.readFileSync(filePath)
  if (buffer.toString('ascii', 1, 4) !== 'PNG')
    throw new Error(`${filePath} is not a PNG`)
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

for (const name of expected) {
  const filePath = path.join(assetDir, name)
  if (!fs.existsSync(filePath))
    throw new Error(`Missing 2D pet frame: ${filePath}`)
  const size = pngSize(filePath)
  if (size.width !== 1207 || size.height !== 1303)
    throw new Error(`${name} must be 1207x1303, received ${size.width}x${size.height}`)
  const colorType = fs.readFileSync(filePath)[25]
  if (colorType !== 6)
    throw new Error(`${name} must use RGBA transparency, received PNG color type ${colorType}`)
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies }
for (const forbidden of ['three', '@types/three', '@esotericsoftware/spine-webgl']) {
  if (dependencies[forbidden])
    throw new Error(`Forbidden renderer dependency remains: ${forbidden}`)
}

const petStage = fs.readFileSync(path.join(root, 'src/components/PetStage.tsx'), 'utf8')
if (!petStage.includes("../lib/pet-2d-renderer"))
  throw new Error('PetStage is not wired to the 2D renderer')

console.log('white-cat-2d validation passed: 3 aligned PNG frames, no Spine or Three.js runtime dependency')
