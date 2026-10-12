import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'

export function getUserDataRoot(): string {
  return app.getPath('userData')
}

export function ensureDir(dir: string): string {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function profilesPath(): string {
  return join(getUserDataRoot(), 'profiles.json')
}

export function settingsPath(): string {
  return join(getUserDataRoot(), 'settings.json')
}

export function galleryMetaPath(): string {
  return join(ensureDir(join(getUserDataRoot(), 'gallery')), 'metadata.json')
}

export function galleryDir(): string {
  return ensureDir(join(getUserDataRoot(), 'gallery'))
}

export function promptsPath(): string {
  return join(getUserDataRoot(), 'prompts.json')
}

export function taskHistoryPath(): string {
  return join(getUserDataRoot(), 'task-history.json')
}
