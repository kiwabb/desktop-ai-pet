import { app, BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { IDLE_PET_ACTIVITY } from './pet-activity'
import { clampPetPosition, parsePetPosition } from './pet-position'
import { PET_ACTIVITY_CHANNEL, type PetActivity } from '../shared/agent-runtime'

const PET_POSITION_FILE = 'pet-position.json'

export interface DesktopWindows {
  main: BrowserWindow | null
  pet: BrowserWindow | null
  petVisible: boolean
  petActivity: PetActivity
  petPositionSaveTimer: NodeJS.Timeout | null
}

function assertSender(event: IpcMainInvokeEvent, expected: BrowserWindow | null, channel: string): void {
  if (
    !expected ||
    BrowserWindow.fromWebContents(event.sender) !== expected ||
    event.senderFrame !== expected.webContents.mainFrame
  ) {
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
  restorePetPosition(window)
  window.webContents.once('did-finish-load', () => {
    sendPetVisibility(windows)
    sendPetActivity(windows)
  })
  window.on('moved', () => schedulePetPositionSave(windows))
  window.on('close', () => flushPetPositionSave(windows))
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
  sendPetVisibility(windows)
}

export function setPetActivity(windows: DesktopWindows, activity: PetActivity): void {
  windows.petActivity = activity
  sendPetActivity(windows)
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
  const petActivity = (event: IpcMainInvokeEvent) => {
    assertSender(event, windows.pet, PET_ACTIVITY_CHANNEL)
    return windows.petActivity
  }

  ipcMain.handle('main:pet:open', openPet)
  ipcMain.handle('main:pet:hide', hidePet)
  ipcMain.handle('main:pet:state', petState)
  ipcMain.handle('pet:main:open', petOpenMain)
  ipcMain.handle('pet:hide', petHide)
  ipcMain.handle(PET_ACTIVITY_CHANNEL, petActivity)

  return () => {
    for (const channel of [
      'main:pet:open',
      'main:pet:hide',
      'main:pet:state',
      'pet:main:open',
      'pet:hide',
      PET_ACTIVITY_CHANNEL,
    ]) {
      ipcMain.removeHandler(channel)
    }
  }
}

function sendPetVisibility(windows: DesktopWindows): void {
  if (!windows.pet || windows.pet.isDestroyed() || windows.pet.webContents.isDestroyed()) return
  windows.pet.webContents.send('pet:state', { visible: windows.petVisible })
}

function sendPetActivity(windows: DesktopWindows): void {
  if (!windows.pet || windows.pet.isDestroyed() || windows.pet.webContents.isDestroyed()) return
  windows.pet.webContents.send(PET_ACTIVITY_CHANNEL, windows.petActivity)
}

export function createDesktopWindowsState(): DesktopWindows {
  return {
    main: null,
    pet: null,
    petVisible: false,
    petActivity: { ...IDLE_PET_ACTIVITY },
    petPositionSaveTimer: null,
  }
}

function restorePetPosition(window: BrowserWindow): void {
  const position = readPetPosition()
  if (!position) return
  const [width, height] = window.getSize()
  const display = screen.getDisplayNearestPoint(position)
  const clamped = clampPetPosition(position, display.workArea, { width, height })
  window.setPosition(clamped.x, clamped.y)
}

function schedulePetPositionSave(windows: DesktopWindows): void {
  if (!windows.pet || windows.pet.isDestroyed()) return
  if (windows.petPositionSaveTimer) clearTimeout(windows.petPositionSaveTimer)
  windows.petPositionSaveTimer = setTimeout(() => {
    windows.petPositionSaveTimer = null
    savePetPosition(windows.pet)
  }, 250)
}

function flushPetPositionSave(windows: DesktopWindows): void {
  if (windows.petPositionSaveTimer) {
    clearTimeout(windows.petPositionSaveTimer)
    windows.petPositionSaveTimer = null
  }
  savePetPosition(windows.pet)
}

function readPetPosition() {
  try {
    return parsePetPosition(JSON.parse(readFileSync(join(appUserDataPath(), PET_POSITION_FILE), 'utf8')))
  } catch {
    return null
  }
}

function savePetPosition(window: BrowserWindow | null): void {
  if (!window || window.isDestroyed()) return
  try {
    const [x, y] = window.getPosition()
    const path = join(appUserDataPath(), PET_POSITION_FILE)
    const temporary = `${path}.tmp`
    mkdirSync(appUserDataPath(), { recursive: true })
    writeFileSync(temporary, JSON.stringify({ version: 1, x, y }), 'utf8')
    renameSync(temporary, path)
  } catch {
    // Position persistence is best effort and must not prevent app shutdown.
  }
}

function appUserDataPath(): string {
  return app.getPath('userData')
}
