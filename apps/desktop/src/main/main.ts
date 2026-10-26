import { app } from 'electron'

import { createMainWindow, createPetWindow, registerWindowIpc, type DesktopWindows } from './desktop-windows'

const windows: DesktopWindows = { main: null, pet: null, petVisible: false }
const singleInstance = app.requestSingleInstanceLock()

if (!singleInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    windows.main?.show()
    windows.main?.focus()
  })

  app.whenReady().then(() => {
    registerWindowIpc(windows)
    createMainWindow(windows)
    createPetWindow(windows)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (!windows.main) createMainWindow(windows)
    else windows.main.show()
  })
}
