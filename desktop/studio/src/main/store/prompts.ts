import { randomUUID } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import type { PhraseChip, PromptTemplate } from '../../shared/types'
import { promptsPath } from './paths'

interface PromptsFile {
  version: 1
  templates: PromptTemplate[]
  phrases: PhraseChip[]
  seeded?: boolean
}

const DEFAULT_TEMPLATES: Omit<PromptTemplate, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    title: '电影级人像',
    prompt:
      'cinematic portrait of a young woman, soft rim light, 85mm lens, shallow depth of field, film grain, highly detailed',
    negativePrompt: 'blurry, lowres, deformed, watermark, text',
    tags: ['人像', '电影']
  },
  {
    title: '赛博都市夜景',
    prompt:
      'cyberpunk city street at night, neon signs, rain-soaked asphalt reflections, volumetric fog, ultra detailed',
    negativePrompt: 'daylight, empty street, blurry',
    tags: ['场景', '赛博朋克']
  },
  {
    title: '水彩风景',
    prompt: 'watercolor landscape of misty mountains and a quiet lake, soft washes, paper texture, serene atmosphere',
    negativePrompt: 'photo, 3d render, harsh contrast',
    tags: ['风景', '艺术']
  }
]

const DEFAULT_PHRASES: Omit<PhraseChip, 'id'>[] = [
  { text: 'highly detailed', category: '质量' },
  { text: 'cinematic lighting', category: '光线' },
  { text: 'shallow depth of field', category: '镜头' },
  { text: 'volumetric fog', category: '氛围' },
  { text: 'best quality', category: '质量' },
  { text: 'sharp focus', category: '质量' },
  { text: 'blurry', category: '负向' },
  { text: 'lowres', category: '负向' },
  { text: 'watermark', category: '负向' },
  { text: 'deformed hands', category: '负向' }
]

function nowIso(): string {
  return new Date().toISOString()
}

function readFile(): PromptsFile {
  const p = promptsPath()
  if (!existsSync(p)) {
    const seeded = seedDefaults()
    return seeded
  }
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as PromptsFile
  } catch {
    return seedDefaults()
  }
}

function writeFile(data: PromptsFile): void {
  writeFileSync(promptsPath(), JSON.stringify(data, null, 2), 'utf8')
}

function seedDefaults(): PromptsFile {
  const t = nowIso()
  const data: PromptsFile = {
    version: 1,
    seeded: true,
    templates: DEFAULT_TEMPLATES.map((x) => ({
      ...x,
      id: randomUUID(),
      createdAt: t,
      updatedAt: t
    })),
    phrases: DEFAULT_PHRASES.map((x) => ({ ...x, id: randomUUID() }))
  }
  writeFile(data)
  return data
}

export function listPrompts(): { templates: PromptTemplate[]; phrases: PhraseChip[] } {
  const data = readFile()
  return { templates: data.templates, phrases: data.phrases }
}

export function saveTemplate(input: {
  id?: string
  title: string
  prompt: string
  negativePrompt?: string
  tags?: string[]
}): PromptTemplate {
  const data = readFile()
  const t = nowIso()
  if (input.id) {
    const existing = data.templates.find((x) => x.id === input.id)
    if (!existing) throw new Error('模板不存在')
    existing.title = input.title
    existing.prompt = input.prompt
    existing.negativePrompt = input.negativePrompt
    existing.tags = input.tags ?? []
    existing.updatedAt = t
    writeFile(data)
    return existing
  }
  const created: PromptTemplate = {
    id: randomUUID(),
    title: input.title,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    tags: input.tags ?? [],
    createdAt: t,
    updatedAt: t
  }
  data.templates.unshift(created)
  writeFile(data)
  return created
}

export function deleteTemplate(id: string): void {
  const data = readFile()
  data.templates = data.templates.filter((x) => x.id !== id)
  writeFile(data)
}

export function savePhrase(input: { id?: string; text: string; category: string }): PhraseChip {
  const data = readFile()
  if (input.id) {
    const existing = data.phrases.find((x) => x.id === input.id)
    if (!existing) throw new Error('短语不存在')
    existing.text = input.text
    existing.category = input.category
    writeFile(data)
    return existing
  }
  const created: PhraseChip = { id: randomUUID(), text: input.text, category: input.category }
  data.phrases.unshift(created)
  writeFile(data)
  return created
}

export function deletePhrase(id: string): void {
  const data = readFile()
  data.phrases = data.phrases.filter((x) => x.id !== id)
  writeFile(data)
}
