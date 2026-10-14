import { create } from 'zustand'

export type AppSettings = {
  defaultWidth: number
  defaultHeight: number
  defaultSteps: number
  defaultNegativePrompt: string
  timeoutMs: number
  pollIntervalMs: number
  jobTimeoutMs: number
  autoPurge: boolean
  polishLanguage: 'match_input' | 'zh' | 'en'
  polishDetail: 'concise' | 'standard' | 'detailed'
  polishProfile: 'sdxl' | 'flux' | 'unknown' | 'wan'
}

const KEY = 'comfy-studio-web-settings'

const defaults: AppSettings = {
  defaultWidth: 1024,
  defaultHeight: 1024,
  defaultSteps: 25,
  defaultNegativePrompt: '',
  timeoutMs: 30_000,
  pollIntervalMs: 2000,
  jobTimeoutMs: 900_000,
  autoPurge: true,
  polishLanguage: 'match_input',
  polishDetail: 'standard',
  polishProfile: 'unknown'
}

type SettingsState = AppSettings & {
  hydrate: () => void
  patch: (p: Partial<AppSettings>) => void
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...defaults,
  hydrate: () => {
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as Partial<AppSettings>
      set({ ...defaults, ...parsed })
    } catch {
      /* ignore */
    }
  },
  patch: (p) => {
    const next = { ...get(), ...p }
    const { hydrate: _, patch: __, ...save } = next
    localStorage.setItem(KEY, JSON.stringify(save))
    set(p)
  }
}))
