import { mapHttpError, mapNetworkError, sanitizeErrorMessage } from '../../shared/errors'
import type {
  GenerateParams,
  GenerateResult,
  HealthResult,
  TaskPollResult,
  TaskProgressInfo,
  TaskStatus
} from '../../shared/types'
import { joinUrl } from '../../shared/url'

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs: number }
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), init.timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function parseJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { detail: text.slice(0, 200) }
  }
}

export async function testConnection(opts: {
  baseUrl: string
  healthPath: string
  timeoutMs: number
  apiKey?: string
}): Promise<HealthResult> {
  const url = joinUrl(opts.baseUrl, opts.healthPath || '/health/ready')
  const started = Date.now()
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      timeoutMs: opts.timeoutMs,
      headers: { Accept: 'application/json' }
    })
    const latencyMs = Date.now() - started
    const body = await parseJsonSafe(res)

    if (res.ok) {
      const b = (body ?? {}) as {
        status?: string
        comfyui?: string
        max_steps?: number
        max_width?: number
        max_height?: number
      }
      return {
        ok: true,
        status: b.status,
        comfyui: b.comfyui,
        latencyMs,
        message: `就绪${b.comfyui ? ` · ComfyUI: ${b.comfyui}` : ''}`,
        httpStatus: res.status,
        maxSteps: typeof b.max_steps === 'number' ? b.max_steps : undefined,
        maxWidth: typeof b.max_width === 'number' ? b.max_width : undefined,
        maxHeight: typeof b.max_height === 'number' ? b.max_height : undefined
      }
    }

    return {
      ok: false,
      latencyMs,
      message: mapHttpError(res.status, body),
      httpStatus: res.status,
      status: typeof body === 'object' && body && 'status' in body ? String((body as { status: unknown }).status) : undefined,
      comfyui:
        typeof body === 'object' && body && 'comfyui' in body
          ? String((body as { comfyui: unknown }).comfyui)
          : undefined
    }
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      message: mapNetworkError(err)
    }
  }
}

function detailMessage(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body && 'detail' in body) {
    const d = (body as { detail: unknown }).detail
    if (typeof d === 'string') return d
  }
  return fallback
}

export async function authRegister(opts: {
  baseUrl: string
  username: string
  password: string
  displayName?: string
  timeoutMs?: number
}): Promise<{ ok: boolean; message: string; status?: string; userId?: string }> {
  const url = joinUrl(opts.baseUrl, '/v1/auth/register')
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      timeoutMs: opts.timeoutMs ?? 15_000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        username: opts.username,
        password: opts.password,
        display_name: opts.displayName || opts.username
      })
    })
    const body = await parseJsonSafe(res)
    if (!res.ok) {
      return { ok: false, message: detailMessage(body, mapHttpError(res.status, body)) }
    }
    const b = (body ?? {}) as { user_id?: string; status?: string; message?: string }
    return {
      ok: true,
      message: b.message || '注册成功，等待审核',
      status: b.status,
      userId: b.user_id
    }
  } catch (err) {
    return { ok: false, message: mapNetworkError(err) }
  }
}

export async function authChangePassword(opts: {
  baseUrl: string
  apiKey: string
  oldPassword: string
  newPassword: string
  timeoutMs?: number
}): Promise<{ ok: boolean; message: string }> {
  const url = joinUrl(opts.baseUrl, '/v1/auth/change-password')
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      timeoutMs: opts.timeoutMs ?? 15_000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-API-Key': opts.apiKey
      },
      body: JSON.stringify({
        old_password: opts.oldPassword,
        new_password: opts.newPassword
      })
    })
    const body = await parseJsonSafe(res)
    if (!res.ok) {
      return { ok: false, message: detailMessage(body, mapHttpError(res.status, body)) }
    }
    const b = (body ?? {}) as { message?: string }
    return { ok: true, message: b.message || '密码已修改' }
  } catch (err) {
    return { ok: false, message: mapNetworkError(err) }
  }
}

export async function authLogin(opts: {
  baseUrl: string
  username: string
  password: string
  timeoutMs?: number
}): Promise<{
  ok: boolean
  message: string
  apiKey?: string
  userId?: string
  username?: string
  name?: string
}> {
  const url = joinUrl(opts.baseUrl, '/v1/auth/login')
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      timeoutMs: opts.timeoutMs ?? 15_000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        username: opts.username,
        password: opts.password
      })
    })
    const body = await parseJsonSafe(res)
    if (!res.ok) {
      return { ok: false, message: detailMessage(body, mapHttpError(res.status, body)) }
    }
    const b = (body ?? {}) as {
      api_key?: string
      user_id?: string
      username?: string
      name?: string
    }
    if (!b.api_key) {
      return { ok: false, message: '登录响应缺少 API Key' }
    }
    return {
      ok: true,
      message: '登录成功',
      apiKey: b.api_key,
      userId: b.user_id,
      username: b.username,
      name: b.name
    }
  } catch (err) {
    return { ok: false, message: mapNetworkError(err) }
  }
}

export async function uploadImage(opts: {
  baseUrl: string
  apiKey: string
  timeoutMs: number
  filename: string
  bytes: Uint8Array
  contentType?: string
}): Promise<{ filename: string }> {
  const url = joinUrl(opts.baseUrl, '/v1/images/upload')
  const form = new FormData()
  const blob = new Blob([Buffer.from(opts.bytes)], {
    type: opts.contentType || 'application/octet-stream'
  })
  form.append('file', blob, opts.filename)
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      timeoutMs: opts.timeoutMs,
      headers: {
        Accept: 'application/json',
        'X-API-Key': opts.apiKey
      },
      body: form
    })
    const data = await parseJsonSafe(res)
    if (!res.ok) {
      throw new Error(mapHttpError(res.status, data))
    }
    const d = data as { filename?: string }
    if (!d.filename) throw new Error('上传成功但未返回文件名')
    return { filename: d.filename }
  } catch (err) {
    if (err instanceof Error && /密钥|参数|服务|接口|网关|ComfyUI|超时|无法|上传/.test(err.message)) {
      throw err
    }
    throw new Error(mapNetworkError(err))
  }
}

export async function purgeTask(opts: {
  baseUrl: string
  apiKey: string
  timeoutMs: number
  taskId: string
}): Promise<{ ok: boolean; message: string }> {
  const url = joinUrl(opts.baseUrl, `/v1/tasks/${opts.taskId}/purge`)
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      timeoutMs: opts.timeoutMs,
      headers: {
        Accept: 'application/json',
        'X-API-Key': opts.apiKey
      }
    })
    const data = await parseJsonSafe(res)
    if (!res.ok) {
      return { ok: false, message: mapHttpError(res.status, data) }
    }
    const d = (data ?? {}) as { message?: string }
    return { ok: true, message: d.message || 'purged' }
  } catch (err) {
    return { ok: false, message: mapNetworkError(err) }
  }
}

export async function submitGenerate(opts: {
  baseUrl: string
  apiKey: string
  timeoutMs: number
  params: GenerateParams
}): Promise<GenerateResult> {
  const url = joinUrl(opts.baseUrl, '/v1/images/generate')
  const body: Record<string, unknown> = {
    mode: opts.params.mode ?? 'txt2img',
    prompt: opts.params.prompt
  }
  if (opts.params.negative_prompt != null) body.negative_prompt = opts.params.negative_prompt
  if (opts.params.width != null) body.width = opts.params.width
  if (opts.params.height != null) body.height = opts.params.height
  if (opts.params.steps != null) body.steps = opts.params.steps
  if (opts.params.seed != null) body.seed = opts.params.seed
  if (opts.params.length != null) body.length = opts.params.length
  if (opts.params.images?.length) body.images = opts.params.images

  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      timeoutMs: opts.timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-API-Key': opts.apiKey
      },
      body: JSON.stringify(body)
    })
    const data = await parseJsonSafe(res)
    if (res.status === 202 || res.ok) {
      const d = data as {
        task_id?: string
        status?: TaskStatus
        queue_position?: number
        queue_ahead?: number
        queue_size?: number
      }
      if (!d.task_id) throw new Error('服务端未返回 task_id')
      return {
        taskId: d.task_id,
        status: d.status ?? 'queued',
        queuePosition: d.queue_position ?? null,
        queueAhead: d.queue_ahead ?? null,
        queueSize: d.queue_size ?? null
      }
    }
    throw new Error(mapHttpError(res.status, data))
  } catch (err) {
    if (err instanceof Error && !err.message.startsWith('请求') && err.message.includes('API')) {
      throw err
    }
    if (
      err instanceof Error &&
      /密钥|参数|队列|服务|接口|网关|ComfyUI|超时|无法|占用|本机/.test(err.message)
    ) {
      throw err
    }
    throw new Error(mapNetworkError(err))
  }
}

export async function pollTask(opts: {
  baseUrl: string
  apiKey: string
  timeoutMs: number
  taskId: string
}): Promise<TaskPollResult> {
  const url = joinUrl(opts.baseUrl, `/v1/tasks/${opts.taskId}`)
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      timeoutMs: opts.timeoutMs,
      headers: {
        Accept: 'application/json',
        'X-API-Key': opts.apiKey
      }
    })
    const data = await parseJsonSafe(res)
    if (!res.ok) {
      throw new Error(mapHttpError(res.status, data))
    }
    const d = data as {
      task_id?: string
      status?: TaskStatus
      error?: string
      error_message?: string
      seed?: number | null
      queue_position?: number
      queue_ahead?: number
      queue_size?: number
      progress?: { value?: number; max?: number; percent?: number } | null
    }
    if (!d.status) throw new Error('任务状态响应异常')
    const errMsg = d.error_message || d.error
    let progress: TaskProgressInfo | null = null
    if (
      d.progress &&
      typeof d.progress.value === 'number' &&
      typeof d.progress.max === 'number' &&
      d.progress.max > 0
    ) {
      progress = {
        value: d.progress.value,
        max: d.progress.max,
        percent:
          typeof d.progress.percent === 'number'
            ? d.progress.percent
            : Math.round((1000 * d.progress.value) / d.progress.max) / 10
      }
    }
    return {
      taskId: d.task_id ?? opts.taskId,
      status: d.status,
      error: errMsg ? sanitizeErrorMessage(errMsg) : undefined,
      seed: d.seed,
      queuePosition: d.queue_position ?? null,
      queueAhead: d.queue_ahead ?? null,
      queueSize: d.queue_size ?? null,
      progress
    }
  } catch (err) {
    if (err instanceof Error && /密钥|参数|队列|服务|接口|网关|ComfyUI|超时|无法|任务/.test(err.message)) {
      throw err
    }
    throw new Error(mapNetworkError(err))
  }
}

export async function translateViaGateway(opts: {
  baseUrl: string
  apiKey: string
  timeoutMs: number
  text: string
  direction?: 'en2zh' | 'zh2en'
}): Promise<{ translation: string; source: string; direction: 'en2zh' | 'zh2en' }> {
  const direction = opts.direction ?? 'en2zh'
  const url = joinUrl(opts.baseUrl, '/v1/prompt/translate')
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      timeoutMs: Math.min(opts.timeoutMs, 90_000),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-API-Key': opts.apiKey
      },
      body: JSON.stringify({ text: opts.text, direction })
    })
    const data = await parseJsonSafe(res)
    if (!res.ok) throw new Error(mapHttpError(res.status, data))
    const d = data as { translation?: string; source?: string; direction?: 'en2zh' | 'zh2en' }
    if (!d.translation) throw new Error('译文响应异常')
    return {
      translation: d.translation,
      source: d.source || opts.text,
      direction: d.direction ?? direction
    }
  } catch (err) {
    if (err instanceof Error && /密钥|服务|限流|配置|润色|翻译|上游|超时/.test(err.message)) {
      throw err
    }
    throw new Error(mapNetworkError(err))
  }
}

export async function polishViaGateway(opts: {
  baseUrl: string
  apiKey: string
  timeoutMs: number
  prompt: string
  negativePrompt?: string
  outputLanguage: string
  detail: string
  modelProfile: string
  generationMode?: string
}): Promise<{
  enhanced_prompt: string
  enhanced_negative_prompt?: string | null
  added_details: string[]
  preserved_constraints: string[]
  assumptions: string[]
  conflicts: Array<{ code: string; message: string; severity: string }>
  matched_categories: string[]
  model_profile?: string
  output_language?: string
  provider?: string
  quota?: {
    daily_limit: number
    daily_used: number
    daily_remaining: number
    per_minute_limit: number
    minute_used: number
  }
}> {
  const url = joinUrl(opts.baseUrl, '/v1/prompt/polish')
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      timeoutMs: opts.timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-API-Key': opts.apiKey
      },
      body: JSON.stringify({
        prompt: opts.prompt,
        negative_prompt: opts.negativePrompt || undefined,
        output_language: opts.outputLanguage,
        detail: opts.detail,
        model_profile: opts.modelProfile,
        generation_mode: opts.generationMode || 'txt2img'
      })
    })
    const data = await parseJsonSafe(res)
    if (!res.ok) {
      const detail =
        typeof data === 'object' && data && 'detail' in data
          ? (data as { detail: unknown }).detail
          : data
      if (typeof detail === 'object' && detail && detail !== null && 'message' in detail) {
        throw new Error(String((detail as { message: unknown }).message))
      }
      throw new Error(mapHttpError(res.status, data))
    }
    return data as {
      enhanced_prompt: string
      enhanced_negative_prompt?: string | null
      added_details: string[]
      preserved_constraints: string[]
      assumptions: string[]
      conflicts: Array<{ code: string; message: string; severity: string }>
      matched_categories: string[]
      quota?: {
        daily_limit: number
        daily_used: number
        daily_remaining: number
        per_minute_limit: number
        minute_used: number
      }
    }
  } catch (err) {
    if (err instanceof Error && /密钥|次数|频繁|润色|超时|无法|网关|服务/.test(err.message)) {
      throw err
    }
    throw new Error(mapNetworkError(err))
  }
}

export async function getPolishGatewayStatus(opts: {
  baseUrl: string
  apiKey: string
  timeoutMs: number
}): Promise<{
  enabled: boolean
  configured: boolean
  model?: string | null
  message: string
  quota?: {
    daily_limit: number
    daily_used: number
    daily_remaining: number
    per_minute_limit: number
    minute_used: number
  }
}> {
  const url = joinUrl(opts.baseUrl, '/v1/prompt/polish/status')
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    timeoutMs: Math.min(opts.timeoutMs, 20_000),
    headers: {
      Accept: 'application/json',
      'X-API-Key': opts.apiKey
    }
  })
  const data = await parseJsonSafe(res)
  if (!res.ok) throw new Error(mapHttpError(res.status, data))
  return data as {
    enabled: boolean
    configured: boolean
    model?: string | null
    message: string
    quota?: {
      daily_limit: number
      daily_used: number
      daily_remaining: number
      per_minute_limit: number
      minute_used: number
    }
  }
}

export type GpuState = 'idle' | 'busy'

export interface GpuStatusResult {
  ok: boolean
  state: GpuState | null
  queueRunning: number
  queueQueued: number
  localHold: boolean
  message: string
}

export async function fetchGpuStatus(opts: {
  baseUrl: string
  apiKey: string
  timeoutMs: number
}): Promise<GpuStatusResult> {
  if (!opts.apiKey) {
    return {
      ok: false,
      state: null,
      queueRunning: 0,
      queueQueued: 0,
      localHold: false,
      message: '缺少 API Key'
    }
  }
  const url = joinUrl(opts.baseUrl, '/v1/system/gpu')
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      timeoutMs: Math.min(opts.timeoutMs, 12_000),
      headers: {
        Accept: 'application/json',
        'X-API-Key': opts.apiKey
      }
    })
    const data = await parseJsonSafe(res)
    if (!res.ok) {
      return {
        ok: false,
        state: null,
        queueRunning: 0,
        queueQueued: 0,
        localHold: false,
        message: mapHttpError(res.status, data)
      }
    }
    const body = (data ?? {}) as {
      state?: string
      queue_running?: number
      queue_queued?: number
      local_hold?: boolean
    }
    const state: GpuState | null =
      body.state === 'busy' || body.state === 'idle' ? body.state : null
    return {
      ok: state != null,
      state,
      queueRunning: body.queue_running ?? 0,
      queueQueued: body.queue_queued ?? 0,
      localHold: Boolean(body.local_hold),
      message: state === 'busy' ? '繁忙' : state === 'idle' ? '空闲' : '状态未知'
    }
  } catch (err) {
    return {
      ok: false,
      state: null,
      queueRunning: 0,
      queueQueued: 0,
      localHold: false,
      message: err instanceof Error ? err.message : '无法读取 GPU 状态'
    }
  }
}

export interface ShowcaseItemDto {
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
  elapsed_ms?: number | null
  created_at: string
  updated_at: string
  image_url: string
  ref_urls: string[]
  mine?: boolean
}

export async function fetchPromptLibrary(opts: {
  baseUrl: string
  apiKey: string
  timeoutMs: number
}): Promise<{
  version: number
  updated_at: string
  templates: Array<{
    id: string
    title: string
    prompt: string
    negative_prompt?: string
    tags?: string[]
    created_at?: string
    updated_at?: string
  }>
  phrases: Array<{ id: string; text: string; category: string }>
}> {
  const url = joinUrl(opts.baseUrl, '/v1/prompt-library')
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    timeoutMs: Math.min(opts.timeoutMs, 60_000),
    headers: {
      Accept: 'application/json',
      'X-API-Key': opts.apiKey
    }
  })
  const data = await parseJsonSafe(res)
  if (!res.ok) throw new Error(mapHttpError(res.status, data))
  return data as {
    version: number
    updated_at: string
    templates: Array<{
      id: string
      title: string
      prompt: string
      negative_prompt?: string
      tags?: string[]
      created_at?: string
      updated_at?: string
    }>
    phrases: Array<{ id: string; text: string; category: string }>
  }
}

export interface SharedPromptDto {
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

export async function listSharedPrompts(opts: {
  baseUrl: string
  apiKey: string
  timeoutMs: number
  limit?: number
}): Promise<{ items: SharedPromptDto[]; count: number }> {
  const q = new URLSearchParams()
  if (opts.limit != null) q.set('limit', String(opts.limit))
  const qs = q.toString()
  const url = joinUrl(opts.baseUrl, `/v1/prompt-library/shared${qs ? `?${qs}` : ''}`)
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    timeoutMs: Math.min(opts.timeoutMs, 60_000),
    headers: {
      Accept: 'application/json',
      'X-API-Key': opts.apiKey
    }
  })
  const data = await parseJsonSafe(res)
  if (!res.ok) throw new Error(mapHttpError(res.status, data))
  return data as { items: SharedPromptDto[]; count: number }
}

export async function sharePromptTemplate(opts: {
  baseUrl: string
  apiKey: string
  timeoutMs: number
  title: string
  prompt: string
  negativePrompt?: string
  tags?: string[]
}): Promise<SharedPromptDto> {
  const url = joinUrl(opts.baseUrl, '/v1/prompt-library/shared')
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    timeoutMs: Math.min(opts.timeoutMs, 60_000),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-API-Key': opts.apiKey
    },
    body: JSON.stringify({
      title: opts.title,
      prompt: opts.prompt,
      negative_prompt: opts.negativePrompt || '',
      tags: opts.tags || []
    })
  })
  const data = await parseJsonSafe(res)
  if (!res.ok) throw new Error(mapHttpError(res.status, data))
  return data as SharedPromptDto
}

export async function deleteSharedPrompt(opts: {
  baseUrl: string
  apiKey: string
  timeoutMs: number
  itemId: string
}): Promise<SharedPromptDto> {
  const url = joinUrl(opts.baseUrl, `/v1/prompt-library/shared/${opts.itemId}`)
  const res = await fetchWithTimeout(url, {
    method: 'DELETE',
    timeoutMs: Math.min(opts.timeoutMs, 60_000),
    headers: {
      Accept: 'application/json',
      'X-API-Key': opts.apiKey
    }
  })
  const data = await parseJsonSafe(res)
  if (!res.ok) throw new Error(mapHttpError(res.status, data))
  return data as SharedPromptDto
}

export async function listShowcase(opts: {
  baseUrl: string
  apiKey: string
  timeoutMs: number
  limit?: number
  offset?: number
}): Promise<{ items: ShowcaseItemDto[]; count: number }> {
  const q = new URLSearchParams()
  if (opts.limit != null) q.set('limit', String(opts.limit))
  if (opts.offset != null) q.set('offset', String(opts.offset))
  const qs = q.toString()
  const url = joinUrl(opts.baseUrl, `/v1/showcase${qs ? `?${qs}` : ''}`)
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    timeoutMs: Math.min(opts.timeoutMs, 60_000),
    headers: {
      Accept: 'application/json',
      'X-API-Key': opts.apiKey
    }
  })
  const data = await parseJsonSafe(res)
  if (!res.ok) throw new Error(mapHttpError(res.status, data))
  return data as { items: ShowcaseItemDto[]; count: number }
}

export async function shareToShowcase(opts: {
  baseUrl: string
  apiKey: string
  timeoutMs: number
  prompt: string
  negativePrompt?: string
  mode: string
  width: number
  height: number
  steps: number
  seed?: number | null
  elapsedMs?: number | null
  image: { buffer: Buffer; filename: string }
  refs?: Array<{ buffer: Buffer; filename: string }>
}): Promise<ShowcaseItemDto> {
  const url = joinUrl(opts.baseUrl, '/v1/showcase')
  const form = new FormData()
  form.set('prompt', opts.prompt)
  form.set('negative_prompt', opts.negativePrompt || '')
  form.set('mode', opts.mode || 'txt2img')
  form.set('width', String(opts.width))
  form.set('height', String(opts.height))
  form.set('steps', String(opts.steps))
  if (opts.seed != null) form.set('seed', String(opts.seed))
  if (opts.elapsedMs != null && opts.elapsedMs > 0) {
    form.set('elapsed_ms', String(Math.round(opts.elapsedMs)))
  }
  form.set(
    'image',
    new Blob([new Uint8Array(opts.image.buffer)], { type: 'application/octet-stream' }),
    opts.image.filename || 'result.png'
  )
  for (const ref of opts.refs || []) {
    form.append(
      'refs',
      new Blob([new Uint8Array(ref.buffer)], { type: 'application/octet-stream' }),
      ref.filename || 'ref.png'
    )
  }
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      timeoutMs: Math.max(opts.timeoutMs, 120_000),
      headers: {
        Accept: 'application/json',
        'X-API-Key': opts.apiKey
      },
      body: form
    })
    const data = await parseJsonSafe(res)
    if (!res.ok) throw new Error(mapHttpError(res.status, data))
    return data as ShowcaseItemDto
  } catch (err) {
    if (err instanceof Error && /密钥|参数|服务|接口|网关|过大|提示/.test(err.message)) {
      throw err
    }
    throw new Error(mapNetworkError(err))
  }
}

/** Server has no such showcase item (already unlisted / wiped). */
export class ShowcaseNotFoundError extends Error {
  readonly status = 404
  constructor(message = '展馆中已无此作品（404）') {
    super(message)
    this.name = 'ShowcaseNotFoundError'
  }
}

export async function unlistShowcase(opts: {
  baseUrl: string
  apiKey: string
  timeoutMs: number
  itemId: string
}): Promise<ShowcaseItemDto> {
  const url = joinUrl(opts.baseUrl, `/v1/showcase/${opts.itemId}/unlist`)
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    timeoutMs: Math.min(opts.timeoutMs, 60_000),
    headers: {
      Accept: 'application/json',
      'X-API-Key': opts.apiKey
    }
  })
  const data = await parseJsonSafe(res)
  if (res.status === 404) throw new ShowcaseNotFoundError()
  if (!res.ok) throw new Error(mapHttpError(res.status, data))
  return data as ShowcaseItemDto
}

export async function fetchShowcaseAsset(opts: {
  baseUrl: string
  apiKey: string
  timeoutMs: number
  path: string
}): Promise<Buffer> {
  const path = opts.path.startsWith('/') ? opts.path : `/${opts.path}`
  const url = joinUrl(opts.baseUrl, path)
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      timeoutMs: opts.timeoutMs,
      headers: { 'X-API-Key': opts.apiKey }
    })
    if (!res.ok) {
      const data = await parseJsonSafe(res)
      throw new Error(mapHttpError(res.status, data))
    }
    const ab = await res.arrayBuffer()
    if (ab.byteLength < 32) throw new Error('图片数据过小，可能无效')
    return Buffer.from(ab)
  } catch (err) {
    if (err instanceof Error && /密钥|参数|服务|接口|网关|图片|过大|过小/.test(err.message)) {
      throw err
    }
    throw new Error(mapNetworkError(err))
  }
}

export async function fetchTaskImage(opts: {
  baseUrl: string
  apiKey: string
  timeoutMs: number
  taskId: string
  index?: number
}): Promise<{ buffer: Buffer; contentType: string }> {
  const index = opts.index ?? 0
  const url = joinUrl(opts.baseUrl, `/v1/tasks/${opts.taskId}/images/${index}`)
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      timeoutMs: opts.timeoutMs,
      headers: {
        'X-API-Key': opts.apiKey
      }
    })
    if (!res.ok) {
      const data = await parseJsonSafe(res)
      throw new Error(mapHttpError(res.status, data))
    }
    const contentType = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0]
    const isImage = contentType.startsWith('image/') || contentType.includes('octet-stream')
    const isVideo = contentType.startsWith('video/')
    if (contentType && !isImage && !isVideo) {
      throw new Error(`返回内容不是图片/视频（${contentType}）`)
    }
    const ab = await res.arrayBuffer()
    if (ab.byteLength < 32) throw new Error('媒体数据过小，可能无效')
    const maxBytes = isVideo ? 250 * 1024 * 1024 : 50 * 1024 * 1024
    if (ab.byteLength > maxBytes) throw new Error('媒体文件过大，已拒绝保存')
    return { buffer: Buffer.from(ab), contentType }
  } catch (err) {
    if (err instanceof Error && /密钥|参数|服务|接口|网关|图片|视频|媒体|过大|过小/.test(err.message)) {
      throw err
    }
    throw new Error(mapNetworkError(err))
  }
}
