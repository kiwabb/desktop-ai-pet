import { app } from 'electron'

import { registerAgentIpc } from './agent-ipc'
import {
  createDesktopWindowsState,
  createMainWindow,
  createPetWindow,
  registerWindowIpc,
  type DesktopWindows,
} from './desktop-windows'

const windows: DesktopWindows = createDesktopWindowsState()
const singleInstance = app.requestSingleInstanceLock()

if (!singleInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    windows.main?.show()
    windows.main?.focus()
  })

  app.whenReady().then(() => {
    const disposeWindowIpc = registerWindowIpc(windows)
    const disposeAgentIpc = registerAgentIpc(windows)
    createMainWindow(windows)
    createPetWindow(windows)

    app.once('before-quit', () => {
      disposeWindowIpc()
      disposeAgentIpc()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (!windows.main) createMainWindow(windows)
    else windows.main.show()
  })
}
