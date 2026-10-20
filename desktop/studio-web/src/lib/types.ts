export type GenerateMode = 'txt2img' | 'image_edit' | 'image_to_video'
export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface GenerateParams {
  mode?: GenerateMode
  prompt: string
  negative_prompt?: string
  width?: number
  height?: number
  steps?: number
  seed?: number | null
  length?: number
  images?: string[]
}

export interface TaskProgressInfo {
  value: number
  max: number
  percent: number
}

export interface HealthResult {
  ok: boolean
  status?: string
  comfyui?: string
  latencyMs: number
  message: string
  httpStatus?: number
  maxSteps?: number
  maxWidth?: number
  maxHeight?: number
}

export interface LocalTask {
  id: string
  remoteTaskId?: string
  status: TaskStatus | 'submitting' | 'waiting' | 'failed'
  mode: GenerateMode
  prompt: string
  negativePrompt?: string
  width: number
  height: number
  steps: number
  seed?: number | null
  createdAt: string
  updatedAt: string
  error?: string
  progressMessage?: string
  progress?: TaskProgressInfo | null
  previewUrl?: string
  galleryId?: string
  queueAhead?: number | null
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
  createdAt: string
  favorite: boolean
  mode: GenerateMode
  mimeType: string
  blob: Blob
  showcaseId?: string | null
  cloudId?: string | null
}

export interface CloudGalleryItem {
  id: string
  prompt: string
  negative_prompt?: string | null
  mode: string
  width: number
  height: number
  steps: number
  seed?: number | null
  mime_type: string
  created_at: string
  updated_at: string
  image_url: string
  thumb_url?: string
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
  prompt: string
  negative_prompt?: string | null
  mode: string
  width: number
  height: number
  steps: number
  seed?: number | null
  created_at: string
  image_url: string
  thumb_url?: string
  ref_urls: string[]
  mine?: boolean
}

export interface PromptTemplate {
  id: string
  title: string
  prompt: string
  negative_prompt?: string
  tags?: string[]
}

export interface SharedPrompt {
  id: string
  title: string
  prompt: string
  negative_prompt?: string | null
  tags?: string[]
  author_name: string
  author_username: string
  created_at: string
  mine?: boolean
}
