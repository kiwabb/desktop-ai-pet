import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('desktop', {
  openPet: (): Promise<void> => ipcRenderer.invoke('main:pet:open'),
  hidePet: (): Promise<void> => ipcRenderer.invoke('main:pet:hide'),
  getPetState: (): Promise<{ visible: boolean }> => ipcRenderer.invoke('main:pet:state'),
})
