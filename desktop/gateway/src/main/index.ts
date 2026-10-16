import { existsSync } from 'node:fs'
import { join } from 'path'
import { app, BrowserWindow, dialog, nativeImage, shell } from 'electron'
import { registerIpc } from './ipc'
import { ServiceManager } from './serviceManager'
import { createTray } from './tray'

function resolveAppIcon(): Electron.NativeImage | undefined {
  const candidates = [
    join(process.resourcesPath, 'icon.png'),
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

/** Match renderer --bg; keep window & CSS in sync to avoid transparent seams. */
const WINDOW_BG = '#0f1419'

/**
 * Win11 + some discrete GPUs: translucent layers / backdrop-filter leave ghost frames.
 * - Default: ANGLE D3D11 (hardware, more stable than default on many machines)
 * - Fallback: Gateway.exe --disable-gpu   or   COMFY_SOFT_RENDER=1
 */
const wantSoftRender =
  process.env.COMFY_SOFT_RENDER === '1' ||
  process.argv.includes('--disable-gpu') ||
  process.argv.includes('--disable-gpu-compositing')

if (process.platform === 'win32') {
  if (wantSoftRender) {
    app.disableHardwareAcceleration()
  } else {
    app.commandLine.appendSwitch('use-angle', 'd3d11')
    app.commandLine.appendSwitch('disable-features', 'CanvasOopRasterization')
  }
}

let mainWindow: BrowserWindow | null = null
let services: ServiceManager
let quitting = false

/** Force Chromium to recompose after DWM focus changes (no full reload). */
function nudgeRepaint(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  void win.webContents
    .executeJavaScript(
      `(() => {
        const el = document.documentElement;
        el.style.transform = 'translateZ(0) scale(0.9999)';
        requestAnimationFrame(() => {
          el.style.transform = '';
        });
      })();`,
      true
    )
    .catch(() => {
      /* ignore */
    })
}

function createWindow(): void {
  const icon = resolveAppIcon()
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    // Custom TopBar already owns window buttons — avoid double chrome.
    frame: false,
    // Never use native transparency / vibrancy on Windows for this console.
    transparent: false,
    backgroundColor: WINDOW_BG,
    title: 'Comfy Gateway',
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
  mainWindow.setBackgroundColor(WINDOW_BG)

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('focus', () => nudgeRepaint(mainWindow))
  mainWindow.on('show', () => nudgeRepaint(mainWindow))
  mainWindow.on('restore', () => nudgeRepaint(mainWindow))

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    void handleCloseRequest()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function handleCloseRequest(): Promise<void> {
  const status = services.getStatus()
  const appOwns =
    status.api.startedByApp ||
    status.frp.startedByApp ||
    status.comfyRuntime.startedByApp ||
    Boolean(status.api.pid) ||
    Boolean(status.frp.pid) ||
    Boolean(status.comfyRuntime.pid)

  const buttons = appOwns
    ? ['最小化到托盘', '保持服务并退出', '退出并停止服务', '取消']
    : ['最小化到托盘', '退出', '取消']

  const { response } = await dialog.showMessageBox(mainWindow!, {
    type: 'question',
    title: '关闭 Comfy Gateway',
    message: appOwns
      ? '检测到本应用启动的服务仍在运行，请选择关闭方式：'
      : '要如何关闭窗口？',
    detail: appOwns
      ? '「保持服务并退出」不会结束 ComfyUI/API/FRP 子进程；「退出并停止服务」仅停止由本应用启动的进程。'
      : undefined,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
    noLink: true
  })

  if (appOwns) {
    if (response === 0) {
      mainWindow?.hide()
      return
    }
    if (response === 1) {
      quitting = true
      app.quit()
      return
    }
    if (response === 2) {
      await services.stopAppOwnedServices()
      quitting = true
      app.quit()
      return
    }
    return
  }

  if (response === 0) {
    mainWindow?.hide()
    return
  }
  if (response === 1) {
    quitting = true
    app.quit()
  }
}

async function quitFromTray(): Promise<void> {
  const status = services.getStatus()
  const appOwns =
    status.api.startedByApp || status.frp.startedByApp || status.comfyRuntime.startedByApp
  if (appOwns) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      title: '退出 Comfy Gateway',
      message: '是否停止由本应用启动的服务后退出？',
      buttons: ['退出并停止服务', '保持服务并退出', '取消'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    })
    if (response === 2) return
    if (response === 0) await services.stopAppOwnedServices()
  }
  quitting = true
  app.quit()
}

app.whenReady().then(() => {
  services = new ServiceManager()
  registerIpc(services, () => mainWindow)
  createWindow()
  createTray(
    () => mainWindow,
    services,
    () => {
      void quitFromTray()
    }
  )

  // Auto-start checked services after UI is up (does not block window show).
  void services.startOnLaunch()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else {
      mainWindow?.show()
      nudgeRepaint(mainWindow)
    }
  })
})

app.on('window-all-closed', () => {
  // Keep tray alive on Windows unless quitting
  if (process.platform !== 'darwin' && quitting) app.quit()
})

app.on('before-quit', () => {
  quitting = true
})
