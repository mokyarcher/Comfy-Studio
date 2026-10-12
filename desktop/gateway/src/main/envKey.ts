import { randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { redactSecrets } from '../shared/redact'

export function envFilePath(apiProjectDir: string): string {
  return join(apiProjectDir, '.env')
}

export function readApiKeyFromEnv(apiProjectDir: string): string {
  if (!apiProjectDir || !existsSync(envFilePath(apiProjectDir))) return ''
  const text = readFileSync(envFilePath(apiProjectDir), 'utf-8')
  const match = text.match(/^\s*API_KEY\s*=\s*(.*)$/m)
  if (!match) return ''
  let value = match[1].trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }
  return value
}

export function writeApiKeyToEnv(apiProjectDir: string, apiKey: string): void {
  if (!apiProjectDir) throw new Error('未配置 API 项目目录')
  const path = envFilePath(apiProjectDir)
  let text = existsSync(path) ? readFileSync(path, 'utf-8') : ''
  if (/^\s*API_KEY\s*=/m.test(text)) {
    text = text.replace(/^\s*API_KEY\s*=.*$/m, `API_KEY=${apiKey}`)
  } else {
    if (text && !text.endsWith('\n')) text += '\n'
    text += `API_KEY=${apiKey}\n`
  }
  writeFileSync(path, text, 'utf-8')
}

export function generateApiKey(bytes = 24): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  const buf = randomBytes(bytes)
  for (let i = 0; i < bytes; i++) {
    out += alphabet[buf[i] % alphabet.length]
  }
  return out
}

export function safeLogEnvSnippet(apiProjectDir: string): string {
  if (!apiProjectDir || !existsSync(envFilePath(apiProjectDir))) return ''
  return redactSecrets(readFileSync(envFilePath(apiProjectDir), 'utf-8').slice(0, 400))
}
