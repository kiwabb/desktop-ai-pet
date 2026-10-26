import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('pet', {
  openMain: (): Promise<void> => ipcRenderer.invoke('pet:main:open'),
  hide: (): Promise<void> => ipcRenderer.invoke('pet:hide'),
  onVisibilityChange: (listener: (state: { visible: boolean }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: { visible: boolean }) => listener(state)
    ipcRenderer.on('pet:state', handler)
    return () => ipcRenderer.removeListener('pet:state', handler)
  },
})
