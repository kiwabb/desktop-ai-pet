import { invoke } from '@tauri-apps/api/core'
import type { PetState } from './pet-state'
export const PET_KINDS = ['base', 'closed', 'happy', 'talk'] as const
export type PetKind = typeof PET_KINDS[number]
export const PET_KIND_LABELS: Record<PetKind, string> = { base: '陪伴', closed: '休息', happy: '开心', talk: '说话' }
export type PetAsset = { width: number; height: number; anchor_x: number; anchor_y: number; connector_x?: number; connector_y?: number }
export type PetTheme = { palette: 'character' | 'apricot' | 'rose' | 'mint' | 'sky' | 'lilac' | 'custom'; primary: string; secondary: string; strength: number }
export type PetPreset = { theme?: PetTheme | null; colors?: string[]; id: string; name: string; accent: string; created_at: string; assets: Record<PetKind, PetAsset>; badge?: string | null }
export type CustomizationJob = { id: string; name: string; status: 'running' | 'failed' | 'cancelled' | 'interrupted' | 'ready'; stage: PetKind | 'saving'; completed: PetKind[]; request_count: number; error: string | null }
export type BadgeJob = { id: string; preset_id: string; status: 'running' | 'ready' | 'failed' | 'cancelled' | 'interrupted'; request_count: number; result: string | null; error: string | null }
export type BadgeUpdate = { action: 'select'; token: string } | { action: 'reset' }
export type CustomizationView = { revision: number; active_id: string; presets: PetPreset[]; job: CustomizationJob | null; badge_job?: BadgeJob | null; settings: { base_url: string; model: string; has_key: boolean }; warning: string | null }
export type PetSprites = Record<PetKind, string>
export type LoadedPet = { preset: PetPreset; sprites: PetSprites; badge?: string | null }
export function newerCustomization(current: CustomizationView | null, next: CustomizationView) { return !current || next.revision > current.revision }
export function customPetKind(state: PetState, closed: boolean): PetKind { return closed ? 'closed' : state === 'happy' ? 'happy' : state === 'talking' ? 'talk' : 'base' }
export async function loadPetSprites(id: string): Promise<PetSprites> {
  const entries = await Promise.all(PET_KINDS.map(async kind => {
    const src = await invoke<string>('customization_asset', { id, kind })
    if (!src.startsWith('data:image/png;base64,')) throw new Error('桌宠图片格式不正确，请重新生成。')
    const image = new Image(); image.src = src; await image.decode()
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('桌宠图片无法打开，请重新生成。')
    return [kind, src] as const
  }))
  return Object.fromEntries(entries) as PetSprites
}
export function validateReferenceFiles(files: File[]) {
  if (files.length < 1 || files.length > 4) throw new Error('请选择 1–4 张参考图。')
  if (files.some(file => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))) throw new Error('仅支持 PNG、JPEG 和 WebP 图片。')
  if (files.some(file => file.size > 10 * 1024 * 1024)) throw new Error('单张图片不能超过 10 MB。')
  if (files.reduce((sum, file) => sum + file.size, 0) > 30 * 1024 * 1024) throw new Error('参考图合计不能超过 30 MB。')
}
export async function readReference(file: File): Promise<string> {
  const signature = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => signature[i] === byte)
  const jpeg = signature[0] === 255 && signature[1] === 216 && signature[2] === 255
  const webp = new TextDecoder().decode(signature.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(signature.slice(8, 12)) === 'WEBP'
  if (!png && !jpeg && !webp) throw new Error(`「${file.name}」不是有效的 PNG、JPEG 或 WebP 图片。`)
  const url = URL.createObjectURL(file)
  try {
    const image = new Image(); image.src = url; await image.decode()
    const w = image.naturalWidth, h = image.naturalHeight
    if (w < 32 || h < 32 || w > 8192 || h > 8192 || w * h > 24_000_000) throw new Error('参考图应至少 32×32 像素，单边不超过 8192，且不超过 2400 万像素。')
  } catch (cause) {
    throw cause instanceof Error && cause.message.startsWith('参考图') ? cause : new Error(`「${file.name}」无法解码，请更换图片。`)
  } finally { URL.revokeObjectURL(url) }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`无法读取「${file.name}」，请重新选择。`))
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.readAsDataURL(file)
  })
}

export async function loadPetBadge(id: string, token?: string | null): Promise<string | null> {
  if (!token) return null
  const src = await invoke<string>('customization_asset', { id, kind: `badge-${token}` })
  if (!src.startsWith('data:image/png;base64,')) throw new Error('标志图片格式不正确。')
  const image = new Image(); image.src = src; await image.decode()
  if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 256 || image.naturalHeight > 256) throw new Error('标志图片无法打开。')
  return src
}
export async function loadPetAppearance(preset: PetPreset): Promise<{ pet: LoadedPet; warning: string | null }> {
  const sprites = await loadPetSprites(preset.id)
  try { return { pet: { preset, sprites, badge: await loadPetBadge(preset.id, preset.badge) }, warning: null } }
  catch { return { pet: { preset, sprites, badge: null }, warning: '配套标志无法读取，已显示原猫爪。可重新生成或恢复猫爪。' } }
}
