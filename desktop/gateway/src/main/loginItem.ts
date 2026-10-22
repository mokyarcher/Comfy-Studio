import { app } from 'electron'

/** Register / unregister Comfy Gateway in the OS login items list. */
export function applyOpenAtLogin(enabled: boolean): void {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return
  try {
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: enabled })
    } else {
      // Dev: electron.exe + app path so login item can relaunch the project.
      app.setLoginItemSettings({
        openAtLogin: enabled,
        path: process.execPath,
        args: [app.getAppPath()]
      })
    }
  } catch {
    /* ignore — some locked-down machines reject login-item changes */
  }
}

export function readOpenAtLogin(): boolean {
  try {
    return Boolean(app.getLoginItemSettings().openAtLogin)
  } catch {
    return false
  }
}
