import { create } from 'zustand'
import { DEFAULT_BACKGROUND_ID } from '@/lib/backgrounds'

export type AppSettings = {
  defaultWidth: number
  defaultHeight: number
  defaultSteps: number
  defaultNegativePrompt: string
  timeoutMs: number
  pollIntervalMs: number
  jobTimeoutMs: number
  autoPurge: boolean
  /** Upload result to Gateway private cloud gallery after success. */
  saveToCloud: boolean
  polishLanguage: 'match_input' | 'zh' | 'en'
  polishDetail: 'concise' | 'standard' | 'detailed'
  polishProfile: 'sdxl' | 'flux' | 'unknown' | 'wan'
  backgroundId: string
  /** Glass panel solid mix % (higher = less transparent). */
  glassOpacity: number
  /** Backdrop blur strength in px. */
  glassBlur: number
}

const KEY = 'comfy-studio-web-settings'

export const GLASS_OPACITY_MIN = 28
export const GLASS_OPACITY_MAX = 72
export const GLASS_OPACITY_DEFAULT = 46

export const GLASS_BLUR_MIN = 8
export const GLASS_BLUR_MAX = 48
export const GLASS_BLUR_DEFAULT = 30

function clampGlassOpacity(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : GLASS_OPACITY_DEFAULT
  return Math.min(GLASS_OPACITY_MAX, Math.max(GLASS_OPACITY_MIN, Math.round(v)))
}

function clampGlassBlur(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : GLASS_BLUR_DEFAULT
  return Math.min(GLASS_BLUR_MAX, Math.max(GLASS_BLUR_MIN, Math.round(v)))
}

const defaults: AppSettings = {
  defaultWidth: 1024,
  defaultHeight: 1024,
  defaultSteps: 25,
  defaultNegativePrompt: '',
  timeoutMs: 30_000,
  pollIntervalMs: 2000,
  jobTimeoutMs: 900_000,
  autoPurge: true,
  saveToCloud: true,
  polishLanguage: 'match_input',
  polishDetail: 'standard',
  polishProfile: 'unknown',
  backgroundId: DEFAULT_BACKGROUND_ID,
  glassOpacity: GLASS_OPACITY_DEFAULT,
  glassBlur: GLASS_BLUR_DEFAULT
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
      set({
        ...defaults,
        ...parsed,
        glassOpacity: clampGlassOpacity(parsed.glassOpacity ?? defaults.glassOpacity),
        glassBlur: clampGlassBlur(parsed.glassBlur ?? defaults.glassBlur)
      })
    } catch {
      /* ignore */
    }
  },
  patch: (p) => {
    const merged = { ...p }
    if (merged.glassOpacity != null) merged.glassOpacity = clampGlassOpacity(merged.glassOpacity)
    if (merged.glassBlur != null) merged.glassBlur = clampGlassBlur(merged.glassBlur)
    const next = { ...get(), ...merged }
    const { hydrate: _, patch: __, ...save } = next
    localStorage.setItem(KEY, JSON.stringify(save))
    set(merged)
  }
}))
