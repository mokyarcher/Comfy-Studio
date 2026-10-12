import { randomUUID } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import type { ApiProfile, ApiProfileInput } from '../../shared/types'
import { maskApiKey } from '../../shared/url'
import { decryptSecret, encryptSecret, isEncryptionAvailable } from './crypto'
import { profilesPath } from './paths'

interface StoredProfile {
  id: string
  name: string
  baseUrl: string
  apiKeyEnc: string
  apiKeyMethod: 'safeStorage' | 'plain'
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

interface ProfilesFile {
  version: 1
  encryptionWarning?: boolean
  profiles: StoredProfile[]
}

function readFile(): ProfilesFile {
  const p = profilesPath()
  if (!existsSync(p)) {
    return { version: 1, profiles: [] }
  }
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as ProfilesFile
  } catch {
    return { version: 1, profiles: [] }
  }
}

function writeFile(data: ProfilesFile): void {
  writeFileSync(profilesPath(), JSON.stringify(data, null, 2), 'utf8')
}

function toPublic(p: StoredProfile): ApiProfile {
  let key = ''
  try {
    key = decryptSecret(p.apiKeyEnc, p.apiKeyMethod)
  } catch {
    key = ''
  }
  return {
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    apiKeyMasked: maskApiKey(key),
    hasApiKey: Boolean(key),
    username: p.username,
    healthPath: p.healthPath,
    timeoutMs: p.timeoutMs,
    isDefault: p.isDefault,
    lastTestAt: p.lastTestAt,
    lastTestOk: p.lastTestOk,
    lastTestLatencyMs: p.lastTestLatencyMs,
    lastTestMessage: p.lastTestMessage,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt
  }
}

export function listProfiles(): { profiles: ApiProfile[]; encryptionAvailable: boolean; encryptionWarning: boolean } {
  const data = readFile()
  return {
    profiles: data.profiles.map(toPublic),
    encryptionAvailable: isEncryptionAvailable(),
    encryptionWarning: data.encryptionWarning === true || !isEncryptionAvailable()
  }
}

export function getDefaultProfile(): StoredProfile | undefined {
  const data = readFile()
  return data.profiles.find((p) => p.isDefault) ?? data.profiles[0]
}

export function getProfileSecret(id: string): { profile: StoredProfile; apiKey: string } | null {
  const data = readFile()
  const profile = data.profiles.find((p) => p.id === id)
  if (!profile) return null
  try {
    return { profile, apiKey: decryptSecret(profile.apiKeyEnc, profile.apiKeyMethod) }
  } catch {
    return { profile, apiKey: '' }
  }
}

export function saveProfile(input: ApiProfileInput): ApiProfile {
  const data = readFile()
  const now = new Date().toISOString()
  const existing = input.id ? data.profiles.find((p) => p.id === input.id) : undefined

  if (!existing && !input.apiKey) {
    throw new Error('新建连接配置必须提供 API Key')
  }

  let apiKeyEnc = existing?.apiKeyEnc ?? ''
  let apiKeyMethod = existing?.apiKeyMethod ?? ('plain' as const)

  if (input.apiKey && input.apiKey.trim()) {
    const enc = encryptSecret(input.apiKey.trim())
    apiKeyEnc = enc.encrypted
    apiKeyMethod = enc.method
    if (enc.method === 'plain') {
      data.encryptionWarning = true
    }
  }

  if (input.setDefault || data.profiles.length === 0) {
    for (const p of data.profiles) p.isDefault = false
  }

  if (existing) {
    existing.name = input.name.trim()
    existing.baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
    existing.healthPath = input.healthPath?.trim() || '/health/ready'
    existing.timeoutMs = input.timeoutMs ?? existing.timeoutMs
    existing.apiKeyEnc = apiKeyEnc
    existing.apiKeyMethod = apiKeyMethod
    if (input.username !== undefined) existing.username = input.username
    existing.updatedAt = now
    if (input.setDefault) existing.isDefault = true
    writeFile(data)
    return toPublic(existing)
  }

  const created: StoredProfile = {
    id: randomUUID(),
    name: input.name.trim(),
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ''),
    apiKeyEnc,
    apiKeyMethod,
    username: input.username,
    healthPath: input.healthPath?.trim() || '/health/ready',
    timeoutMs: input.timeoutMs ?? 900_000,
    isDefault: input.setDefault !== false || data.profiles.length === 0,
    createdAt: now,
    updatedAt: now
  }
  data.profiles.push(created)
  writeFile(data)
  return toPublic(created)
}

export function deleteProfile(id: string): void {
  const data = readFile()
  const idx = data.profiles.findIndex((p) => p.id === id)
  if (idx < 0) return
  const wasDefault = data.profiles[idx].isDefault
  data.profiles.splice(idx, 1)
  if (wasDefault && data.profiles.length > 0) {
    data.profiles[0].isDefault = true
  }
  writeFile(data)
}

/** Clear all saved API sessions (logout). */
export function clearAllProfiles(): void {
  writeFile({ version: 1, profiles: [] })
}

export function setDefaultProfile(id: string): ApiProfile {
  const data = readFile()
  const target = data.profiles.find((p) => p.id === id)
  if (!target) throw new Error('配置不存在')
  for (const p of data.profiles) p.isDefault = p.id === id
  target.updatedAt = new Date().toISOString()
  writeFile(data)
  return toPublic(target)
}

export function updateProfileTestResult(
  id: string,
  result: { ok: boolean; latencyMs: number; message: string }
): void {
  const data = readFile()
  const p = data.profiles.find((x) => x.id === id)
  if (!p) return
  p.lastTestAt = new Date().toISOString()
  p.lastTestOk = result.ok
  p.lastTestLatencyMs = result.latencyMs
  p.lastTestMessage = result.message
  p.updatedAt = p.lastTestAt
  writeFile(data)
}
