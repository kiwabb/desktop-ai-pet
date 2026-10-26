import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'

export interface DesktopWindows {
  main: BrowserWindow | null
  pet: BrowserWindow | null
  petVisible: boolean
}

function assertSender(event: IpcMainInvokeEvent, expected: BrowserWindow | null, channel: string): void {
  if (!expected || BrowserWindow.fromWebContents(event.sender) !== expected) {
    throw new Error(`Unauthorized sender for ${channel}`)
  }
}

function preloadPath(name: 'main-preload' | 'pet-preload'): string {
  return join(__dirname, '..', 'preload', `${name}.js`)
}

function rendererPath(name: 'main' | 'pet'): string {
  return join(__dirname, '..', '..', 'renderer', `${name}.html`)
}

export function createMainWindow(windows: DesktopWindows): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 760,
    minHeight: 520,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath('main-preload'),
    },
  })
  windows.main = window
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (windows.main === window) windows.main = null
  })
  void window.loadFile(rendererPath('main'))
  return window
}

export function createPetWindow(windows: DesktopWindows): BrowserWindow {
  const window = new BrowserWindow({
    width: 280,
    height: 280,
    minWidth: 180,
    minHeight: 180,
    frame: false,
    transparent: true,
    resizable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath('pet-preload'),
    },
  })
  windows.pet = window
  window.on('closed', () => {
    if (windows.pet === window) {
      windows.pet = null
      windows.petVisible = false
    }
  })
  void window.loadFile(rendererPath('pet'))
  return window
}

export function setPetVisible(windows: DesktopWindows, visible: boolean): void {
  if (!windows.pet || windows.pet.isDestroyed()) return
  windows.petVisible = visible
  if (visible) windows.pet.showInactive()
  else windows.pet.hide()
  if (!windows.pet.webContents.isDestroyed()) windows.pet.webContents.send('pet:state', { visible })
}

export function registerWindowIpc(windows: DesktopWindows): () => void {
  const openPet = (event: IpcMainInvokeEvent) => {
    assertSender(event, windows.main, 'main:pet:open')
    setPetVisible(windows, true)
  }
  const hidePet = (event: IpcMainInvokeEvent) => {
    assertSender(event, windows.main, 'main:pet:hide')
    setPetVisible(windows, false)
  }
  const petState = (event: IpcMainInvokeEvent) => {
    assertSender(event, windows.main, 'main:pet:state')
    return { visible: windows.petVisible }
  }
  const petOpenMain = (event: IpcMainInvokeEvent) => {
    assertSender(event, windows.pet, 'pet:main:open')
    windows.main?.show()
    windows.main?.focus()
  }
  const petHide = (event: IpcMainInvokeEvent) => {
    assertSender(event, windows.pet, 'pet:hide')
    setPetVisible(windows, false)
  }

  ipcMain.handle('main:pet:open', openPet)
  ipcMain.handle('main:pet:hide', hidePet)
  ipcMain.handle('main:pet:state', petState)
  ipcMain.handle('pet:main:open', petOpenMain)
  ipcMain.handle('pet:hide', petHide)

  return () => {
    for (const channel of ['main:pet:open', 'main:pet:hide', 'main:pet:state', 'pet:main:open', 'pet:hide']) {
      ipcMain.removeHandler(channel)
    }
  }
}
