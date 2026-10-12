import type { GatewayConfig } from '../shared/types'

export interface AdminStats {
  queue_open: number
  queue_queued: number
  queue_running: number
  max_queue_size: number
  generate_today: number
  polish_today: number
  active_users_15m: number
  users_total: number
  users_enabled: number
  polish_enabled: boolean
  pending_users?: number
  pool_remaining?: number
  max_approved_users?: number
  approved_users?: number
  local_hold?: boolean
  local_hold_expires_at?: string | null
}

export interface LocalHoldState {
  held: boolean
  message: string
  expires_at?: string | null
  updated_at?: string | null
}

export interface AdminUser {
  id: string
  name: string
  username?: string
  status?: string
  api_key_prefix: string
  enabled: boolean
  is_admin: boolean
  daily_generate_limit: number
  daily_polish_limit: number
  generate_today: number
  polish_today: number
  note: string
  created_at: string
  last_seen_at?: string | null
  api_key?: string | null
}

async function fetchJson(
  url: string,
  apiKey: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        ...(init?.headers || {})
      }
    })
    const text = await res.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = { detail: text.slice(0, 200) }
    }
    return { ok: res.ok, status: res.status, data }
  } finally {
    clearTimeout(timer)
  }
}

function localBase(cfg: GatewayConfig): string {
  return `http://${cfg.apiHost}:${cfg.apiPort}`
}

function failDetail(status: number, data: unknown): string {
  if (typeof data === 'object' && data && 'detail' in data) {
    const d = (data as { detail: unknown }).detail
    if (typeof d === 'string') return d
  }
  return ''
}

export async function adminGetStats(
  cfg: GatewayConfig,
  apiKey: string
): Promise<{ ok: boolean; message: string; stats?: AdminStats }> {
  if (!apiKey) return { ok: false, message: '本地 API Key 为空，请先在「访问密钥」配置' }
  const url = `${localBase(cfg)}/v1/admin/stats`
  try {
    const res = await fetchJson(url, apiKey)
    if (!res.ok) {
      const detail = failDetail(res.status, res.data)
      if (res.status === 404) {
        return {
          ok: false,
          message:
            '统计接口不存在（HTTP 404）。当前跑的还是旧版 API，请在「服务管理」停止后重新启动 API，确保项目目录指向含 /v1/admin 的最新代码。'
        }
      }
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          message:
            detail ||
            '无管理员权限。请把「访问密钥」改成管理员 Key（首次启动会把 .env 的 API_KEY 导入为管理员），改完后重启 API。'
        }
      }
      return {
        ok: false,
        message: detail
          ? `统计接口失败 HTTP ${res.status}：${detail}`
          : `统计接口失败 HTTP ${res.status}（${url}）`
      }
    }
    return { ok: true, message: 'ok', stats: res.data as AdminStats }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/abort|timeout/i.test(msg)) {
      return { ok: false, message: '连接本地 API 超时，请先在「服务管理」启动 API' }
    }
    if (/fetch|ECONNREFUSED|Failed to fetch|network/i.test(msg)) {
      return { ok: false, message: '无法连接本地 API，请先在「服务管理」启动 API' }
    }
    return { ok: false, message: `无法连接本地 API：${msg}` }
  }
}

export async function adminListUsers(
  cfg: GatewayConfig,
  apiKey: string
): Promise<{ ok: boolean; message: string; users?: AdminUser[] }> {
  if (!apiKey) return { ok: false, message: '本地 API Key 为空' }
  try {
    const res = await fetchJson(`${localBase(cfg)}/v1/admin/users`, apiKey)
    if (!res.ok) return { ok: false, message: `用户列表失败 HTTP ${res.status}` }
    return { ok: true, message: 'ok', users: res.data as AdminUser[] }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '请求失败' }
  }
}

export async function adminApproveUser(
  cfg: GatewayConfig,
  apiKey: string,
  userId: string
): Promise<{ ok: boolean; message: string; user?: AdminUser }> {
  try {
    const res = await fetchJson(
      `${localBase(cfg)}/v1/admin/users/${userId}/approve`,
      apiKey,
      { method: 'POST' }
    )
    if (!res.ok) {
      return { ok: false, message: failDetail(res.status, res.data) || `批准失败 HTTP ${res.status}` }
    }
    return { ok: true, message: '已批准并分配 API Key', user: res.data as AdminUser }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '批准失败' }
  }
}

export async function adminRejectUser(
  cfg: GatewayConfig,
  apiKey: string,
  userId: string
): Promise<{ ok: boolean; message: string; user?: AdminUser }> {
  try {
    const res = await fetchJson(
      `${localBase(cfg)}/v1/admin/users/${userId}/reject`,
      apiKey,
      { method: 'POST' }
    )
    if (!res.ok) {
      return { ok: false, message: failDetail(res.status, res.data) || `拒绝失败 HTTP ${res.status}` }
    }
    return { ok: true, message: '已拒绝', user: res.data as AdminUser }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '拒绝失败' }
  }
}

export async function adminPatchUser(
  cfg: GatewayConfig,
  apiKey: string,
  userId: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; message: string; user?: AdminUser }> {
  try {
    const res = await fetchJson(`${localBase(cfg)}/v1/admin/users/${userId}`, apiKey, {
      method: 'PATCH',
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      return { ok: false, message: failDetail(res.status, res.data) || `更新失败 HTTP ${res.status}` }
    }
    return { ok: true, message: '已更新', user: res.data as AdminUser }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '更新失败' }
  }
}

export async function adminRotateKey(
  cfg: GatewayConfig,
  apiKey: string,
  userId: string
): Promise<{ ok: boolean; message: string; user?: AdminUser }> {
  try {
    const res = await fetchJson(
      `${localBase(cfg)}/v1/admin/users/${userId}/rotate-key`,
      apiKey,
      { method: 'POST' }
    )
    if (!res.ok) {
      return { ok: false, message: failDetail(res.status, res.data) || `轮换失败 HTTP ${res.status}` }
    }
    return { ok: true, message: '已轮换 Key（用户需重新登录）', user: res.data as AdminUser }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '轮换失败' }
  }
}

export async function adminResetPassword(
  cfg: GatewayConfig,
  apiKey: string,
  userId: string
): Promise<{
  ok: boolean
  message: string
  temporaryPassword?: string
  username?: string
}> {
  try {
    const res = await fetchJson(
      `${localBase(cfg)}/v1/admin/users/${userId}/reset-password`,
      apiKey,
      { method: 'POST', body: JSON.stringify({}) }
    )
    if (!res.ok) {
      return {
        ok: false,
        message: failDetail(res.status, res.data) || `重置密码失败 HTTP ${res.status}`
      }
    }
    const d = res.data as {
      temporary_password?: string
      username?: string
      message?: string
    }
    return {
      ok: true,
      message: d.message || '已重置密码',
      temporaryPassword: d.temporary_password,
      username: d.username
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '重置密码失败' }
  }
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
  thumb_url?: string
  ref_urls: string[]
  mine?: boolean
}

export async function listShowcase(
  cfg: GatewayConfig,
  apiKey: string,
  limit = 80
): Promise<{ ok: boolean; message: string; items?: ShowcaseItem[]; count?: number }> {
  if (!apiKey) return { ok: false, message: '本地 API Key 为空' }
  try {
    const res = await fetchJson(
      `${localBase(cfg)}/v1/showcase?limit=${limit}`,
      apiKey
    )
    if (!res.ok) {
      return {
        ok: false,
        message: failDetail(res.status, res.data) || `展馆列表失败 HTTP ${res.status}`
      }
    }
    const d = res.data as { items?: ShowcaseItem[]; count?: number }
    return { ok: true, message: 'ok', items: d.items ?? [], count: d.count ?? 0 }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '展馆列表失败' }
  }
}

export async function adminGetLocalHold(
  cfg: GatewayConfig,
  apiKey: string
): Promise<{ ok: boolean; message: string; hold?: LocalHoldState }> {
  if (!apiKey) return { ok: false, message: '本地 API Key 为空，请先在「访问密钥」配置' }
  try {
    const res = await fetchJson(`${localBase(cfg)}/v1/admin/local-hold`, apiKey)
    if (!res.ok) {
      const detail = failDetail(res.status, res.data)
      if (res.status === 404) {
        return {
          ok: false,
          message: '占用开关接口不存在（HTTP 404）。请重启本地 API 以加载最新代码。'
        }
      }
      return {
        ok: false,
        message: detail || `读取占用状态失败 HTTP ${res.status}`
      }
    }
    return { ok: true, message: 'ok', hold: res.data as LocalHoldState }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/abort|timeout/i.test(msg)) {
      return { ok: false, message: '连接本地 API 超时，请先启动 API' }
    }
    return { ok: false, message: `无法连接本地 API：${msg}` }
  }
}

export async function adminSetLocalHold(
  cfg: GatewayConfig,
  apiKey: string,
  body: { held: boolean; ttl_seconds?: number | null; message?: string | null }
): Promise<{ ok: boolean; message: string; hold?: LocalHoldState }> {
  if (!apiKey) return { ok: false, message: '本地 API Key 为空，请先在「访问密钥」配置' }
  try {
    const payload: Record<string, unknown> = { held: body.held }
    if (body.held && body.ttl_seconds != null) payload.ttl_seconds = body.ttl_seconds
    if (body.held && body.message) payload.message = body.message
    const res = await fetchJson(`${localBase(cfg)}/v1/admin/local-hold`, apiKey, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
    if (!res.ok) {
      return {
        ok: false,
        message: failDetail(res.status, res.data) || `设置占用失败 HTTP ${res.status}`
      }
    }
    const hold = res.data as LocalHoldState
    return {
      ok: true,
      message: hold.held ? '已开启本机占用，远端生图将被拒绝' : '已解除本机占用',
      hold
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '设置占用失败' }
  }
}

export async function adminUnlistShowcase(
  cfg: GatewayConfig,
  apiKey: string,
  itemId: string
): Promise<{ ok: boolean; message: string; item?: ShowcaseItem }> {
  if (!apiKey) return { ok: false, message: '本地 API Key 为空' }
  try {
    const res = await fetchJson(
      `${localBase(cfg)}/v1/admin/showcase/${itemId}/unlist`,
      apiKey,
      { method: 'POST' }
    )
    if (!res.ok) {
      return {
        ok: false,
        message: failDetail(res.status, res.data) || `下架失败 HTTP ${res.status}`
      }
    }
    return { ok: true, message: '已强制下架', item: res.data as ShowcaseItem }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '下架失败' }
  }
}

export async function fetchShowcaseAssetDataUrl(
  cfg: GatewayConfig,
  apiKey: string,
  path: string
): Promise<{ ok: boolean; message: string; dataUrl?: string }> {
  if (!apiKey) return { ok: false, message: '本地 API Key 为空' }
  const clean = path.startsWith('/') ? path : `/${path}`
  const url = `${localBase(cfg)}${clean}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'X-API-Key': apiKey }
    })
    if (!res.ok) {
      return { ok: false, message: `图片加载失败 HTTP ${res.status}` }
    }
    const ab = await res.arrayBuffer()
    const buf = Buffer.from(ab)
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    const mime = ct.startsWith('image/')
      ? ct.split(';')[0]
      : buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8
        ? 'image/jpeg'
        : 'image/png'
    return {
      ok: true,
      message: 'ok',
      dataUrl: `data:${mime};base64,${buf.toString('base64')}`
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '图片加载失败' }
  } finally {
    clearTimeout(timer)
  }
}

export interface PromptLibraryTemplate {
  id: string
  title: string
  prompt: string
  negative_prompt?: string
  tags?: string[]
  created_at?: string
  updated_at?: string
}

export interface PromptLibraryPhrase {
  id: string
  text: string
  category: string
}

export interface PromptLibraryDoc {
  version: number
  updated_at: string
  templates: PromptLibraryTemplate[]
  phrases: PromptLibraryPhrase[]
}

export async function adminGetPromptLibrary(
  cfg: GatewayConfig,
  apiKey: string
): Promise<{ ok: boolean; message: string; library?: PromptLibraryDoc }> {
  if (!apiKey) return { ok: false, message: '本地 API Key 为空，请先在「访问密钥」配置' }
  try {
    const res = await fetchJson(`${localBase(cfg)}/v1/admin/prompt-library`, apiKey)
    if (!res.ok) {
      const detail = failDetail(res.status, res.data)
      if (res.status === 404) {
        return {
          ok: false,
          message: '提示词库接口不存在（HTTP 404）。请重启本地 API 以加载最新代码。'
        }
      }
      return { ok: false, message: detail || `读取提示词库失败 HTTP ${res.status}` }
    }
    return { ok: true, message: 'ok', library: res.data as PromptLibraryDoc }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '读取提示词库失败' }
  }
}

export async function adminReplacePromptLibrary(
  cfg: GatewayConfig,
  apiKey: string,
  body: { templates: PromptLibraryTemplate[]; phrases: PromptLibraryPhrase[] }
): Promise<{ ok: boolean; message: string; library?: PromptLibraryDoc }> {
  if (!apiKey) return { ok: false, message: '本地 API Key 为空，请先在「访问密钥」配置' }
  try {
    const res = await fetchJson(`${localBase(cfg)}/v1/admin/prompt-library`, apiKey, {
      method: 'PUT',
      body: JSON.stringify({
        templates: body.templates,
        phrases: body.phrases
      })
    })
    if (!res.ok) {
      return {
        ok: false,
        message: failDetail(res.status, res.data) || `保存提示词库失败 HTTP ${res.status}`
      }
    }
    return {
      ok: true,
      message: '官方提示词库已发布',
      library: res.data as PromptLibraryDoc
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '保存提示词库失败' }
  }
}
