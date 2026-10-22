import { mapHttpError, mapNetworkError, sanitizeErrorMessage } from './errors'
import type {
  GenerateMode,
  GenerateParams,
  HealthResult,
  SharedPrompt,
  ShowcaseItem,
  TaskProgressInfo,
  TaskStatus,
  WorkflowInfo
} from './types'
import { joinUrl } from './url'

/** Empty string = same-origin (dev proxy / nginx). */
export function apiBase(): string {
  const fromEnv = (import.meta.env.VITE_API_BASE as string | undefined)?.trim() ?? ''
  return fromEnv.replace(/\/+$/, '')
}

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

function detailMessage(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body && 'detail' in body) {
    const d = (body as { detail: unknown }).detail
    if (typeof d === 'string') return d
  }
  return fallback
}

function authHeaders(apiKey: string, json = false): HeadersInit {
  const h: Record<string, string> = {
    Accept: 'application/json',
    'X-API-Key': apiKey
  }
  if (json) h['Content-Type'] = 'application/json'
  return h
}

export async function testConnection(opts?: {
  baseUrl?: string
  timeoutMs?: number
}): Promise<HealthResult> {
  const base = opts?.baseUrl ?? apiBase()
  const url = joinUrl(base, '/health/ready')
  const started = Date.now()
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      timeoutMs: opts?.timeoutMs ?? 15_000,
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
      httpStatus: res.status
    }
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, message: mapNetworkError(err) }
  }
}

export async function authRegister(opts: {
  baseUrl?: string
  username: string
  password: string
  displayName?: string
  email: string
}): Promise<{ ok: boolean; message: string }> {
  const url = joinUrl(opts.baseUrl ?? apiBase(), '/v1/auth/register')
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      timeoutMs: 15_000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        username: opts.username,
        password: opts.password,
        display_name: opts.displayName || opts.username,
        email: opts.email
      })
    })
    const body = await parseJsonSafe(res)
    if (!res.ok) return { ok: false, message: detailMessage(body, mapHttpError(res.status, body)) }
    const b = (body ?? {}) as { message?: string }
    return { ok: true, message: b.message || '注册成功，等待审核' }
  } catch (err) {
    return { ok: false, message: mapNetworkError(err) }
  }
}

export async function authLogin(opts: {
  baseUrl?: string
  username: string
  password: string
}): Promise<{
  ok: boolean
  message: string
  apiKey?: string
  userId?: string
  username?: string
  name?: string
  email?: string
}> {
  const url = joinUrl(opts.baseUrl ?? apiBase(), '/v1/auth/login')
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      timeoutMs: 15_000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username: opts.username, password: opts.password })
    })
    const body = await parseJsonSafe(res)
    if (!res.ok) return { ok: false, message: detailMessage(body, mapHttpError(res.status, body)) }
    const b = (body ?? {}) as {
      api_key?: string
      user_id?: string
      username?: string
      name?: string
      email?: string
    }
    if (!b.api_key) return { ok: false, message: '登录响应缺少 API Key' }
    return {
      ok: true,
      message: '登录成功',
      apiKey: b.api_key,
      userId: b.user_id,
      username: b.username,
      name: b.name,
      email: b.email || ''
    }
  } catch (err) {
    return { ok: false, message: mapNetworkError(err) }
  }
}

export async function authProfile(apiKey: string): Promise<{
  ok: boolean
  message: string
  email?: string
  username?: string
  name?: string
  userId?: string
}> {
  const url = joinUrl(apiBase(), '/v1/auth/profile')
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      timeoutMs: 15_000,
      headers: authHeaders(apiKey)
    })
    const body = await parseJsonSafe(res)
    if (!res.ok) return { ok: false, message: detailMessage(body, mapHttpError(res.status, body)) }
    const b = (body ?? {}) as {
      email?: string
      username?: string
      name?: string
      user_id?: string
    }
    return {
      ok: true,
      message: 'ok',
      email: b.email || '',
      username: b.username,
      name: b.name,
      userId: b.user_id
    }
  } catch (err) {
    return { ok: false, message: mapNetworkError(err) }
  }
}

export async function authChangePassword(opts: {
  apiKey: string
  oldPassword: string
  newPassword: string
}): Promise<{ ok: boolean; message: string }> {
  const url = joinUrl(apiBase(), '/v1/auth/change-password')
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      timeoutMs: 15_000,
      headers: authHeaders(opts.apiKey, true),
      body: JSON.stringify({
        old_password: opts.oldPassword,
        new_password: opts.newPassword
      })
    })
    const body = await parseJsonSafe(res)
    if (!res.ok) return { ok: false, message: detailMessage(body, mapHttpError(res.status, body)) }
    const b = (body ?? {}) as { message?: string }
    return { ok: true, message: b.message || '密码已修改' }
  } catch (err) {
    return { ok: false, message: mapNetworkError(err) }
  }
}

export async function authBindEmail(opts: {
  apiKey: string
  password: string
  email: string
}): Promise<{ ok: boolean; message: string; email?: string }> {
  const url = joinUrl(apiBase(), '/v1/auth/email')
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      timeoutMs: 15_000,
      headers: authHeaders(opts.apiKey, true),
      body: JSON.stringify({ password: opts.password, email: opts.email })
    })
    const body = await parseJsonSafe(res)
    if (!res.ok) return { ok: false, message: detailMessage(body, mapHttpError(res.status, body)) }
    const b = (body ?? {}) as { message?: string; email?: string }
    return { ok: true, message: b.message || '邮箱已绑定', email: b.email || opts.email }
  } catch (err) {
    return { ok: false, message: mapNetworkError(err) }
  }
}

export async function authPasswordResetSend(email: string): Promise<{
  ok: boolean
  message: string
  cooldownSeconds: number
}> {
  const url = joinUrl(apiBase(), '/v1/auth/password-reset/send')
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      timeoutMs: 20_000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email })
    })
    const body = await parseJsonSafe(res)
    if (!res.ok) {
      return {
        ok: false,
        message: detailMessage(body, mapHttpError(res.status, body)),
        cooldownSeconds: 0
      }
    }
    const b = (body ?? {}) as { message?: string; cooldown_seconds?: number }
    return {
      ok: true,
      message: b.message || '验证码已发送',
      cooldownSeconds: b.cooldown_seconds ?? 60
    }
  } catch (err) {
    return { ok: false, message: mapNetworkError(err), cooldownSeconds: 0 }
  }
}

export async function authPasswordReset(opts: {
  email: string
  code: string
  newPassword: string
  confirmPassword: string
}): Promise<{ ok: boolean; message: string }> {
  const url = joinUrl(apiBase(), '/v1/auth/password-reset')
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      timeoutMs: 15_000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        email: opts.email,
        code: opts.code,
        new_password: opts.newPassword,
        confirm_password: opts.confirmPassword
      })
    })
    const body = await parseJsonSafe(res)
    if (!res.ok) return { ok: false, message: detailMessage(body, mapHttpError(res.status, body)) }
    const b = (body ?? {}) as { message?: string }
    return { ok: true, message: b.message || '密码已重置' }
  } catch (err) {
    return { ok: false, message: mapNetworkError(err) }
  }
}

export async function uploadImage(opts: {
  apiKey: string
  timeoutMs: number
  file: File | Blob
  filename: string
}): Promise<{ filename: string }> {
  const url = joinUrl(apiBase(), '/v1/images/upload')
  const form = new FormData()
  form.append('file', opts.file, opts.filename)
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      timeoutMs: opts.timeoutMs,
      headers: { Accept: 'application/json', 'X-API-Key': opts.apiKey },
      body: form
    })
    const data = await parseJsonSafe(res)
    if (!res.ok) throw new Error(mapHttpError(res.status, data))
    const d = data as { filename?: string }
    if (!d.filename) throw new Error('上传成功但未返回文件名')
    return { filename: d.filename }
  } catch (err) {
    if (err instanceof Error && /密钥|参数|服务|上传/.test(err.message)) throw err
    throw new Error(mapNetworkError(err))
  }
}

export async function submitGenerate(opts: {
  apiKey: string
  timeoutMs: number
  params: GenerateParams
}): Promise<{
  taskId: string
  status: TaskStatus
  queuePosition?: number | null
  queueAhead?: number | null
}> {
  const url = joinUrl(apiBase(), '/v1/images/generate')
  const body: Record<string, unknown> = {
    mode: opts.params.mode ?? 'txt2img',
    prompt: opts.params.prompt
  }
  if (opts.params.workflow_id) body.workflow_id = opts.params.workflow_id
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
      headers: authHeaders(opts.apiKey, true),
      body: JSON.stringify(body)
    })
    const data = await parseJsonSafe(res)
    if (res.status === 202 || res.ok) {
      const d = data as {
        task_id?: string
        status?: TaskStatus
        queue_position?: number
        queue_ahead?: number
      }
      if (!d.task_id) throw new Error('服务端未返回 task_id')
      return {
        taskId: d.task_id,
        status: d.status ?? 'queued',
        queuePosition: d.queue_position ?? null,
        queueAhead: d.queue_ahead ?? null
      }
    }
    throw new Error(mapHttpError(res.status, data))
  } catch (err) {
    if (err instanceof Error && /密钥|参数|队列|服务|占用|本机/.test(err.message)) throw err
    throw new Error(mapNetworkError(err))
  }
}

export async function listWorkflows(opts: {
  apiKey: string
  timeoutMs?: number
  mode?: GenerateMode
}): Promise<{ mode: string; default: string | null; workflows: WorkflowInfo[] }> {
  const mode = opts.mode ?? 'txt2img'
  const url = joinUrl(apiBase(), `/v1/workflows?mode=${encodeURIComponent(mode)}`)
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      timeoutMs: opts.timeoutMs ?? 15000,
      headers: authHeaders(opts.apiKey, false)
    })
    const data = await parseJsonSafe(res)
    if (!res.ok) throw new Error(mapHttpError(res.status, data))
    const d = data as {
      mode?: string
      default?: string | null
      workflows?: WorkflowInfo[]
    }
    return {
      mode: d.mode ?? mode,
      default: d.default ?? null,
      workflows: Array.isArray(d.workflows) ? d.workflows : []
    }
  } catch (err) {
    if (err instanceof Error && /密钥|参数|服务/.test(err.message)) throw err
    throw new Error(mapNetworkError(err))
  }
}

export async function pollTask(opts: {
  apiKey: string
  timeoutMs: number
  taskId: string
}): Promise<{
  taskId: string
  status: TaskStatus
  error?: string
  seed?: number | null
  queueAhead?: number | null
  progress?: TaskProgressInfo | null
}> {
  const url = joinUrl(apiBase(), `/v1/tasks/${opts.taskId}`)
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      timeoutMs: opts.timeoutMs,
      headers: authHeaders(opts.apiKey)
    })
    const data = await parseJsonSafe(res)
    if (!res.ok) throw new Error(mapHttpError(res.status, data))
    const d = data as {
      task_id?: string
      status?: TaskStatus
      error?: string
      error_message?: string
      seed?: number | null
      queue_ahead?: number
      progress?: { value?: number; max?: number; percent?: number } | null
    }
    if (!d.status) throw new Error('任务状态响应异常')
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
      error: d.error_message || d.error ? sanitizeErrorMessage(d.error_message || d.error || '') : undefined,
      seed: d.seed,
      queueAhead: d.queue_ahead ?? null,
      progress
    }
  } catch (err) {
    if (err instanceof Error && /密钥|参数|任务|服务/.test(err.message)) throw err
    throw new Error(mapNetworkError(err))
  }
}

export async function fetchTaskBlob(opts: {
  apiKey: string
  timeoutMs: number
  taskId: string
  index?: number
}): Promise<{ blob: Blob; contentType: string }> {
  const index = opts.index ?? 0
  const url = joinUrl(apiBase(), `/v1/tasks/${opts.taskId}/images/${index}`)
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
    const contentType = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0]
    const blob = await res.blob()
    if (blob.size < 32) throw new Error('媒体数据过小，可能无效')
    return { blob, contentType }
  } catch (err) {
    if (err instanceof Error && /密钥|媒体|图片|视频/.test(err.message)) throw err
    throw new Error(mapNetworkError(err))
  }
}

export async function purgeTask(opts: {
  apiKey: string
  timeoutMs: number
  taskId: string
}): Promise<void> {
  const url = joinUrl(apiBase(), `/v1/tasks/${opts.taskId}/purge`)
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      timeoutMs: opts.timeoutMs,
      headers: authHeaders(opts.apiKey)
    })
    if (!res.ok) {
      const data = await parseJsonSafe(res)
      throw new Error(mapHttpError(res.status, data))
    }
  } catch {
    /* best-effort */
  }
}

export async function polishViaGateway(opts: {
  apiKey: string
  timeoutMs: number
  prompt: string
  negativePrompt?: string
  outputLanguage: string
  detail: string
  modelProfile: string
  generationMode?: string
}): Promise<{ enhanced_prompt: string; enhanced_negative_prompt?: string | null }> {
  const url = joinUrl(apiBase(), '/v1/prompt/polish')
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      timeoutMs: opts.timeoutMs,
      headers: authHeaders(opts.apiKey, true),
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
    return data as { enhanced_prompt: string; enhanced_negative_prompt?: string | null }
  } catch (err) {
    if (err instanceof Error && /密钥|次数|频繁|润色|超时/.test(err.message)) throw err
    throw new Error(mapNetworkError(err))
  }
}

export async function translateViaGateway(opts: {
  apiKey: string
  text: string
  direction?: 'en2zh' | 'zh2en'
}): Promise<string> {
  const direction = opts.direction ?? 'en2zh'
  const url = joinUrl(apiBase(), '/v1/prompt/translate')
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    timeoutMs: 90_000,
    headers: authHeaders(opts.apiKey, true),
    body: JSON.stringify({ text: opts.text, direction })
  })
  const data = await parseJsonSafe(res)
  if (!res.ok) throw new Error(mapHttpError(res.status, data))
  const d = data as { translation?: string }
  if (!d.translation) throw new Error('译文响应异常')
  return d.translation
}

export async function fetchGpuStatus(opts: {
  apiKey: string
}): Promise<{ ok: boolean; state: 'idle' | 'busy' | null; message: string }> {
  if (!opts.apiKey) return { ok: false, state: null, message: '未登录' }
  const url = joinUrl(apiBase(), '/v1/system/gpu')
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      timeoutMs: 12_000,
      headers: authHeaders(opts.apiKey)
    })
    const data = await parseJsonSafe(res)
    if (!res.ok) return { ok: false, state: null, message: mapHttpError(res.status, data) }
    const body = (data ?? {}) as { state?: string }
    const state = body.state === 'busy' || body.state === 'idle' ? body.state : null
    return {
      ok: state != null,
      state,
      message: state === 'busy' ? 'GPU 繁忙' : state === 'idle' ? 'GPU 空闲' : '状态未知'
    }
  } catch (err) {
    return { ok: false, state: null, message: mapNetworkError(err) }
  }
}

export type HostMetrics = {
  ok: boolean
  message: string
  gpu_name?: string | null
  gpu_temp_c?: number | null
  gpu_load_pct?: number | null
  gpu_mem_load_pct?: number | null
  gpu_mem_used_mb?: number | null
  gpu_mem_total_mb?: number | null
  gpu_power_w?: number | null
  cpu_temp_c?: number | null
  cpu_load_pct?: number | null
  cpu_power_w?: number | null
  ram_used_mb?: number | null
  ram_total_mb?: number | null
  ram_load_pct?: number | null
  total_power_w?: number | null
}

function formatMemPair(usedMb: number, totalMb: number): string {
  const used = usedMb >= 1024 ? `${(usedMb / 1024).toFixed(1)}G` : `${Math.round(usedMb)}M`
  const total = totalMb >= 1024 ? `${(totalMb / 1024).toFixed(0)}G` : `${Math.round(totalMb)}M`
  return `${used}/${total}`
}

export async function fetchHostMetrics(opts: {
  apiKey: string
}): Promise<HostMetrics> {
  if (!opts.apiKey) return { ok: false, message: '未登录' }
  const url = joinUrl(apiBase(), '/v1/system/host-metrics')
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      timeoutMs: 8_000,
      headers: authHeaders(opts.apiKey)
    })
    const data = await parseJsonSafe(res)
    if (!res.ok) return { ok: false, message: mapHttpError(res.status, data) }
    const body = (data ?? {}) as HostMetrics
    return {
      ok: Boolean(body.ok),
      message: body.message || (body.ok ? 'ok' : '无数据'),
      gpu_name: body.gpu_name,
      gpu_temp_c: body.gpu_temp_c,
      gpu_load_pct: body.gpu_load_pct,
      gpu_mem_load_pct: body.gpu_mem_load_pct,
      gpu_mem_used_mb: body.gpu_mem_used_mb,
      gpu_mem_total_mb: body.gpu_mem_total_mb,
      gpu_power_w: body.gpu_power_w,
      cpu_temp_c: body.cpu_temp_c,
      cpu_load_pct: body.cpu_load_pct,
      cpu_power_w: body.cpu_power_w,
      ram_used_mb: body.ram_used_mb,
      ram_total_mb: body.ram_total_mb,
      ram_load_pct: body.ram_load_pct,
      total_power_w: body.total_power_w
    }
  } catch (err) {
    return { ok: false, message: mapNetworkError(err) }
  }
}

/** Compact status chips for the Studio top bar (CPU / GPU / RAM / power). */
export function formatHostMetricsChips(m: HostMetrics): string[] {
  if (!m.ok) return []
  const chips: string[] = []

  const cpu: string[] = []
  if (m.cpu_load_pct != null) cpu.push(`${Math.round(m.cpu_load_pct)}%`)
  if (m.cpu_temp_c != null) cpu.push(`${Math.round(m.cpu_temp_c)}°C`)
  if (cpu.length) chips.push(`CPU ${cpu.join(' · ')}`)

  const gpu: string[] = []
  if (m.gpu_load_pct != null) gpu.push(`${Math.round(m.gpu_load_pct)}%`)
  if (m.gpu_temp_c != null) gpu.push(`${Math.round(m.gpu_temp_c)}°C`)
  if (m.gpu_mem_used_mb != null && m.gpu_mem_total_mb != null) {
    gpu.push(formatMemPair(m.gpu_mem_used_mb, m.gpu_mem_total_mb))
  } else if (m.gpu_mem_load_pct != null) {
    gpu.push(`显存 ${Math.round(m.gpu_mem_load_pct)}%`)
  }
  if (gpu.length) chips.push(`GPU ${gpu.join(' · ')}`)

  const ram: string[] = []
  if (m.ram_used_mb != null && m.ram_total_mb != null) {
    ram.push(formatMemPair(m.ram_used_mb, m.ram_total_mb))
  } else if (m.ram_load_pct != null) {
    ram.push(`${Math.round(m.ram_load_pct)}%`)
  }
  if (ram.length) chips.push(`内存 ${ram.join(' · ')}`)

  const powerW =
    m.total_power_w ??
    (m.cpu_power_w != null || m.gpu_power_w != null
      ? (m.cpu_power_w ?? 0) + (m.gpu_power_w ?? 0)
      : null)
  if (powerW != null && powerW > 0) {
    chips.push(`功耗 ${Math.round(powerW)}W`)
  }

  return chips
}

/** @deprecated Prefer formatHostMetricsChips */
export function formatHostMetricsChip(m: HostMetrics): string | null {
  const chips = formatHostMetricsChips(m)
  return chips.length ? chips.join(' · ') : null
}

export type ComfyControlAction = 'interrupt' | 'clear_queue' | 'free'

export type ComfyControlResult = {
  ok: boolean
  message: string
  action?: ComfyControlAction | string
  cooldownRemainingSeconds?: number
  cooldownUntil?: string | null
}

export type ComfyCooldownStatus = {
  cooldownSeconds: number
  serverTime?: string
  actions: Record<ComfyControlAction, { remainingSeconds: number; cooldownUntil: string | null }>
}

function parseComfyCooldownFields(data: unknown): Pick<
  ComfyControlResult,
  'action' | 'cooldownRemainingSeconds' | 'cooldownUntil'
> {
  if (!data || typeof data !== 'object') return {}
  const root = data as Record<string, unknown>
  const detail =
    root.detail && typeof root.detail === 'object'
      ? (root.detail as Record<string, unknown>)
      : root
  const rem = detail.cooldown_remaining_seconds
  return {
    action: typeof detail.action === 'string' ? detail.action : undefined,
    cooldownRemainingSeconds: typeof rem === 'number' ? rem : undefined,
    cooldownUntil: typeof detail.cooldown_until === 'string' ? detail.cooldown_until : null
  }
}

async function postComfyControl(
  path: string,
  opts: { apiKey: string; body?: Record<string, unknown> }
): Promise<ComfyControlResult> {
  if (!opts.apiKey) return { ok: false, message: '未登录' }
  const url = joinUrl(apiBase(), path)
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      timeoutMs: 30_000,
      headers: {
        ...authHeaders(opts.apiKey),
        'Content-Type': 'application/json'
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    })
    const data = await parseJsonSafe(res)
    const cd = parseComfyCooldownFields(data)
    if (!res.ok) {
      return {
        ok: false,
        message: mapHttpError(res.status, data),
        ...cd
      }
    }
    const body = (data ?? {}) as Record<string, unknown>
    return {
      ok: Boolean(body.ok ?? true),
      message: typeof body.message === 'string' ? body.message : 'ok',
      ...cd
    }
  } catch (err) {
    return { ok: false, message: mapNetworkError(err) }
  }
}

export async function fetchComfyCooldowns(opts: {
  apiKey: string
}): Promise<ComfyCooldownStatus | null> {
  if (!opts.apiKey) return null
  const url = joinUrl(apiBase(), '/v1/system/comfy/cooldowns')
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      timeoutMs: 10_000,
      headers: authHeaders(opts.apiKey)
    })
    const data = await parseJsonSafe(res)
    if (!res.ok || !data || typeof data !== 'object') return null
    const body = data as Record<string, unknown>
    const rawActions =
      body.actions && typeof body.actions === 'object'
        ? (body.actions as Record<string, Record<string, unknown>>)
        : {}
    const empty = { remainingSeconds: 0, cooldownUntil: null as string | null }
    const readOne = (key: ComfyControlAction) => {
      const a = rawActions[key]
      if (!a) return empty
      return {
        remainingSeconds:
          typeof a.remaining_seconds === 'number' ? Math.max(0, a.remaining_seconds) : 0,
        cooldownUntil: typeof a.cooldown_until === 'string' ? a.cooldown_until : null
      }
    }
    return {
      cooldownSeconds:
        typeof body.cooldown_seconds === 'number' ? body.cooldown_seconds : 90,
      serverTime: typeof body.server_time === 'string' ? body.server_time : undefined,
      actions: {
        interrupt: readOne('interrupt'),
        clear_queue: readOne('clear_queue'),
        free: readOne('free')
      }
    }
  } catch {
    return null
  }
}

export function comfyInterrupt(opts: { apiKey: string }) {
  return postComfyControl('/v1/system/comfy/interrupt', opts)
}

export function comfyClearQueue(opts: { apiKey: string }) {
  return postComfyControl('/v1/system/comfy/queue/clear', opts)
}

export function comfyFreeMemory(opts: {
  apiKey: string
  unloadModels?: boolean
  freeMemory?: boolean
}) {
  return postComfyControl('/v1/system/comfy/free', {
    apiKey: opts.apiKey,
    body: {
      unload_models: opts.unloadModels !== false,
      free_memory: opts.freeMemory !== false
    }
  })
}

export async function fetchPromptLibrary(opts: { apiKey: string }) {
  const url = joinUrl(apiBase(), '/v1/prompt-library')
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    timeoutMs: 60_000,
    headers: authHeaders(opts.apiKey)
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
    }>
    phrases: Array<{ id: string; text: string; category: string }>
  }
}

export async function listSharedPrompts(opts: { apiKey: string }) {
  const url = joinUrl(apiBase(), '/v1/prompt-library/shared')
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    timeoutMs: 60_000,
    headers: authHeaders(opts.apiKey)
  })
  const data = await parseJsonSafe(res)
  if (!res.ok) throw new Error(mapHttpError(res.status, data))
  return data as { items: SharedPrompt[]; count: number }
}

export async function sharePromptTemplate(opts: {
  apiKey: string
  title: string
  prompt: string
  negativePrompt?: string
  tags?: string[]
}) {
  const url = joinUrl(apiBase(), '/v1/prompt-library/shared')
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    timeoutMs: 60_000,
    headers: authHeaders(opts.apiKey, true),
    body: JSON.stringify({
      title: opts.title,
      prompt: opts.prompt,
      negative_prompt: opts.negativePrompt || '',
      tags: opts.tags || []
    })
  })
  const data = await parseJsonSafe(res)
  if (!res.ok) throw new Error(mapHttpError(res.status, data))
  return data as SharedPrompt
}

export async function deleteSharedPrompt(opts: { apiKey: string; itemId: string }) {
  const url = joinUrl(apiBase(), `/v1/prompt-library/shared/${opts.itemId}`)
  const res = await fetchWithTimeout(url, {
    method: 'DELETE',
    timeoutMs: 60_000,
    headers: authHeaders(opts.apiKey)
  })
  if (!res.ok) {
    const data = await parseJsonSafe(res)
    throw new Error(mapHttpError(res.status, data))
  }
}

export async function listShowcase(opts: { apiKey: string; limit?: number }) {
  const q = opts.limit != null ? `?limit=${opts.limit}` : ''
  const url = joinUrl(apiBase(), `/v1/showcase${q}`)
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    timeoutMs: 60_000,
    headers: authHeaders(opts.apiKey)
  })
  const data = await parseJsonSafe(res)
  if (!res.ok) throw new Error(mapHttpError(res.status, data))
  return data as { items: ShowcaseItem[]; count: number }
}

export async function fetchAuthedBlob(opts: {
  apiKey: string
  path: string
  timeoutMs?: number
}): Promise<Blob> {
  const path = opts.path.startsWith('/') ? opts.path : `/${opts.path}`
  const url = joinUrl(apiBase(), path)
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    timeoutMs: opts.timeoutMs ?? 120_000,
    headers: { 'X-API-Key': opts.apiKey }
  })
  if (!res.ok) {
    const data = await parseJsonSafe(res)
    throw new Error(mapHttpError(res.status, data))
  }
  return res.blob()
}

export async function shareToShowcase(opts: {
  apiKey: string
  prompt: string
  negativePrompt?: string
  mode: string
  width: number
  height: number
  steps: number
  seed?: number | null
  image: Blob
  filename?: string
}): Promise<ShowcaseItem> {
  const url = joinUrl(apiBase(), '/v1/showcase')
  const form = new FormData()
  form.set('prompt', opts.prompt)
  form.set('negative_prompt', opts.negativePrompt || '')
  form.set('mode', opts.mode || 'txt2img')
  form.set('width', String(opts.width))
  form.set('height', String(opts.height))
  form.set('steps', String(opts.steps))
  if (opts.seed != null) form.set('seed', String(opts.seed))
  form.set('image', opts.image, opts.filename || 'result.png')
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    timeoutMs: 120_000,
    headers: { Accept: 'application/json', 'X-API-Key': opts.apiKey },
    body: form
  })
  const data = await parseJsonSafe(res)
  if (!res.ok) throw new Error(mapHttpError(res.status, data))
  return data as ShowcaseItem
}

export async function unlistShowcase(opts: { apiKey: string; itemId: string }) {
  const url = joinUrl(apiBase(), `/v1/showcase/${opts.itemId}/unlist`)
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    timeoutMs: 60_000,
    headers: authHeaders(opts.apiKey)
  })
  if (!res.ok) {
    const data = await parseJsonSafe(res)
    throw new Error(mapHttpError(res.status, data))
  }
}

export async function toggleShowcaseLike(opts: { apiKey: string; itemId: string }) {
  const url = joinUrl(apiBase(), `/v1/showcase/${opts.itemId}/like`)
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    timeoutMs: 60_000,
    headers: authHeaders(opts.apiKey)
  })
  const data = await parseJsonSafe(res)
  if (!res.ok) throw new Error(mapHttpError(res.status, data))
  return data as import('./types').ShowcaseEngagement
}

export async function toggleShowcaseFavorite(opts: { apiKey: string; itemId: string }) {
  const url = joinUrl(apiBase(), `/v1/showcase/${opts.itemId}/favorite`)
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    timeoutMs: 60_000,
    headers: authHeaders(opts.apiKey)
  })
  const data = await parseJsonSafe(res)
  if (!res.ok) throw new Error(mapHttpError(res.status, data))
  return data as import('./types').ShowcaseEngagement
}

export async function listShowcaseComments(opts: {
  apiKey: string
  itemId: string
  limit?: number
}) {
  const q = opts.limit != null ? `?limit=${opts.limit}` : ''
  const url = joinUrl(apiBase(), `/v1/showcase/${opts.itemId}/comments${q}`)
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    timeoutMs: 60_000,
    headers: authHeaders(opts.apiKey)
  })
  const data = await parseJsonSafe(res)
  if (!res.ok) throw new Error(mapHttpError(res.status, data))
  return data as { items: import('./types').ShowcaseComment[]; count: number }
}

export async function addShowcaseComment(opts: {
  apiKey: string
  itemId: string
  body: string
}) {
  const url = joinUrl(apiBase(), `/v1/showcase/${opts.itemId}/comments`)
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    timeoutMs: 60_000,
    headers: authHeaders(opts.apiKey, true),
    body: JSON.stringify({ body: opts.body })
  })
  const data = await parseJsonSafe(res)
  if (!res.ok) throw new Error(mapHttpError(res.status, data))
  return data as import('./types').ShowcaseComment
}

export async function deleteShowcaseComment(opts: {
  apiKey: string
  itemId: string
  commentId: string
}) {
  const url = joinUrl(
    apiBase(),
    `/v1/showcase/${opts.itemId}/comments/${opts.commentId}`
  )
  const res = await fetchWithTimeout(url, {
    method: 'DELETE',
    timeoutMs: 60_000,
    headers: authHeaders(opts.apiKey)
  })
  if (!res.ok) {
    const data = await parseJsonSafe(res)
    throw new Error(mapHttpError(res.status, data))
  }
}

export async function listCloudGallery(opts: {
  apiKey: string
  limit?: number
}): Promise<{ items: import('./types').CloudGalleryItem[]; count: number }> {
  const q = opts.limit != null ? `?limit=${opts.limit}` : ''
  const url = joinUrl(apiBase(), `/v1/cloud-gallery${q}`)
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    timeoutMs: 60_000,
    headers: authHeaders(opts.apiKey)
  })
  const data = await parseJsonSafe(res)
  if (!res.ok) throw new Error(mapHttpError(res.status, data))
  return data as { items: import('./types').CloudGalleryItem[]; count: number }
}

export async function createWorkRecord(opts: {
  apiKey: string
  prompt: string
  negativePrompt?: string
  mode: string
  width: number
  height: number
  steps: number
  seed?: number | null
  remoteTaskId?: string
  cloudGalleryId?: string
  mimeType?: string
}): Promise<{ id: string }> {
  const url = joinUrl(apiBase(), '/v1/works')
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    timeoutMs: 60_000,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-API-Key': opts.apiKey
    },
    body: JSON.stringify({
      prompt: opts.prompt,
      negative_prompt: opts.negativePrompt || null,
      mode: opts.mode || 'txt2img',
      width: opts.width,
      height: opts.height,
      steps: opts.steps,
      seed: opts.seed ?? null,
      remote_task_id: opts.remoteTaskId || null,
      cloud_gallery_id: opts.cloudGalleryId || null,
      mime_type: opts.mimeType || null
    })
  })
  const data = await parseJsonSafe(res)
  if (!res.ok) throw new Error(mapHttpError(res.status, data))
  return data as { id: string }
}

export async function uploadCloudGallery(opts: {
  apiKey: string
  prompt: string
  negativePrompt?: string
  mode: string
  width: number
  height: number
  steps: number
  seed?: number | null
  image: Blob
  filename?: string
}): Promise<import('./types').CloudGalleryItem> {
  const url = joinUrl(apiBase(), '/v1/cloud-gallery')
  const form = new FormData()
  form.set('prompt', opts.prompt)
  form.set('negative_prompt', opts.negativePrompt || '')
  form.set('mode', opts.mode || 'txt2img')
  form.set('width', String(opts.width))
  form.set('height', String(opts.height))
  form.set('steps', String(opts.steps))
  if (opts.seed != null) form.set('seed', String(opts.seed))
  const name =
    opts.filename ||
    (opts.image.type.includes('video') ? 'result.mp4' : 'result.png')
  form.set('image', opts.image, name)
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    timeoutMs: 180_000,
    headers: { Accept: 'application/json', 'X-API-Key': opts.apiKey },
    body: form
  })
  const data = await parseJsonSafe(res)
  if (!res.ok) throw new Error(mapHttpError(res.status, data))
  return data as import('./types').CloudGalleryItem
}

export async function deleteCloudGallery(opts: { apiKey: string; itemId: string }) {
  const url = joinUrl(apiBase(), `/v1/cloud-gallery/${opts.itemId}`)
  const res = await fetchWithTimeout(url, {
    method: 'DELETE',
    timeoutMs: 60_000,
    headers: authHeaders(opts.apiKey)
  })
  if (!res.ok && res.status !== 204) {
    const data = await parseJsonSafe(res)
    throw new Error(mapHttpError(res.status, data))
  }
}
