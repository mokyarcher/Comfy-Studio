import { create } from 'zustand'
import type { ApiProfile, AppSettings, EditImageSlot, LocalTask } from '../../../shared/types'
import { DEFAULT_SETTINGS } from '../../../shared/types'

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
  settings: AppSettings
  appVersion: string
  draft: CreateDraft
  setDraft: (partial: Partial<CreateDraft>) => void
  tasks: LocalTask[]
  upsertTask: (task: LocalTask) => void
  removeTask: (id: string) => void
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
}

function sessionLoggedIn(profiles: ApiProfile[]): boolean {
  return profiles.some((p) => p.hasApiKey)
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
  upsertTask: (task) =>
    set((s) => {
      const idx = s.tasks.findIndex((t) => t.id === task.id)
      if (idx < 0) return { tasks: [task, ...s.tasks] }
      const next = [...s.tasks]
      next[idx] = task
      return { tasks: next }
    }),
  removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
  busy: false,
  setBusy: (v) => set({ busy: v }),
  toast: null,
  showToast: (type, message) => set({ toast: { type, message } }),
  clearToast: () => set({ toast: null }),

  loadBootstrap: async () => {
    const [profileRes, settingsRes] = await Promise.all([
      window.studio.listProfiles(),
      window.studio.getSettings()
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
      tasks: [],
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
      set({
        connectionOk: result.ok,
        connectionMessage: result.ok
          ? `已连接 · ${result.latencyMs} ms${result.comfyui ? ` · ComfyUI ${result.comfyui}` : ''}`
          : result.message
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
      tasks: [],
      draftClearSeq: get().draftClearSeq + 1
    })
  }
}))
