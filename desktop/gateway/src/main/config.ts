import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { GatewayConfigSchema, type GatewayConfig } from '../shared/types'

const CONFIG_VERSION = 1

interface StoredConfig {
  version: number
  data: GatewayConfig
}

function configPath(): string {
  return join(app.getPath('userData'), 'gateway-config.json')
}

export function defaultConfig(): GatewayConfig {
  return GatewayConfigSchema.parse({})
}

export function loadConfig(): GatewayConfig {
  const path = configPath()
  try {
    if (!existsSync(path)) {
      const cfg = defaultConfig()
      saveConfig(cfg)
      return cfg
    }
    // Strip UTF-8 BOM (e.g. PowerShell Set-Content -Encoding UTF8) so JSON.parse does not fail.
    const text = readFileSync(path, 'utf-8').replace(/^\uFEFF/, '')
    const raw = JSON.parse(text) as StoredConfig
    return GatewayConfigSchema.parse(raw.data ?? raw)
  } catch {
    return defaultConfig()
  }
}

export function saveConfig(partial: Partial<GatewayConfig>): GatewayConfig {
  const current = loadConfig()
  const next = GatewayConfigSchema.parse({ ...current, ...partial })
  const path = configPath()
  mkdirSync(dirname(path), { recursive: true })
  const payload: StoredConfig = { version: CONFIG_VERSION, data: next }
  writeFileSync(path, JSON.stringify(payload, null, 2), 'utf-8')
  return next
}

export function suggestApiProjectDir(): string {
  // desktop/gateway → repo root (two levels up from app path in dev)
  // In packaged app, leave empty for user to pick.
  if (app.isPackaged) return ''
  try {
    const gatewayDir = join(__dirname, '../../..')
    const repoRoot = join(gatewayDir, '../..')
    // Prefer repo root that contains app/main.py
    if (existsSync(join(repoRoot, 'app', 'main.py'))) return repoRoot
    if (existsSync(join(gatewayDir, '..', '..', 'app', 'main.py'))) {
      return join(gatewayDir, '../..')
    }
  } catch {
    /* ignore */
  }
  return ''
}
