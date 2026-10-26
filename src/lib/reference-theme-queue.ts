import type { CustomizationView } from './customization'

/** One serial prepare lane: a late prepare is cleared before a new one starts.
 * Reading can overlap, but stale reads never reach the server. No paid retry. */
export class ReferenceThemeQueue {
  private epoch = 0
  private lane: Promise<void> = Promise.resolve()
  private abort?: AbortController
  private draftId?: string
  constructor(private mutate: (command: string, args?: Record<string, unknown>) => Promise<CustomizationView>) {}
  select(read: ((signal: AbortSignal) => Promise<string[]>) | null, selectionId: string, onError: (message: string) => void, onPrepared: () => void) {
    const epoch = ++this.epoch
    this.abort?.abort()
    const abort = new AbortController(); this.abort = abort
    const clear = async () => {
      if (!this.draftId) return
      const id = this.draftId
      await this.mutate('theme_clear', { id })
      if (this.draftId === id) this.draftId = undefined
    }
    const enqueue = (work: () => Promise<void>) => {
      this.lane = this.lane.then(work).catch(error => { if (epoch === this.epoch) { onError(error instanceof Error ? error.message : String(error)); onPrepared() } })
    }
    enqueue(clear)
    if (!read) { onPrepared(); return }
    void read(abort.signal).then(images => {
      if (epoch !== this.epoch) return
      enqueue(async () => {
        if (epoch !== this.epoch) return
        const view = await this.mutate('theme_prepare', { images, selectionId })
        this.draftId = view.theme_draft?.id
        if (epoch !== this.epoch) { await clear(); return }
        onPrepared()
      })
    }).catch(error => { if (epoch === this.epoch) { onError(error instanceof Error ? error.message : String(error)); onPrepared() } })
  }
  dispose() {
    ++this.epoch; this.abort?.abort()
    this.lane = this.lane.then(async () => { if (this.draftId) await this.mutate('theme_clear', { id: this.draftId }); this.draftId = undefined }).catch(() => {})
  }
}
