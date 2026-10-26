export {}

declare global {
  interface Window {
    desktop?: {
      openPet(): Promise<void>
      hidePet(): Promise<void>
      getPetState(): Promise<{ visible: boolean }>
    }
    pet?: {
      openMain(): Promise<void>
      hide(): Promise<void>
      onVisibilityChange(listener: (state: { visible: boolean }) => void): () => void
    }
  }
}
