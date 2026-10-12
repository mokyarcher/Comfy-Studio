import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { PhraseChip, PromptTemplate } from '../../shared/types'
import { getUserDataRoot } from './paths'

export interface OfficialPromptLibrary {
  version: number
  updatedAt: string
  syncedAt: string
  templates: PromptTemplate[]
  phrases: PhraseChip[]
}

function cachePath(): string {
  return join(getUserDataRoot(), 'official-prompts.json')
}

export function readOfficialPrompts(): OfficialPromptLibrary | null {
  const p = cachePath()
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as OfficialPromptLibrary
  } catch {
    return null
  }
}

export function writeOfficialPrompts(data: OfficialPromptLibrary): OfficialPromptLibrary {
  writeFileSync(cachePath(), JSON.stringify(data, null, 2), 'utf8')
  return data
}

export function mapServerLibrary(raw: {
  version: number
  updated_at: string
  templates: Array<{
    id: string
    title: string
    prompt: string
    negative_prompt?: string
    tags?: string[]
    created_at?: string
    updated_at?: string
  }>
  phrases: Array<{ id: string; text: string; category: string }>
}): OfficialPromptLibrary {
  return {
    version: raw.version,
    updatedAt: raw.updated_at,
    syncedAt: new Date().toISOString(),
    templates: (raw.templates || []).map((t) => ({
      id: t.id,
      title: t.title,
      prompt: t.prompt,
      negativePrompt: t.negative_prompt || undefined,
      tags: t.tags || [],
      createdAt: t.created_at || raw.updated_at,
      updatedAt: t.updated_at || raw.updated_at
    })),
    phrases: (raw.phrases || []).map((p) => ({
      id: p.id,
      text: p.text,
      category: p.category || '通用'
    }))
  }
}
