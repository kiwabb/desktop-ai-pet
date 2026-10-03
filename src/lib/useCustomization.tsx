import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { loadPetAppearance, newerCustomization } from './customization'
import type { CustomizationView, LoadedPet } from './customization'
import { presetTheme } from './customization-theme'

export type CustomizationController = {
  view: CustomizationView | null; active: LoadedPet | null; error: string | null; available: boolean
  refresh: () => Promise<void>
  mutate: (command: string, args?: Record<string, unknown>) => Promise<CustomizationView>
  activate: (id: string) => Promise<void>
}
const unavailable = async (): Promise<never> => { throw new Error('请在桌面应用中使用定制功能。') }
const Context = createContext<CustomizationController>({ view: null, active: null, error: null, available: false, refresh: unavailable, mutate: unavailable, activate: unavailable })
export const useCustomization = () => useContext(Context)

export function CustomizationProvider({ children }: { children: ReactNode }) {
  const available = isTauri()
  const mounted = useRef(true)
  const [view, setView] = useState<CustomizationView | null>(null)
  const latest = useRef<CustomizationView | null>(null)
  const [active, setActive] = useState<LoadedPet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [assetError, setAssetError] = useState<string | null>(null)
  const [assetRetry, setAssetRetry] = useState(0)
  const assetFailed = useRef(false)
  const accept = useCallback((next: CustomizationView) => {
    if (!mounted.current) return
    // Notification warnings may arrive on the same committed revision as the
    // event. They do not authorize replacing any older/newer appearance state.
    if (latest.current?.revision === next.revision) {
      setError(null)
      if (next.warning !== latest.current.warning) { latest.current = { ...latest.current, warning: next.warning }; setView(latest.current) }
      return
    }
    if (!newerCustomization(latest.current, next)) return
    latest.current = next; setView(next); setError(null)
  }, [])
  const refresh = useCallback(async () => {
    accept(await invoke<CustomizationView>('customization_view'))
    if (mounted.current && assetFailed.current) { assetFailed.current = false; setAssetRetry(value => value + 1) }
  }, [accept])
  const mutate = useCallback(async (command: string, args?: Record<string, unknown>) => {
    const next = await invoke<CustomizationView>(`customization_${command}`, args)
    accept(next); return next
  }, [accept])
  useEffect(() => {
    mounted.current = true
    if (!available) return () => { mounted.current = false }
    let disposed = false
    let unsubscribe: (() => void) | undefined
    void listen<CustomizationView>('customization:changed', event => { if (!disposed) accept(event.payload) })
      .then(async unlisten => {
        if (disposed) { unlisten(); return }
        unsubscribe = unlisten
        await refresh()
      }).catch(() => { if (!disposed) setError('定制信息读取失败，请在定制页面重试。') })
    const refetch = () => { void refresh().catch(() => { if (!disposed) setError('定制信息同步失败，请重试。') }) }
    window.addEventListener('focus', refetch)
    return () => { disposed = true; mounted.current = false; unsubscribe?.(); window.removeEventListener('focus', refetch) }
  }, [available, accept, refresh])
  const selectedPreset = view?.presets.find(item => item.id === view.active_id)
  const assetIdentity = selectedPreset ? `${selectedPreset.id}:${JSON.stringify(selectedPreset.assets)}:${selectedPreset.badge ?? ""}` : view?.active_id
  useEffect(() => {
    if (!view) return
    let disposed = false
    if (view.active_id === 'default') { setActive(null); setAssetError(null); assetFailed.current = false; return }
    const preset = selectedPreset
    if (!preset) { assetFailed.current = true; setAssetError('当前桌宠方案缺失，保留原形象。请恢复默认或重新选择。'); return }
    // Image ownership changes only when the selected asset set changes. Job
    // progress and name/theme updates cannot starve or repeat this decode.
    void loadPetAppearance(preset).then(({ pet, warning }) => {
      const current = latest.current?.presets.find(item => item.id === preset.id)
      if (!disposed && current && latest.current?.active_id === preset.id) { setActive({ ...pet, preset: current }); setAssetError(warning); assetFailed.current = !!warning }
    }).catch(() => { if (!disposed) { assetFailed.current = true; setAssetError('桌宠图片读取失败，保留原形象。请重新读取或恢复默认。') } })
    return () => { disposed = true }
  }, [assetIdentity, assetRetry])
  useEffect(() => {
    if (!selectedPreset) return
    setActive(previous => previous?.preset.id === selectedPreset.id ? { ...previous, preset: selectedPreset } : previous)
  }, [selectedPreset?.id, selectedPreset?.accent, selectedPreset?.name, JSON.stringify(selectedPreset?.theme)])
  useEffect(() => {
    const style = active ? presetTheme(active.preset.accent, active.preset.theme) : {}
    document.documentElement.toggleAttribute('data-custom-pet', !!active)
    Object.entries(style).forEach(([key, value]) => document.documentElement.style.setProperty(key, String(value)))
    return () => { Object.keys(style).forEach(key => document.documentElement.style.removeProperty(key)); document.documentElement.removeAttribute('data-custom-pet') }
  }, [active])
  const activate = useCallback(async (id: string) => {
    if (id !== 'default') {
      const preset = latest.current?.presets.find(item => item.id === id)
      if (!preset) throw new Error('找不到这个桌宠方案。')
      await loadPetAppearance(preset)
    }
    await mutate('activate', { id })
  }, [mutate])
  return <Context.Provider value={{ view, active, error: error || assetError, available, refresh, mutate, activate }}>{children}</Context.Provider>
}
