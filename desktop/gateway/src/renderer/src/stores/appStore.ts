import { create } from 'zustand'
import type {
  ActionResult,
  GatewayConfig,
  GatewayStatus,
  LogLine,
  ProbeResult
} from '../../../shared/types'

export type NavPage =
  | 'overview'
  | 'services'
  | 'workflow'
  | 'public'
  | 'users'
  | 'showcase'
  | 'prompts'
  | 'apikey'
  | 'logs'
  | 'settings'

interface ToastState {
  id: number
  type: 'success' | 'error' | 'info'
  message: string
}

interface AppState {
  page: NavPage
  status: GatewayStatus | null
  logs: LogLine[]
  busy: boolean
  toast: ToastState | null
  setPage: (page: NavPage) => void
  refreshStatus: () => Promise<void>
  refreshLogs: (source?: 'api' | 'frp' | 'system') => Promise<void>
  runAction: (fn: () => Promise<ActionResult>, okMsg?: string) => Promise<ActionResult>
  showToast: (type: ToastState['type'], message: string) => void
  clearToast: () => void
  saveConfig: (partial: Partial<GatewayConfig>) => Promise<void>
}

let toastSeq = 1

export const useAppStore = create<AppState>((set, get) => ({
  page: 'overview',
  status: null,
  logs: [],
  busy: false,
  toast: null,

  setPage: (page) => set({ page }),

  refreshStatus: async () => {
    const status = await window.gateway.getStatus()
    set({ status })
  },

  refreshLogs: async (source) => {
    const logs = await window.gateway.getLogs(source, 400)
    set({ logs })
  },

  runAction: async (fn, okMsg) => {
    set({ busy: true })
    try {
      const result = await fn()
      get().showToast(result.ok ? 'success' : 'error', okMsg && result.ok ? okMsg : result.message)
      await get().refreshStatus()
      await get().refreshLogs()
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      get().showToast('error', message)
      return { ok: false, message }
    } finally {
      set({ busy: false })
    }
  },

  showToast: (type, message) => {
    const id = toastSeq++
    set({ toast: { id, type, message } })
    window.setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null })
    }, 3200)
  },

  clearToast: () => set({ toast: null }),

  saveConfig: async (partial) => {
    const config = await window.gateway.saveConfig(partial)
    set((s) => ({
      status: s.status ? { ...s.status, config } : s.status
    }))
    get().showToast('success', '配置已保存')
    await get().refreshStatus()
  }
}))

export function probeLabel(p?: ProbeResult): string {
  if (!p) return '未知'
  if (p.ok) return '正常'
  if (p.state === 'unknown') return '未知'
  if (p.state === 'down') return '不可达'
  return '异常'
}
