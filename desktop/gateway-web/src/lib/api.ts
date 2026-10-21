const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || ''

function joinUrl(base: string, path: string): string {
  if (!base) return path
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
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

function errMessage(status: number, data: unknown): string {
  if (data && typeof data === 'object') {
    const d = data as { detail?: unknown; message?: string }
    if (typeof d.detail === 'string') return d.detail
    if (typeof d.message === 'string') return d.message
    if (Array.isArray(d.detail) && d.detail[0]?.msg) return String(d.detail[0].msg)
  }
  return `请求失败 (${status})`
}

async function api<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(joinUrl(API_BASE, path), {
    credentials: 'include',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {})
    }
  })
  const data = await parseJsonSafe(res)
  if (!res.ok) throw new Error(errMessage(res.status, data))
  return data as T
}

export type AuthMe = {
  ok: boolean
  role: string
  phone_masked: string
  username: string
  via: string
}

export type AdminStats = {
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
  pending_users: number
  pool_remaining: number
  max_approved_users: number
  approved_users: number
  local_hold: boolean
  local_hold_expires_at?: string | null
}

export type LocalHold = {
  held: boolean
  message: string
  expires_at?: string | null
  updated_at?: string | null
}

export type AdminUser = {
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

export function adminLogin(password: string, totpCode: string) {
  return api<{ ok: boolean; message: string; via: string }>('/v1/auth/admin/login', {
    method: 'POST',
    body: JSON.stringify({ password, totp_code: totpCode })
  })
}

export function logoutSms() {
  return api<{ ok: boolean }>('/v1/auth/admin/logout', { method: 'POST' })
}

export function fetchMe() {
  return api<AuthMe>('/v1/auth/me')
}

export function fetchStats() {
  return api<AdminStats>('/v1/admin/stats')
}

export function fetchLocalHold() {
  return api<LocalHold>('/v1/admin/local-hold')
}

export function setLocalHold(held: boolean, ttlSeconds?: number | null) {
  return api<LocalHold>('/v1/admin/local-hold', {
    method: 'POST',
    body: JSON.stringify({
      held,
      ttl_seconds: ttlSeconds ?? null,
      message: held ? '管理员占用中' : ''
    })
  })
}

export function listUsers() {
  return api<AdminUser[]>('/v1/admin/users')
}

export function approveUser(userId: string) {
  return api<AdminUser>(`/v1/admin/users/${userId}/approve`, { method: 'POST' })
}

export function rejectUser(userId: string) {
  return api<AdminUser>(`/v1/admin/users/${userId}/reject`, { method: 'POST' })
}

export function deleteUser(userId: string) {
  return api<{
    ok: boolean
    id: string
    username: string
    message: string
    cloud_gallery_deleted: number
    showcase_deleted: number
    shared_prompts_deleted: number
  }>(`/v1/admin/users/${userId}`, { method: 'DELETE' })
}

export function patchUser(userId: string, body: { enabled?: boolean; note?: string }) {
  return api<AdminUser>(`/v1/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(body)
  })
}

export function resetPassword(userId: string) {
  return api<{ temporary_password: string; message: string }>(
    `/v1/admin/users/${userId}/reset-password`,
    { method: 'POST', body: JSON.stringify({}) }
  )
}

export type HostServiceItem = {
  id: string
  label: string
  ok: boolean
  state: string
  message: string
  pid?: number | null
  configured: boolean
  detail: string
}

export type HostServicesResponse = {
  enabled: boolean
  services: HostServiceItem[]
  step_up_remaining_seconds?: number
}

export type HostServiceAction = 'start' | 'stop' | 'force_stop' | 'restart'

export type HostServiceActionResult = {
  ok: boolean
  message: string
  services: HostServiceItem[]
  step_up_remaining_seconds?: number
}

export function fetchHostServices() {
  return api<HostServicesResponse>('/v1/admin/host-services')
}

export function hostServiceAction(
  service: 'comfy' | 'api' | 'frp' | 'lhm',
  action: HostServiceAction,
  totpCode = ''
) {
  return api<HostServiceActionResult>('/v1/admin/host-services/action', {
    method: 'POST',
    body: JSON.stringify({ service, action, totp_code: totpCode.trim() })
  })
}
