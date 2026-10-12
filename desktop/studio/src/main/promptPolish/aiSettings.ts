import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { maskApiKey } from '../../shared/url'
import type { AiPolishSettingsPublic } from '../../shared/prompt-polish/types'
import { decryptSecret, encryptSecret, isEncryptionAvailable } from '../store/crypto'
import { getUserDataRoot } from '../store/paths'

interface StoredAiPolish {
  useGateway: boolean
  allowDirect: boolean
  enabled: boolean
  baseUrl: string
  model: string
  timeoutMs: number
  apiKeyEnc: string
  apiKeyMethod: 'safeStorage' | 'plain'
  lastTestAt?: string
  lastTestOk?: boolean
  lastTestMessage?: string
  gatewayMessage?: string
  gatewayConfigured?: boolean
  dailyRemaining?: number
}

const DEFAULT_STORED: StoredAiPolish = {
  useGateway: true,
  allowDirect: false,
  enabled: true,
  baseUrl: '',
  model: '',
  timeoutMs: 60_000,
  apiKeyEnc: '',
  apiKeyMethod: 'plain'
}

function filePath(): string {
  return join(getUserDataRoot(), 'ai-polish.json')
}

function readStored(): StoredAiPolish {
  const p = filePath()
  if (!existsSync(p)) return { ...DEFAULT_STORED }
  try {
    return { ...DEFAULT_STORED, ...(JSON.parse(readFileSync(p, 'utf8')) as Partial<StoredAiPolish>) }
  } catch {
    return { ...DEFAULT_STORED }
  }
}

function writeStored(data: StoredAiPolish): void {
  writeFileSync(filePath(), JSON.stringify(data, null, 2), 'utf8')
}

function toPublic(s: StoredAiPolish): AiPolishSettingsPublic {
  let key = ''
  if (s.apiKeyEnc) {
    try {
      key = decryptSecret(s.apiKeyEnc, s.apiKeyMethod)
    } catch {
      key = ''
    }
  }
  return {
    useGateway: s.useGateway !== false,
    allowDirect: s.allowDirect === true,
    enabled: s.enabled,
    baseUrl: s.baseUrl,
    model: s.model,
    timeoutMs: s.timeoutMs,
    hasApiKey: Boolean(key),
    apiKeyMasked: maskApiKey(key),
    lastTestAt: s.lastTestAt,
    lastTestOk: s.lastTestOk,
    lastTestMessage: s.lastTestMessage,
    gatewayMessage: s.gatewayMessage,
    gatewayConfigured: s.gatewayConfigured,
    dailyRemaining: s.dailyRemaining
  }
}

export function getAiPolishSettingsPublic(): AiPolishSettingsPublic {
  return toPublic(readStored())
}

export function getAiPolishSecret(): { settings: AiPolishSettingsPublic; apiKey: string } | null {
  const s = readStored()
  let key = ''
  if (s.apiKeyEnc) {
    try {
      key = decryptSecret(s.apiKeyEnc, s.apiKeyMethod)
    } catch {
      key = ''
    }
  }
  return { settings: toPublic(s), apiKey: key }
}

export function saveAiPolishSettings(input: {
  useGateway?: boolean
  allowDirect?: boolean
  enabled?: boolean
  baseUrl?: string
  model?: string
  timeoutMs?: number
  apiKey?: string
  gatewayMessage?: string
  gatewayConfigured?: boolean
  dailyRemaining?: number
}): AiPolishSettingsPublic {
  const cur = readStored()
  const next: StoredAiPolish = {
    ...cur,
    useGateway: input.useGateway ?? cur.useGateway,
    allowDirect: input.allowDirect ?? cur.allowDirect,
    enabled: input.enabled ?? cur.enabled,
    baseUrl: (input.baseUrl ?? cur.baseUrl).replace(/\/+$/, ''),
    model: input.model ?? cur.model,
    timeoutMs: input.timeoutMs ?? cur.timeoutMs,
    gatewayMessage: input.gatewayMessage ?? cur.gatewayMessage,
    gatewayConfigured: input.gatewayConfigured ?? cur.gatewayConfigured,
    dailyRemaining: input.dailyRemaining ?? cur.dailyRemaining
  }
  if (input.apiKey !== undefined) {
    if (input.apiKey === '') {
      next.apiKeyEnc = ''
      next.apiKeyMethod = 'plain'
    } else {
      const enc = encryptSecret(input.apiKey)
      next.apiKeyEnc = enc.encrypted
      next.apiKeyMethod = enc.method
    }
  }
  writeStored(next)
  return toPublic(next)
}

export function updateAiPolishTestResult(ok: boolean, message: string): AiPolishSettingsPublic {
  const cur = readStored()
  cur.lastTestAt = new Date().toISOString()
  cur.lastTestOk = ok
  cur.lastTestMessage = message
  writeStored(cur)
  return toPublic(cur)
}

export function encryptionStatus(): boolean {
  return isEncryptionAvailable()
}
