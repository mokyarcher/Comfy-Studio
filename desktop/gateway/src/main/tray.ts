import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Menu, Tray, app, nativeImage, type BrowserWindow } from 'electron'
import type { ServiceManager } from './serviceManager'

let tray: Tray | null = null

function resolveIconPath(...names: string[]): string | null {
  const roots = [
    process.resourcesPath,
    join(app.getAppPath(), 'resources'),
    join(__dirname, '../../resources')
  ]
  for (const root of roots) {
    for (const name of names) {
      const p = join(root, name)
      if (existsSync(p)) return p
    }
  }
  return null
}

/** Visible purple gateway mark — previous data-URL placeholder decoded empty on Windows tray. */
function trayIcon(): Electron.NativeImage {
  const path = resolveIconPath('tray-16.png', 'tray.png', 'icon.png')
  if (path) {
    let img = nativeImage.createFromPath(path)
    if (!img.isEmpty()) {
      const size = img.getSize()
      if (size.width !== 16 || size.height !== 16) {
        img = img.resize({ width: 16, height: 16, quality: 'best' })
      }
      return img
    }
  }
  // last-resort solid purple square (valid 16×16 PNG)
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAhElEQVQ4T62T0Q2AIAxE36zACIzgCIzgCIzgCIzgCIzACIzACIzA3AXjH4QQCr2kIU3uvbo0AJRSzhjjCSBzzl+Sjlpr7wE4A2gA3JVSaozRSimllFJqYe8RgCOwa+8LYKuhRMQYozHn3AbgYK01Y4zWnHN7gOu9X4DHWrsBeLfWHgA8tNZ+AXwAEr4q0iZgW5QAAAAASUVORK5CYII='
  )
}

export function createTray(
  getWindow: () => BrowserWindow | null,
  services: ServiceManager,
  onQuit: () => void
): Tray {
  if (tray) return tray
  tray = new Tray(trayIcon())
  tray.setToolTip('Comfy Gateway')

  const rebuild = (): void => {
    const status = services.getStatus()
    const apiLabel =
      status.api.state === 'running' || status.localApi.ok ? 'API：运行中' : 'API：未就绪'
    const frpLabel = status.frp.state === 'running' ? 'FRP：运行中' : 'FRP：已停止'
    const comfyLabel = status.comfy.ok ? 'ComfyUI：在线' : 'ComfyUI：不可达'
    const publicLabel = status.publicApi.ok ? '公网：可用' : '公网：不可用'

    const menu = Menu.buildFromTemplate([
      {
        label: '打开主界面',
        click: () => {
          const win = getWindow()
          if (win) {
            win.show()
            win.focus()
          }
        }
      },
      { type: 'separator' },
      { label: apiLabel, enabled: false },
      { label: frpLabel, enabled: false },
      { label: comfyLabel, enabled: false },
      { label: publicLabel, enabled: false },
      { type: 'separator' },
      {
        label: '退出',
        click: () => onQuit()
      }
    ])
    tray?.setContextMenu(menu)
  }

  rebuild()
  tray.on('double-click', () => {
    const win = getWindow()
    win?.show()
    win?.focus()
  })

  setInterval(rebuild, 5000)
  app.on('before-quit', () => {
    tray?.destroy()
    tray = null
  })

  return tray
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
