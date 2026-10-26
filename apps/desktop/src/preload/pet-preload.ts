import { contextBridge, ipcRenderer } from 'electron'
import { PET_ACTIVITY_CHANNEL, type PetActivity } from '../shared/agent-runtime'

contextBridge.exposeInMainWorld('pet', {
  openMain: (): Promise<void> => ipcRenderer.invoke('pet:main:open'),
  hide: (): Promise<void> => ipcRenderer.invoke('pet:hide'),
  getActivity: (): Promise<PetActivity> => ipcRenderer.invoke(PET_ACTIVITY_CHANNEL),
  onActivityChange: (listener: (activity: PetActivity) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, activity: PetActivity) => listener(activity)
    ipcRenderer.on(PET_ACTIVITY_CHANNEL, handler)
    return () => ipcRenderer.removeListener(PET_ACTIVITY_CHANNEL, handler)
  },
  onVisibilityChange: (listener: (state: { visible: boolean }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: { visible: boolean }) => listener(state)
    ipcRenderer.on('pet:state', handler)
    return () => ipcRenderer.removeListener('pet:state', handler)
  },
})
