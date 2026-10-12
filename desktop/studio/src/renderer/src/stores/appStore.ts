import { create } from 'zustand'
import type { ApiProfile, AppSettings, EditImageSlot, LocalTask, ServerLimits } from '../../../shared/types'
import { DEFAULT_SERVER_LIMITS, DEFAULT_SETTINGS } from '../../../shared/types'

export type NavPage =
  | 'create'
  | 'queue'
  | 'gallery'
  | 'showcase'
  | 'prompts'
  | 'connection'
  | 'settings'

interface CreateDraft {
  mode: 'txt2img' | 'image_edit' | 'image_to_video'
  prompt: string
  negativePrompt: string
  width: number
  height: number
  steps: number
  seed: number | null
  seedMode: 'random' | 'fixed'
  showNegative: boolean
  /** image_1 / image_2 for image_edit (max 2 mapped slots today) */
  editImages: Array<EditImageSlot | null>
}

interface AppState {
  page: NavPage
  setPage: (p: NavPage) => void
  bootstrapped: boolean
  isLoggedIn: boolean
  profiles: ApiProfile[]
  encryptionWarning: boolean
  encryptionAvailable: boolean
  activeProfileId: string | null
  connectionOk: boolean | null
  connectionMessage: string
  /** Deploy limits from last successful /health/ready */
  serverLimits: ServerLimits
  settings: AppSettings
  appVersion: string
  draft: CreateDraft
  setDraft: (partial: Partial<CreateDraft>) => void
  tasks: LocalTask[]
  upsertTask: (task: LocalTask) => void
  removeTask: (id: string) => void
  clearHistoryTasks: () => Promise<void>
  busy: boolean
  setBusy: (v: boolean) => void
  toast: { type: 'info' | 'success' | 'error'; message: string } | null
  showToast: (type: 'info' | 'success' | 'error', message: string) => void
  clearToast: () => void
  loadBootstrap: () => Promise<void>
  logout: () => Promise<void>
  refreshProfiles: () => Promise<void>
  setActiveProfile: (id: string) => Promise<void>
  checkConnection: () => Promise<void>
  applyReuse: (params: {
    prompt: string
    negativePrompt?: string
    width?: number
    height?: number
    steps?: number
    seed?: number | null
    mode?: 'txt2img' | 'image_edit' | 'image_to_video'
  }) => void
  draftClearSeq: number
  clearCreatePrompts: () => void
  /** Hide create-page preview after 清屏; survives nav; not gallery delete. */
  previewDismissed: boolean
  setPreviewDismissed: (v: boolean) => void
}

function sessionLoggedIn(profiles: ApiProfile[]): boolean {
  return profiles.some((p) => p.hasApiKey)
}

function isActiveStatus(status: LocalTask['status']): boolean {
  return (
    status === 'waiting' ||
    status === 'submitting' ||
    status === 'queued' ||
    status === 'running'
  )
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

function schedulePersistTasks(tasks: LocalTask[]): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    void window.studio.saveTaskHistory(tasks)
  }, 250)
}

export const useAppStore = create<AppState>((set, get) => ({
  page: 'create',
  setPage: (p) => set({ page: p }),
  bootstrapped: false,
  isLoggedIn: false,
  profiles: [],
  encryptionWarning: false,
  encryptionAvailable: true,
  activeProfileId: null,
  connectionOk: null,
  connectionMessage: '尚未检测连接',
  serverLimits: { ...DEFAULT_SERVER_LIMITS },
  settings: { ...DEFAULT_SETTINGS },
  appVersion: '1.0.0',
  draft: {
    mode: 'txt2img',
    prompt: '',
    negativePrompt: '',
    width: 1024,
    height: 1024,
    steps: 25,
    seed: null,
    seedMode: 'random',
    showNegative: false,
    editImages: [null, null]
  },
  setDraft: (partial) => set({ draft: { ...get().draft, ...partial } }),
  tasks: [],
  upsertTask: (task) => {
    set((s) => {
      const idx = s.tasks.findIndex((t) => t.id === task.id)
      if (idx < 0) return { tasks: [task, ...s.tasks] }
      const next = [...s.tasks]
      next[idx] = task
      return { tasks: next }
    })
    schedulePersistTasks(get().tasks)
  },
  removeTask: (id) => {
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }))
    schedulePersistTasks(get().tasks)
  },
  clearHistoryTasks: async () => {
    const keep = get().tasks.filter((t) => isActiveStatus(t.status))
    set({ tasks: keep })
    await window.studio.saveTaskHistory(keep)
  },
  busy: false,
  setBusy: (v) => set(v ? { busy: true, previewDismissed: false } : { busy: false }),
  toast: null,
  showToast: (type, message) => set({ toast: { type, message } }),
  clearToast: () => set({ toast: null }),

  loadBootstrap: async () => {
    const [profileRes, settingsRes, history] = await Promise.all([
      window.studio.listProfiles(),
      window.studio.getSettings(),
      window.studio.listTaskHistory() as Promise<LocalTask[]>
    ])
    const defaultProfile =
      profileRes.profiles.find((p: ApiProfile) => p.isDefault) ?? profileRes.profiles[0]
    const loggedIn = sessionLoggedIn(profileRes.profiles)
    set({
      bootstrapped: true,
      isLoggedIn: loggedIn,
      profiles: profileRes.profiles,
      encryptionWarning: profileRes.encryptionWarning,
      encryptionAvailable: profileRes.encryptionAvailable,
      activeProfileId: defaultProfile?.id ?? null,
      settings: settingsRes.settings,
      appVersion: settingsRes.version,
      tasks: Array.isArray(history) ? history : [],
      draft: {
        ...get().draft,
        width: settingsRes.settings.defaultWidth,
        height: settingsRes.settings.defaultHeight,
        steps: settingsRes.settings.defaultSteps,
        negativePrompt: settingsRes.settings.defaultNegativePrompt || get().draft.negativePrompt
      }
    })
    if (loggedIn && defaultProfile) {
      await get().checkConnection()
    } else if (!loggedIn) {
      set({ connectionOk: false, connectionMessage: '请先登录' })
    }
  },

  logout: async () => {
    await window.studio.logout()
    set({
      isLoggedIn: false,
      profiles: [],
      activeProfileId: null,
      connectionOk: false,
      connectionMessage: '已退出登录',
      page: 'create'
    })
  },

  refreshProfiles: async () => {
    const profileRes = await window.studio.listProfiles()
    const current = get().activeProfileId
    const still = profileRes.profiles.find((p: ApiProfile) => p.id === current)
    const fallback =
      still ?? profileRes.profiles.find((p: ApiProfile) => p.isDefault) ?? profileRes.profiles[0]
    set({
      profiles: profileRes.profiles,
      isLoggedIn: sessionLoggedIn(profileRes.profiles),
      encryptionWarning: profileRes.encryptionWarning,
      encryptionAvailable: profileRes.encryptionAvailable,
      activeProfileId: fallback?.id ?? null
    })
  },

  setActiveProfile: async (id) => {
    set({ activeProfileId: id })
    await window.studio.setActiveProfile(id)
    await get().refreshProfiles()
    await get().checkConnection()
  },

  checkConnection: async () => {
    const id = get().activeProfileId
    if (!id) {
      set({ connectionOk: false, connectionMessage: '请先登录' })
      return
    }
    try {
      const result = await window.studio.testConnection({ profileId: id })
      const nextLimits =
        result.ok &&
        (result.maxSteps != null || result.maxWidth != null || result.maxHeight != null)
          ? {
              maxSteps: result.maxSteps ?? get().serverLimits.maxSteps,
              maxWidth: result.maxWidth ?? get().serverLimits.maxWidth,
              maxHeight: result.maxHeight ?? get().serverLimits.maxHeight
            }
          : null
      set({
        connectionOk: result.ok,
        connectionMessage: result.ok
          ? `已连接 · ${result.latencyMs} ms${result.comfyui ? ` · ComfyUI ${result.comfyui}` : ''}`
          : result.message,
        ...(nextLimits
          ? {
              serverLimits: nextLimits,
              draft: {
                ...get().draft,
                steps: Math.min(get().draft.steps, nextLimits.maxSteps)
              }
            }
          : {})
      })
      await get().refreshProfiles()
    } catch (err) {
      set({
        connectionOk: false,
        connectionMessage: '无法与服务器建立连接，请检查相关配置'
      })
    }
  },

  applyReuse: (params) => {
    set({
      page: 'create',
      draft: {
        ...get().draft,
        mode: params.mode ?? get().draft.mode,
        prompt: params.prompt,
        negativePrompt: params.negativePrompt ?? '',
        width: params.width ?? get().draft.width,
        height: params.height ?? get().draft.height,
        steps: params.steps ?? get().draft.steps,
        seed: params.seed ?? null,
        seedMode: params.seed != null ? 'fixed' : 'random',
        showNegative: Boolean(params.negativePrompt)
      }
    })
  },

  draftClearSeq: 0,
  clearCreatePrompts: () => {
    if (get().busy) return
    set({
      draft: {
        ...get().draft,
        prompt: '',
        negativePrompt: '',
        showNegative: false,
        editImages: [null, null]
      },
      draftClearSeq: get().draftClearSeq + 1,
      previewDismissed: true
    })
  },
  previewDismissed: false,
  setPreviewDismissed: (v) => set({ previewDismissed: v })
}))
