import { describe, expect, it, vi } from 'vitest'
import { customPetKind, loadPetAppearance, loadPetBadge, loadPetSprites, newerCustomization, validateReferenceFiles } from './customization'
import type { CustomizationView, PetPreset } from './customization'
import { contrast, petTheme } from './customization-theme'
const ipc = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke: ipc }))
const view = (revision: number): CustomizationView => ({ revision, active_id: 'default', presets: [], job: null, settings: { base_url: '', model: '', has_key: false }, warning: null })

describe('customization contract (unit fixtures)', () => {
  it('accepts initial revision zero and rejects late or duplicate state', () => {
    expect(newerCustomization(null, view(0))).toBe(true)
    expect(newerCustomization(view(6), view(5))).toBe(false)
    expect(newerCustomization(view(6), view(6))).toBe(false)
    expect(newerCustomization(view(6), view(7))).toBe(true)
  })
  it('uses generated expressions without applying a built-in mask', () => {
    expect(customPetKind('happy', false)).toBe('happy')
    expect(customPetKind('talking', false)).toBe('talk')
    expect(customPetKind('thinking', false)).toBe('base')
    expect(customPetKind('happy', true)).toBe('closed')
  })
  it('rejects wrong formats, oversized totals and missing references before IPC', () => {
    const file = (size: number, type = 'image/png') => ({ size, type }) as File
    expect(() => validateReferenceFiles([])).toThrow('1–4')
    expect(() => validateReferenceFiles(Array(5).fill(file(1)))).toThrow('1–4')
    expect(() => validateReferenceFiles([file(1, 'image/svg+xml')])).toThrow('PNG')
    expect(() => validateReferenceFiles([file(11 * 1024 * 1024)])).toThrow('单张')
    expect(() => validateReferenceFiles(Array(4).fill(file(8 * 1024 * 1024)))).toThrow('合计')
    expect(() => validateReferenceFiles(Array(3).fill(file(10 * 1024 * 1024)))).not.toThrow()
  })
  it('does not return an activatable image set when any required state cannot decode', async () => {
    ipc.mockImplementation(async (_command, args) => `data:image/png;base64,${args.kind}`)
    vi.stubGlobal('Image', class { src = ''; naturalWidth = 768; naturalHeight = 960; decode() { return this.src.endsWith('closed') ? Promise.reject(new Error('decode failed')) : Promise.resolve() } })
    await expect(loadPetSprites('preset')).rejects.toThrow('decode failed')
    expect(ipc).toHaveBeenCalledTimes(4)
    vi.unstubAllGlobals()
  })
  it('guarantees text/action contrast for extreme and saturated user seeds', () => {
    for (const seed of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ea8fdd', '#7799af']) {
      const theme = petTheme(seed)
      for (const bg of ['surface', 'chrome', 'action', 'action-hover']) expect(contrast(theme['--companion-ink'], theme[`--companion-${bg}`])).toBeGreaterThanOrEqual(4.5)
      for (const bg of ['surface', 'chrome']) expect(contrast(theme['--companion-muted'], theme[`--companion-${bg}`])).toBeGreaterThanOrEqual(4.5)
    }
    expect(() => petTheme('url(example)')).toThrow()
  })
})

describe('optional badge loading (unit fixtures)', () => {
  const preset = { id: 'pet', name: '猫', accent: '#aabbcc', created_at: 'test', assets: {} } as PetPreset
  it('does not read optional assets for old presets or reset', async () => {
    ipc.mockClear()
    expect(await loadPetBadge('pet', null)).toBeNull()
    expect(await loadPetBadge('pet', undefined)).toBeNull()
    expect(ipc).not.toHaveBeenCalled()
  })
  it('keeps all pet states and warns when the optional mark is corrupt', async () => {
    ipc.mockImplementation(async (_command, args) => { if (args.kind.startsWith('badge-')) throw new Error('corrupt'); return 'data:image/png;base64,pet' })
    vi.stubGlobal('Image', class { src = ''; naturalWidth = 256; naturalHeight = 256; decode() { return Promise.resolve() } })
    const loaded = await loadPetAppearance({ ...preset, badge: 'bad' })
    expect(Object.keys(loaded.pet.sprites)).toEqual(['base', 'closed', 'happy', 'talk'])
    expect(loaded.pet.badge).toBeNull(); expect(loaded.warning).toContain('猫爪')
    vi.unstubAllGlobals()
  })
  it('loads changed immutable badge tokens on the same preset and honors reset', async () => {
    ipc.mockImplementation(async (_command, args) => `data:image/png;base64,${args.kind}`)
    vi.stubGlobal('Image', class { src = ''; naturalWidth = 256; naturalHeight = 256; decode() { return Promise.resolve() } })
    expect((await loadPetAppearance({ ...preset, badge: 'first' })).pet.badge).toContain('first')
    expect((await loadPetAppearance({ ...preset, badge: 'second' })).pet.badge).toContain('second')
    expect((await loadPetAppearance({ ...preset, badge: null })).pet.badge).toBeNull()
    vi.unstubAllGlobals()
  })
})
