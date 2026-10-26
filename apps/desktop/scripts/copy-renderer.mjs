import { copyFile, mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktopDir = resolve(scriptDir, '..')
const distRendererDir = join(desktopDir, 'dist', 'renderer')
const distPreloadDir = join(desktopDir, 'dist', 'preload')

const copies = [
  ['renderer/main.html', 'dist/renderer/main.html'],
  ['renderer/pet.html', 'dist/renderer/pet.html'],
  ['renderer/pet.css', 'dist/renderer/pet.css'],
  ['renderer/assets/pets/white-cat-v2/idle.png', 'dist/renderer/assets/pets/white-cat-v2/idle.png'],
  ['renderer/assets/pets/white-cat-v2/blink.png', 'dist/renderer/assets/pets/white-cat-v2/blink.png'],
  ['renderer/assets/pets/white-cat-actions/eating-ai-v2-smooth/action.webp', 'dist/renderer/assets/pets/white-cat-actions/eating-ai-v2-smooth/action.webp'],
  ['renderer/assets/pets/white-cat-actions/play-wand/action.webp', 'dist/renderer/assets/pets/white-cat-actions/play-wand/action.webp'],
  ['renderer/assets/pets/white-cat-actions/belly-up/action.webp', 'dist/renderer/assets/pets/white-cat-actions/belly-up/action.webp'],
]

await mkdir(distRendererDir, { recursive: true })
await rm(join(distRendererDir, 'assets'), { recursive: true, force: true })
await build({
  root: join(desktopDir, 'renderer'),
  configFile: false,
  base: './',
  plugins: [],
  build: {
    outDir: distRendererDir,
    // Keep the tsc-emitted pet.js beside the Vite renderer bundle.
    emptyOutDir: false,
    rollupOptions: {
      input: join(desktopDir, 'renderer', 'main.html'),
    },
  },
})

for (const [name, source] of [
  ['main-preload', 'main-preload.ts'],
  ['pet-preload', 'pet-preload.ts'],
]) {
  await build({
    root: desktopDir,
    configFile: false,
    plugins: [],
    build: {
      outDir: distPreloadDir,
      emptyOutDir: false,
      lib: {
        entry: join(desktopDir, 'src', 'preload', source),
        formats: ['cjs'],
        fileName: () => `${name}.js`,
      },
      rollupOptions: {
        external: ['electron'],
      },
    },
  })
}

await rm(join(distRendererDir, 'assets', 'pets'), { recursive: true, force: true })
for (const [source, destination] of copies) {
  if (source === 'renderer/main.html') continue
  const sourcePath = join(desktopDir, source)
  const destinationPath = join(desktopDir, destination)
  await mkdir(dirname(destinationPath), { recursive: true })
  await copyFile(sourcePath, destinationPath)
}
