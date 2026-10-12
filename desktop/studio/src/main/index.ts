import { existsSync } from 'node:fs'
import { join } from 'path'
import { app, BrowserWindow, nativeImage, shell } from 'electron'
import { registerIpc } from './ipc'

if (process.platform === 'win32') {
  if (process.env.COMFY_SOFT_RENDER === '1') {
    app.disableHardwareAcceleration()
  } else {
    app.commandLine.appendSwitch('use-angle', 'd3d11')
    app.commandLine.appendSwitch('disable-features', 'CanvasOopRasterization')
  }
}

let mainWindow: BrowserWindow | null = null

function resolveAppIcon(): Electron.NativeImage | undefined {
  const candidates = [
    join(process.resourcesPath, 'icon.png'),
    join(process.resourcesPath, 'icon-32.png'),
    join(app.getAppPath(), 'resources', 'icon.png'),
    join(__dirname, '../../resources/icon.png')
  ]
  for (const p of candidates) {
    if (!existsSync(p)) continue
    const img = nativeImage.createFromPath(p)
    if (!img.isEmpty()) return img
  }
  return undefined
}

function createWindow(): void {
  const icon = resolveAppIcon()
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    frame: false,
    backgroundColor: '#12141a',
    title: 'Comfy Studio',
    autoHideMenuBar: true,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  })
  mainWindow.setBackgroundColor('#12141a')

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
