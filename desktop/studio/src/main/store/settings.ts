import { existsSync, readFileSync, writeFileSync } from 'fs'
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/types'
import { settingsPath } from './paths'

function normalizeGridColumns(n: unknown): 4 | 5 | 6 | 7 | 8 {
  const v = typeof n === 'number' ? n : Number(n)
  if (v === 5 || v === 6 || v === 7 || v === 8) return v
  return 4
}

function normalizeSettings(raw: Partial<AppSettings>): AppSettings {
  const merged = { ...DEFAULT_SETTINGS, ...raw }
  const prefs = { ...DEFAULT_SETTINGS.polishPrefs!, ...raw.polishPrefs }
  // Local offline polish removed — always coerce to AI gateway polish.
  merged.polishPrefs = { ...prefs, mode: 'ai' }
  merged.mediaGridColumns = normalizeGridColumns(
    raw.mediaGridColumns ?? merged.mediaGridColumns ?? DEFAULT_SETTINGS.mediaGridColumns
  )
  return merged
}

export function getSettings(): AppSettings {
  const p = settingsPath()
  if (!existsSync(p)) return { ...DEFAULT_SETTINGS }
  try {
    return normalizeSettings(JSON.parse(readFileSync(p, 'utf8')) as Partial<AppSettings>)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(partial: Partial<AppSettings>): AppSettings {
  const next = normalizeSettings({ ...getSettings(), ...partial })
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8')
  return next
}
