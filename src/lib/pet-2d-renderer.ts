import type { PetState } from './pet-state'

export interface PetRenderer {
  mount(host: HTMLElement): Promise<void>
  setState(state: PetState): void
  setDrag(dragging: boolean, tilt: number): void
  resize(width: number, height: number): void
  destroy(): void
}

const assets = {
  idle: '/pets/white-cat-v2/idle.png',
  blink: '/pets/white-cat-v2/blink.png',
  talk: '/pets/white-cat-v2/talk.png',
}

function preload(src: string) {
  return new Promise<void>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve()
    image.onerror = () => reject(new Error(`Failed to load 2D pet frame: ${src}`))
    image.src = src
  })
}

class LayeredPetRenderer implements PetRenderer {
  private destroyed = false
  private host: HTMLElement | null = null
  private root: HTMLDivElement | null = null
  private blinkTimer: number | null = null
  private blinkEndTimer: number | null = null
  private state: PetState = 'idle'

  async mount(host: HTMLElement) {
    this.host = host
    this.destroyed = false
    await Promise.all(Object.values(assets).map(preload))
    if (this.destroyed)
      return

    const root = document.createElement('div')
    root.className = 'pet-2d-character'
    root.dataset.state = this.state
    root.innerHTML = `
      <img class="pet-2d-frame pet-2d-idle" src="${assets.idle}" alt="" draggable="false">
      <img class="pet-2d-frame pet-2d-talk" src="${assets.talk}" alt="" draggable="false">
      <img class="pet-2d-frame pet-2d-blink" src="${assets.blink}" alt="" draggable="false">
    `
    host.replaceChildren(root)
    this.root = root
    window.addEventListener('pointermove', this.handlePointerMove, { passive: true })
    this.scheduleBlink()
  }

  setState(state: PetState) {
    this.state = state
    if (this.root)
      this.root.dataset.state = state
  }

  setDrag(dragging: boolean, tilt: number) {
    this.root?.classList.toggle('is-dragging', dragging)
    this.root?.style.setProperty('--drag-tilt', `${Math.max(-1, Math.min(1, tilt)) * 8}deg`)
  }

  resize() {}

  destroy() {
    this.destroyed = true
    window.removeEventListener('pointermove', this.handlePointerMove)
    if (this.blinkTimer !== null)
      window.clearTimeout(this.blinkTimer)
    if (this.blinkEndTimer !== null)
      window.clearTimeout(this.blinkEndTimer)
    this.host?.replaceChildren()
    this.host = null
    this.root = null
    this.blinkTimer = null
    this.blinkEndTimer = null
  }

  private scheduleBlink() {
    if (this.destroyed)
      return
    this.blinkTimer = window.setTimeout(() => {
      if (!this.root || this.state === 'sleeping') {
        this.scheduleBlink()
        return
      }
      this.root.classList.add('is-blinking')
      this.blinkEndTimer = window.setTimeout(() => {
        this.root?.classList.remove('is-blinking')
        this.scheduleBlink()
      }, 125)
    }, 2200 + Math.random() * 3600)
  }

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (!this.root)
      return
    const x = event.clientX / Math.max(window.innerWidth, 1) * 2 - 1
    const y = event.clientY / Math.max(window.innerHeight, 1) * 2 - 1
    this.root.style.setProperty('--look-x', `${x * 1.2}px`)
    this.root.style.setProperty('--look-y', `${y * 0.8}px`)
  }
}

export function createPetRenderer(): PetRenderer {
  return new LayeredPetRenderer()
}
