import { describe, expect, it, vi } from 'vitest'
import { ReferenceThemeQueue } from './reference-theme-queue'
import type { CustomizationView } from './customization'
const view = (id: string) => ({ theme_draft: { id } }) as CustomizationView
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const flush = async () => { for (let i=0; i<20; i++) await Promise.resolve() }

describe('reference-theme queue, synthetic IPC promises; no provider calls', () => {
  it('discards slow old file reads before they can submit a paid analysis', async () => {
    const a = deferred<string[]>(), mutate = vi.fn().mockResolvedValue(view('B'))
    const queue = new ReferenceThemeQueue(mutate), error = vi.fn(), ready = vi.fn()
    let aborted = false
    queue.select(signal => { signal.addEventListener('abort', () => { aborted = true }); return a.promise }, 'A', error, ready)
    queue.select(async () => ['new'], 'B', error, ready)
    await flush(); a.resolve(['old']); await flush()
    expect(aborted).toBe(true)
    expect(mutate.mock.calls).toEqual([['theme_prepare', { images: ['new'], selectionId: 'B' }]])
  })
  it('serializes a late old prepare, clears it, then submits the new selection', async () => {
    const old = deferred<CustomizationView>()
    const mutate = vi.fn().mockImplementation((command, args) => command === 'theme_prepare' && args.selectionId === 'A' ? old.promise : Promise.resolve(view('B')))
    const queue = new ReferenceThemeQueue(mutate)
    queue.select(async () => ['old'], 'A', vi.fn(), vi.fn()); await flush()
    queue.select(async () => ['new'], 'B', vi.fn(), vi.fn()); await flush()
    expect(mutate).toHaveBeenCalledTimes(1)
    old.resolve(view('A')); await flush()
    expect(mutate.mock.calls).toEqual([['theme_prepare', { images:['old'], selectionId:'A' }], ['theme_clear', { id:'A' }], ['theme_prepare', { images:['new'], selectionId:'B' }]])
  })
  it('removing all files clears a late submitted draft and never automatically retries', async () => {
    const old = deferred<CustomizationView>(), mutate = vi.fn().mockImplementation((command) => command === 'theme_prepare' ? old.promise : Promise.resolve(view('none')))
    const queue = new ReferenceThemeQueue(mutate)
    queue.select(async () => ['old'], 'A', vi.fn(), vi.fn()); await flush()
    queue.select(null, 'empty', vi.fn(), vi.fn()); old.resolve(view('A')); await flush()
    expect(mutate.mock.calls).toEqual([['theme_prepare',{images:['old'],selectionId:'A'}],['theme_clear',{id:'A'}]])
    const failed = vi.fn().mockRejectedValue(new Error('failure')), onError = vi.fn()
    const other = new ReferenceThemeQueue(failed)
    other.select(async () => ['image'], 'C', onError, vi.fn()); await flush()
    expect(onError).toHaveBeenCalledWith('failure'); expect(failed).toHaveBeenCalledTimes(1)
  })
  it('unmount disposal invalidates pending reads and clears only its owned draft', async () => {
    const old = deferred<CustomizationView>(), mutate = vi.fn().mockImplementation((command) => command === 'theme_prepare' ? old.promise : Promise.resolve(view('none')))
    const queue = new ReferenceThemeQueue(mutate)
    queue.select(async () => ['old'], 'A', vi.fn(), vi.fn()); await flush()
    queue.dispose(); old.resolve(view('A')); await flush()
    expect(mutate.mock.calls).toEqual([['theme_prepare',{images:['old'],selectionId:'A'}],['theme_clear',{id:'A'}]])
  })
})
