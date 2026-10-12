import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { GatewayConfig } from '../shared/types'
import {
  adminApproveUser,
  adminGetLocalHold,
  adminGetPromptLibrary,
  adminGetStats,
  adminListUsers,
  adminPatchUser,
  adminRejectUser,
  adminReplacePromptLibrary,
  adminResetPassword,
  adminRotateKey,
  adminSetLocalHold,
  adminUnlistShowcase,
  fetchShowcaseAssetDataUrl,
  listShowcase
} from './adminApi'
import type { ServiceManager } from './serviceManager'
import { testComfy, testLocalApi, testPublicApi } from './health'

export function registerIpc(services: ServiceManager, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('gateway:getConfig', () => services.getConfig())

  ipcMain.handle('gateway:saveConfig', (_e, partial: Partial<GatewayConfig>) => {
    return services.saveConfig(partial ?? {})
  })

  ipcMain.handle('gateway:getStatus', async () => {
    await services.refreshProbes()
    return services.getStatus()
  })

  ipcMain.handle('gateway:startApi', () => services.startApi())
  ipcMain.handle('gateway:stopApi', () => services.stopApi())
  ipcMain.handle('gateway:startFrp', () => services.startFrp())
  ipcMain.handle('gateway:stopFrp', () => services.stopFrp())
  ipcMain.handle('gateway:startAll', () => services.startAll())
  ipcMain.handle('gateway:stopAll', () => services.stopAll())

  ipcMain.handle('gateway:getLogs', (_e, source?: 'api' | 'frp' | 'system', limit?: number) => {
    return services.logs.get(source, limit ?? 500)
  })

  ipcMain.handle('gateway:clearLogs', (_e, source?: 'api' | 'frp' | 'system') => {
    services.logs.clear(source)
    return { ok: true }
  })

  ipcMain.handle('gateway:testComfy', async () => {
    const cfg = services.getConfig()
    return testComfy(cfg.comfyUrl, cfg.requestTimeoutMs)
  })

  ipcMain.handle('gateway:testLocalApi', async () => {
    const cfg = services.getConfig()
    return testLocalApi(cfg.apiHost, cfg.apiPort, cfg.requestTimeoutMs)
  })

  ipcMain.handle('gateway:testPublicApi', async () => {
    const cfg = services.getConfig()
    return testPublicApi(cfg.publicBaseUrl, cfg.requestTimeoutMs)
  })

  ipcMain.handle('gateway:getApiKeyInfo', () => services.getApiKeyMasked())

  ipcMain.handle('gateway:revealApiKey', () => ({ key: services.getApiKeyRaw() }))

  ipcMain.handle('gateway:generateApiKey', () => ({ key: services.createRandomApiKey() }))

  ipcMain.handle(
    'gateway:updateApiKey',
    (_e, payload: { key: string; restart: boolean }) =>
      services.updateApiKey(payload.key, payload.restart)
  )

  ipcMain.handle('gateway:workflowInfo', () => services.workflowInfo())

  ipcMain.handle('gateway:pickDirectory', async () => {
    const win = getWindow()
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('gateway:pickFile', async (_e, filters?: Electron.FileFilter[]) => {
    const win = getWindow()
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: filters ?? [{ name: 'All', extensions: ['*'] }]
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('gateway:openPath', async (_e, targetPath: string) => {
    if (!targetPath) return { ok: false, message: '路径为空' }
    const err = await shell.openPath(targetPath)
    return { ok: !err, message: err || '已打开' }
  })

  ipcMain.handle('gateway:minimize', () => {
    getWindow()?.minimize()
  })

  ipcMain.handle('gateway:maximize', () => {
    const win = getWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.handle('gateway:close', () => {
    getWindow()?.close()
  })

  ipcMain.handle('gateway:adminStats', async () => {
    const cfg = services.getConfig()
    return adminGetStats(cfg, services.getApiKeyRaw())
  })

  ipcMain.handle('gateway:adminListUsers', async () => {
    const cfg = services.getConfig()
    return adminListUsers(cfg, services.getApiKeyRaw())
  })

  ipcMain.handle('gateway:adminApproveUser', async (_e, userId: string) => {
    const cfg = services.getConfig()
    return adminApproveUser(cfg, services.getApiKeyRaw(), userId)
  })

  ipcMain.handle('gateway:adminRejectUser', async (_e, userId: string) => {
    const cfg = services.getConfig()
    return adminRejectUser(cfg, services.getApiKeyRaw(), userId)
  })

  ipcMain.handle('gateway:adminPatchUser', async (_e, userId: string, body) => {
    const cfg = services.getConfig()
    return adminPatchUser(cfg, services.getApiKeyRaw(), userId, body ?? {})
  })

  ipcMain.handle('gateway:adminRotateKey', async (_e, userId: string) => {
    const cfg = services.getConfig()
    return adminRotateKey(cfg, services.getApiKeyRaw(), userId)
  })

  ipcMain.handle('gateway:adminResetPassword', async (_e, userId: string) => {
    const cfg = services.getConfig()
    return adminResetPassword(cfg, services.getApiKeyRaw(), userId)
  })

  ipcMain.handle('gateway:listShowcase', async (_e, limit?: number) => {
    const cfg = services.getConfig()
    return listShowcase(cfg, services.getApiKeyRaw(), limit ?? 80)
  })

  ipcMain.handle('gateway:fetchShowcaseAsset', async (_e, path: string) => {
    const cfg = services.getConfig()
    return fetchShowcaseAssetDataUrl(cfg, services.getApiKeyRaw(), path)
  })

  ipcMain.handle('gateway:adminUnlistShowcase', async (_e, itemId: string) => {
    const cfg = services.getConfig()
    return adminUnlistShowcase(cfg, services.getApiKeyRaw(), itemId)
  })

  ipcMain.handle('gateway:adminGetLocalHold', async () => {
    const cfg = services.getConfig()
    return adminGetLocalHold(cfg, services.getApiKeyRaw())
  })

  ipcMain.handle(
    'gateway:adminSetLocalHold',
    async (
      _e,
      body: { held: boolean; ttl_seconds?: number | null; message?: string | null }
    ) => {
      const cfg = services.getConfig()
      return adminSetLocalHold(cfg, services.getApiKeyRaw(), body ?? { held: false })
    }
  )

  ipcMain.handle('gateway:adminGetPromptLibrary', async () => {
    const cfg = services.getConfig()
    return adminGetPromptLibrary(cfg, services.getApiKeyRaw())
  })

  ipcMain.handle(
    'gateway:adminReplacePromptLibrary',
    async (_e, body: { templates: unknown[]; phrases: unknown[] }) => {
      const cfg = services.getConfig()
      return adminReplacePromptLibrary(cfg, services.getApiKeyRaw(), {
        templates: (body?.templates ?? []) as never,
        phrases: (body?.phrases ?? []) as never
      })
    }
  )
}
