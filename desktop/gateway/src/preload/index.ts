import { contextBridge, ipcRenderer } from 'electron'
import type {
  ActionResult,
  GatewayConfig,
  GatewayStatus,
  LogLine,
  LogSource,
  ProbeResult
} from '../shared/types'

const gateway = {
  getConfig: (): Promise<GatewayConfig> => ipcRenderer.invoke('gateway:getConfig'),
  saveConfig: (partial: Partial<GatewayConfig>): Promise<GatewayConfig> =>
    ipcRenderer.invoke('gateway:saveConfig', partial),
  getStatus: (): Promise<GatewayStatus> => ipcRenderer.invoke('gateway:getStatus'),
  startApi: (): Promise<ActionResult> => ipcRenderer.invoke('gateway:startApi'),
  stopApi: (): Promise<ActionResult> => ipcRenderer.invoke('gateway:stopApi'),
  forceStopApi: (): Promise<ActionResult> => ipcRenderer.invoke('gateway:forceStopApi'),
  startComfy: (): Promise<ActionResult> => ipcRenderer.invoke('gateway:startComfy'),
  stopComfy: (): Promise<ActionResult> => ipcRenderer.invoke('gateway:stopComfy'),
  forceStopComfy: (): Promise<ActionResult> => ipcRenderer.invoke('gateway:forceStopComfy'),
  startFrp: (): Promise<ActionResult> => ipcRenderer.invoke('gateway:startFrp'),
  stopFrp: (): Promise<ActionResult> => ipcRenderer.invoke('gateway:stopFrp'),
  startAll: (): Promise<ActionResult> => ipcRenderer.invoke('gateway:startAll'),
  stopAll: (): Promise<ActionResult> => ipcRenderer.invoke('gateway:stopAll'),
  getLogs: (source?: LogSource, limit?: number): Promise<LogLine[]> =>
    ipcRenderer.invoke('gateway:getLogs', source, limit),
  clearLogs: (source?: LogSource): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('gateway:clearLogs', source),
  testComfy: (): Promise<ProbeResult> => ipcRenderer.invoke('gateway:testComfy'),
  testLocalApi: (): Promise<ProbeResult> => ipcRenderer.invoke('gateway:testLocalApi'),
  testPublicApi: (): Promise<ProbeResult> => ipcRenderer.invoke('gateway:testPublicApi'),
  updateApiKey: (key: string, restart: boolean): Promise<ActionResult> =>
    ipcRenderer.invoke('gateway:updateApiKey', { key, restart }),
  getApiKeyInfo: (): Promise<{ masked: string; hasKey: boolean; rawLength: number }> =>
    ipcRenderer.invoke('gateway:getApiKeyInfo'),
  revealApiKey: (): Promise<{ key: string }> => ipcRenderer.invoke('gateway:revealApiKey'),
  generateApiKey: (): Promise<{ key: string }> => ipcRenderer.invoke('gateway:generateApiKey'),
  workflowInfo: (): Promise<{
    path: string
    exists: boolean
    mtime?: string
    size?: number
  }> => ipcRenderer.invoke('gateway:workflowInfo'),
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('gateway:pickDirectory'),
  pickFile: (filters?: { name: string; extensions: string[] }[]): Promise<string | null> =>
    ipcRenderer.invoke('gateway:pickFile', filters),
  openPath: (targetPath: string): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('gateway:openPath', targetPath),
  minimize: (): Promise<void> => ipcRenderer.invoke('gateway:minimize'),
  maximize: (): Promise<void> => ipcRenderer.invoke('gateway:maximize'),
  close: (): Promise<void> => ipcRenderer.invoke('gateway:close'),

  adminStats: () => ipcRenderer.invoke('gateway:adminStats'),
  adminListUsers: () => ipcRenderer.invoke('gateway:adminListUsers'),
  adminApproveUser: (userId: string) => ipcRenderer.invoke('gateway:adminApproveUser', userId),
  adminRejectUser: (userId: string) => ipcRenderer.invoke('gateway:adminRejectUser', userId),
  adminDeleteUser: (userId: string) => ipcRenderer.invoke('gateway:adminDeleteUser', userId),
  adminPatchUser: (userId: string, body: Record<string, unknown>) =>
    ipcRenderer.invoke('gateway:adminPatchUser', userId, body),
  adminRotateKey: (userId: string) => ipcRenderer.invoke('gateway:adminRotateKey', userId),
  adminResetPassword: (userId: string) => ipcRenderer.invoke('gateway:adminResetPassword', userId),

  listShowcase: (limit?: number) => ipcRenderer.invoke('gateway:listShowcase', limit),
  fetchShowcaseAsset: (path: string) => ipcRenderer.invoke('gateway:fetchShowcaseAsset', path),
  adminUnlistShowcase: (itemId: string) =>
    ipcRenderer.invoke('gateway:adminUnlistShowcase', itemId),

  adminGetLocalHold: () => ipcRenderer.invoke('gateway:adminGetLocalHold'),
  adminSetLocalHold: (body: {
    held: boolean
    ttl_seconds?: number | null
    message?: string | null
  }) => ipcRenderer.invoke('gateway:adminSetLocalHold', body),

  adminGetPromptLibrary: () => ipcRenderer.invoke('gateway:adminGetPromptLibrary'),
  adminReplacePromptLibrary: (body: { templates: unknown[]; phrases: unknown[] }) =>
    ipcRenderer.invoke('gateway:adminReplacePromptLibrary', body),
  adminListSharedPrompts: () => ipcRenderer.invoke('gateway:adminListSharedPrompts'),
  adminDeleteSharedPrompt: (itemId: string) =>
    ipcRenderer.invoke('gateway:adminDeleteSharedPrompt', itemId)
}

contextBridge.exposeInMainWorld('gateway', gateway)

export type GatewayApi = typeof gateway
