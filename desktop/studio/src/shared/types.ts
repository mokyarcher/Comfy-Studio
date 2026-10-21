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

/** ComfyUI sampler progress from GET /v1/tasks/{id}.progress */
export interface TaskProgressInfo {
  value: number
  max: number
  percent: number
}

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
  progress?: TaskProgressInfo | null
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
  /** Wall-clock generate duration (ms), from submit to local save */
  elapsedMs?: number | null
  /** Local paths to reference images (image_edit / image_to_video) */
  refPaths?: string[]
  /** Remote showcase id after sharing */
  showcaseId?: string | null
}

export interface ShowcaseEngagement {
  like_count: number
  favorite_count: number
  comment_count: number
  liked_by_me: boolean
  favorited_by_me: boolean
}

export interface ShowcaseComment {
  id: string
  item_id: string
  user_id: string
  author_name: string
  body: string
  created_at: string
  mine?: boolean
}

export interface ShowcaseItem extends ShowcaseEngagement {
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
  /** Generate duration in ms when shared from Studio (optional) */
  elapsed_ms?: number | null
  created_at: string
  updated_at: string
  image_url: string
  /** Lightweight preview for list grid; prefer this over image_url until detail open */
  thumb_url?: string
  ref_urls: string[]
  mine?: boolean
}

/** Normalize API / cache payloads that may omit engagement fields. */
export function normalizeShowcaseItem(
  item: Omit<ShowcaseItem, keyof ShowcaseEngagement> & Partial<ShowcaseEngagement>
): ShowcaseItem {
  return {
    ...item,
    like_count: item.like_count ?? 0,
    favorite_count: item.favorite_count ?? 0,
    comment_count: item.comment_count ?? 0,
    liked_by_me: item.liked_by_me ?? false,
    favorited_by_me: item.favorited_by_me ?? false
  }
}

export interface PromptPolishPrefsStored {
  mode: 'ai'
  outputLanguage: 'match_input' | 'zh' | 'en'
  detail: 'concise' | 'standard' | 'detailed'
  modelProfile: 'sd15' | 'sdxl' | 'flux' | 'sd3' | 'unknown'
}

/** Gallery / showcase grid columns (NxN rows). */
export type MediaGridColumns = 4 | 5 | 6 | 7 | 8

export interface AppSettings {
  theme: 'dark' | 'light' | 'system'
  defaultWidth: number
  defaultHeight: number
  defaultSteps: number
  defaultNegativePrompt: string
  timeoutMs: number
  pollIntervalMs: number
  /** Works gallery & showcase: columns per row (4–8). */
  mediaGridColumns?: MediaGridColumns
  /** Prompt polish UI preferences (no secrets). */
  polishPrefs?: PromptPolishPrefsStored
}

export interface LocalTask {
  id: string
  remoteTaskId?: string
  status: TaskStatus | 'submitting' | 'waiting' | 'cancelled'
  phase?: GenerateUiPhase
  mode?: 'txt2img' | 'image_edit' | 'image_to_video'
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
  /** Live sampler progress from API (ephemeral). */
  progress?: TaskProgressInfo | null
  /** Ephemeral preview; not persisted to disk. */
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
  /** From GET /health/ready when API supports it */
  maxSteps?: number
  maxWidth?: number
  maxHeight?: number
}

/** Fallback when server has not reported limits yet */
export const DEFAULT_SERVER_LIMITS = {
  maxSteps: 40,
  maxWidth: 1024,
  maxHeight: 1024
} as const

export type ServerLimits = {
  maxSteps: number
  maxWidth: number
  maxHeight: number
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
  progress?: TaskProgressInfo | null
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

/** Player-shared template from GET /v1/prompt-library/shared */
export interface SharedPromptTemplate {
  id: string
  title: string
  prompt: string
  negativePrompt?: string | null
  tags: string[]
  authorName: string
  authorUsername: string
  createdAt: string
  mine: boolean
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
  mediaGridColumns: 4,
  polishPrefs: {
    mode: 'ai',
    outputLanguage: 'match_input',
    detail: 'standard',
    modelProfile: 'unknown'
  }
}

/** @deprecated Prefer IMAGE_MAX_WIDTH / IMAGE_MAX_HEIGHT. */
export const IMAGE_MAX_SIDE = 1928
/** Image modes: width ≤ 1928, height ≤ 1088 (×8). */
export const IMAGE_MAX_WIDTH = 1928
export const IMAGE_MAX_HEIGHT = 1088

/**
 * Video: landscape ≤ 800×496, portrait ≤ 496×800.
 * (500 is not ×8; 496 is the ≤500 ceiling.)
 */
export const VIDEO_MAX_LONG = 800
export const VIDEO_MAX_SHORT = 496

export const SIZE_PRESETS = [
  { id: 'fhd-wide', label: '横版 1928×1088', width: 1928, height: 1088 },
  { id: '512', label: '512²', width: 512, height: 512 },
  { id: '768', label: '768²', width: 768, height: 768 },
  { id: '1024', label: '1024²', width: 1024, height: 1024 },
  { id: 'landscape', label: '横版 1024×768', width: 1024, height: 768 },
  { id: 'portrait', label: '竖版 768×1024', width: 768, height: 1024 }
] as const

export const VIDEO_SIZE_PRESETS = [
  { id: 'v-landscape', label: '横版 800×496', width: 800, height: 496 },
  { id: 'v-portrait', label: '竖版 496×800', width: 496, height: 800 },
  { id: 'v-landscape-sm', label: '横版 640×384', width: 640, height: 384 },
  { id: 'v-portrait-sm', label: '竖版 384×640', width: 384, height: 640 },
  { id: 'v-square', label: '方版 496²', width: 496, height: 496 }
] as const

export function snapSizeMultiple(n: number, multiple = 8, maxSide = IMAGE_MAX_WIDTH): number {
  const m = Math.max(multiple, Math.round(n / multiple) * multiple)
  return Math.min(maxSide, Math.max(multiple, m))
}

export function clampImageSize(
  width: number,
  height: number,
  maxWidth = IMAGE_MAX_WIDTH,
  maxHeight = IMAGE_MAX_HEIGHT
): { width: number; height: number } {
  return {
    width: snapSizeMultiple(width, 8, Math.min(IMAGE_MAX_WIDTH, maxWidth)),
    height: snapSizeMultiple(height, 8, Math.min(IMAGE_MAX_HEIGHT, maxHeight))
  }
}

/** Fit into 800×496 (or 496×800) box while keeping aspect. */
export function clampVideoSize(width: number, height: number): { width: number; height: number } {
  let w = Math.max(8, width)
  let h = Math.max(8, height)
  const landscape = w >= h
  const maxW = landscape ? VIDEO_MAX_LONG : VIDEO_MAX_SHORT
  const maxH = landscape ? VIDEO_MAX_SHORT : VIDEO_MAX_LONG
  const scale = Math.min(1, maxW / w, maxH / h)
  w = snapSizeMultiple(w * scale, 8, maxW)
  h = snapSizeMultiple(h * scale, 8, maxH)
  // Re-clamp if snap pushed over the box
  if (w > maxW) w = maxW
  if (h > maxH) h = maxH
  if (w % 8 !== 0) w = snapSizeMultiple(w, 8, maxW)
  if (h % 8 !== 0) h = snapSizeMultiple(h, 8, maxH)
  return { width: w, height: h }
}

/** Pick output size matching source aspect within video limits. */
export function sizeFromAspect(
  srcW: number,
  srcH: number,
  targetLong = VIDEO_MAX_LONG
): { width: number; height: number } {
  if (srcW <= 0 || srcH <= 0) return { width: VIDEO_MAX_LONG, height: VIDEO_MAX_SHORT }
  const ratio = srcW / srcH
  if (ratio >= 1) {
    const width = snapSizeMultiple(Math.min(targetLong, VIDEO_MAX_LONG), 8, VIDEO_MAX_LONG)
    const height = snapSizeMultiple(width / ratio, 8, VIDEO_MAX_SHORT)
    return clampVideoSize(width, height)
  }
  const height = snapSizeMultiple(Math.min(targetLong, VIDEO_MAX_LONG), 8, VIDEO_MAX_LONG)
  const width = snapSizeMultiple(height * ratio, 8, VIDEO_MAX_SHORT)
  return clampVideoSize(width, height)
}
