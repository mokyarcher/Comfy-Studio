import { z } from 'zod'

export const GenerateParamsSchema = z.object({
  mode: z.enum(['txt2img', 'image_edit', 'image_to_video']).default('txt2img'),
  prompt: z.string().min(1),
  negative_prompt: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  steps: z.number().int().positive().optional(),
  seed: z.number().int().nullable().optional(),
  /** Wan video frame length (optional; server workflow default if omitted) */
  length: z.number().int().positive().optional(),
  /** ComfyUI input filenames after upload (image_1..N) */
  images: z.array(z.string().min(1)).max(10).optional()
})

export type GenerateParams = z.infer<typeof GenerateParamsSchema>

/** Local edit-image slot before upload to API */
export interface EditImageSlot {
  id: string
  name: string
  previewDataUrl: string
  bytesBase64: string
}

export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed'

/** Local UI phase for generate lifecycle (not API fields). */
export type GenerateUiPhase =
  | 'waiting'
  | 'submitted'
  | 'polling'
  | 'downloading'
  | 'done'
  | 'failed'

export interface GenerateProgressEvent {
  localId: string
  phase: GenerateUiPhase
  remoteStatus?: TaskStatus
  remoteTaskId?: string
  message?: string
  error?: string
  seed?: number | null
  imageDataUrl?: string
  galleryItem?: GalleryItem | null
  elapsedMs?: number
  queueAhead?: number | null
  queuePosition?: number | null
  queueSize?: number | null
}

export interface ApiProfile {
  id: string
  name: string
  baseUrl: string
  /** Masked key for renderer; plaintext only in main when decrypting */
  apiKeyMasked: string
  hasApiKey: boolean
  /** Studio login username when session came from /v1/auth/login */
  username?: string
  healthPath: string
  timeoutMs: number
  isDefault: boolean
  lastTestAt?: string
  lastTestOk?: boolean
  lastTestLatencyMs?: number
  lastTestMessage?: string
  createdAt: string
  updatedAt: string
}

export interface ApiProfileInput {
  id?: string
  name: string
  baseUrl: string
  apiKey?: string
  username?: string
  healthPath?: string
  timeoutMs?: number
  setDefault?: boolean
}

export interface GalleryItem {
  id: string
  prompt: string
  negativePrompt?: string
  width: number
  height: number
  steps: number
  seed?: number | null
  taskId: string
  path: string
  createdAt: string
  favorite: boolean
  profileId?: string
  profileName?: string
  mode?: 'txt2img' | 'image_edit' | 'image_to_video'
  /** Local paths to reference images (image_edit / image_to_video) */
  refPaths?: string[]
  /** Remote showcase id after sharing */
  showcaseId?: string | null
}

export interface ShowcaseItem {
  id: string
  author_name: string
  author_username: string
  status: string
  prompt: string
  negative_prompt?: string | null
  mode: string
  width: number
  height: number
  steps: number
  seed?: number | null
  ref_count: number
  created_at: string
  updated_at: string
  image_url: string
  /** Lightweight preview for list grid; prefer this over image_url until detail open */
  thumb_url?: string
  ref_urls: string[]
  mine?: boolean
}

export interface PromptPolishPrefsStored {
  mode: 'ai'
  outputLanguage: 'match_input' | 'zh' | 'en'
  detail: 'concise' | 'standard' | 'detailed'
  modelProfile: 'sd15' | 'sdxl' | 'flux' | 'sd3' | 'unknown'
}

export interface AppSettings {
  theme: 'dark' | 'light' | 'system'
  defaultWidth: number
  defaultHeight: number
  defaultSteps: number
  defaultNegativePrompt: string
  timeoutMs: number
  pollIntervalMs: number
  /** Prompt polish UI preferences (no secrets). */
  polishPrefs?: PromptPolishPrefsStored
}

export interface LocalTask {
  id: string
  remoteTaskId?: string
  status: TaskStatus | 'submitting' | 'waiting' | 'cancelled'
  phase?: GenerateUiPhase
  prompt: string
  negativePrompt?: string
  width: number
  height: number
  steps: number
  seed?: number | null
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  error?: string
  progressMessage?: string
  imageDataUrl?: string
  profileId?: string
  profileName?: string
  galleryId?: string
}

export interface HealthResult {
  ok: boolean
  status?: string
  comfyui?: string
  latencyMs: number
  message: string
  httpStatus?: number
}

export interface GenerateResult {
  taskId: string
  status: TaskStatus
  queuePosition?: number | null
  queueAhead?: number | null
  queueSize?: number | null
}

export interface TaskPollResult {
  taskId: string
  status: TaskStatus
  error?: string
  seed?: number | null
  queuePosition?: number | null
  queueAhead?: number | null
  queueSize?: number | null
}

export interface PromptTemplate {
  id: string
  title: string
  prompt: string
  negativePrompt?: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface PhraseChip {
  id: string
  text: string
  category: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  defaultWidth: 1024,
  defaultHeight: 1024,
  defaultSteps: 25,
  defaultNegativePrompt: '',
  /** Overall generate wait timeout (submit + poll + download). Default 900s. */
  timeoutMs: 900_000,
  pollIntervalMs: 2000,
  polishPrefs: {
    mode: 'ai',
    outputLanguage: 'match_input',
    detail: 'standard',
    modelProfile: 'unknown'
  }
}

export const SIZE_PRESETS = [
  { id: '512', label: '512²', width: 512, height: 512 },
  { id: '768', label: '768²', width: 768, height: 768 },
  { id: '1024', label: '1024²', width: 1024, height: 1024 },
  { id: 'landscape', label: '横版 1024×768', width: 1024, height: 768 },
  { id: 'portrait', label: '竖版 768×1024', width: 768, height: 1024 }
] as const
