import { safeStorage } from 'electron'

export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function encryptSecret(plain: string): { encrypted: string; method: 'safeStorage' | 'plain' } {
  if (isEncryptionAvailable()) {
    const buf = safeStorage.encryptString(plain)
    return { encrypted: buf.toString('base64'), method: 'safeStorage' }
  }
  return { encrypted: Buffer.from(plain, 'utf8').toString('base64'), method: 'plain' }
}

export function decryptSecret(encrypted: string, method: 'safeStorage' | 'plain'): string {
  if (method === 'safeStorage' && isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  }
  return Buffer.from(encrypted, 'base64').toString('utf8')
}
