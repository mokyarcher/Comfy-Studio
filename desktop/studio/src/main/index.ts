import { existsSync } from 'node:fs'
import { join } from 'path'
import { app, BrowserWindow, nativeImage, shell } from 'electron'
import {
  registerGalleryProtocolHandler,
  registerGalleryScheme
} from './galleryProtocol'
import { registerIpc } from './ipc'

registerGalleryScheme()

/** Match renderer --bg; keep window & CSS in sync to avoid transparent seams. */
const WINDOW_BG = '#12141a'

/**
 * Win11 + some discrete GPUs: translucent layers / backdrop-filter leave ghost frames.
 * - Default: ANGLE D3D11
 * - Fallback: "Comfy Studio.exe" --disable-gpu   or   COMFY_SOFT_RENDER=1
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
  // Comfy/Wan mp4 often flickers under HW video decode in Chromium (same class of
  // issue as ComfyUI desktop preview). Soft-decode unless explicitly re-enabled.
  const wantHwVideo =
    process.env.COMFY_HW_VIDEO === '1' || process.argv.includes('--enable-accelerated-video-decode')
  if (!wantHwVideo) {
    app.commandLine.appendSwitch('disable-accelerated-video-decode')
    app.commandLine.appendSwitch('disable-accelerated-video-encode')
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
    frame: false,
    transparent: false,
    backgroundColor: WINDOW_BG,
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

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerGalleryProtocolHandler()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
