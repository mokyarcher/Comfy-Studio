import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import type { ShowcaseItem } from '../../shared/types'
import { ensureDir, getUserDataRoot } from './paths'

interface CacheIndex {
  version: 1
  items: Record<
    string,
    {
      meta: ShowcaseItem
      hasThumb: boolean
      hasFull: boolean
      fullExt: string
      updatedAt: string
    }
  >
}

function cacheRoot(): string {
  return ensureDir(join(getUserDataRoot(), 'showcase-cache'))
}

function indexPath(): string {
  return join(cacheRoot(), 'index.json')
}

function itemDir(id: string): string {
  return ensureDir(join(cacheRoot(), id))
}

function readIndex(): CacheIndex {
  const p = indexPath()
  if (!existsSync(p)) return { version: 1, items: {} }
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as CacheIndex
  } catch {
    return { version: 1, items: {} }
  }
}

function writeIndex(data: CacheIndex): void {
  writeFileSync(indexPath(), JSON.stringify(data, null, 2), 'utf8')
}

function mimeFromExt(ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, '')
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg'
  if (e === 'webp') return 'image/webp'
  return 'image/png'
}

function dataUrlFromFile(filePath: string, mime: string): string | null {
  if (!existsSync(filePath)) return null
  const buf = readFileSync(filePath)
  return `data:${mime};base64,${buf.toString('base64')}`
}

export function upsertShowcaseMeta(item: ShowcaseItem): void {
  const idx = readIndex()
  const prev = idx.items[item.id]
  idx.items[item.id] = {
    meta: item,
    hasThumb: prev?.hasThumb ?? false,
    hasFull: prev?.hasFull ?? false,
    fullExt: prev?.fullExt ?? '.png',
    updatedAt: new Date().toISOString()
  }
  writeIndex(idx)
  writeFileSync(join(itemDir(item.id), 'meta.json'), JSON.stringify(item, null, 2), 'utf8')
}

export function getCachedShowcaseMeta(id: string): ShowcaseItem | null {
  const entry = readIndex().items[id]
  if (entry?.meta) return entry.meta
  const metaFile = join(cacheRoot(), id, 'meta.json')
  if (!existsSync(metaFile)) return null
  try {
    return JSON.parse(readFileSync(metaFile, 'utf8')) as ShowcaseItem
  } catch {
    return null
  }
}

export function getCachedThumbDataUrl(id: string): string | null {
  return dataUrlFromFile(join(cacheRoot(), id, 'thumb.jpg'), 'image/jpeg')
}

export function putCachedThumb(id: string, buffer: Buffer): void {
  const dir = itemDir(id)
  writeFileSync(join(dir, 'thumb.jpg'), buffer)
  const idx = readIndex()
  const prev = idx.items[id]
  if (prev) {
    prev.hasThumb = true
    prev.updatedAt = new Date().toISOString()
  } else {
    idx.items[id] = {
      meta: {
        id,
        author_name: '',
        author_username: '',
        status: 'published',
        prompt: '',
        mode: 'txt2img',
        width: 0,
        height: 0,
        steps: 0,
        ref_count: 0,
        created_at: '',
        updated_at: '',
        image_url: `/v1/showcase/${id}/image`,
        thumb_url: `/v1/showcase/${id}/thumb`,
        ref_urls: []
      },
      hasThumb: true,
      hasFull: false,
      fullExt: '.png',
      updatedAt: new Date().toISOString()
    }
  }
  writeIndex(idx)
}

export function getCachedFullDataUrl(id: string): string | null {
  const entry = readIndex().items[id]
  if (!entry?.hasFull) {
    // try common names
    for (const name of ['full.png', 'full.jpg', 'full.jpeg', 'full.webp']) {
      const url = dataUrlFromFile(join(cacheRoot(), id, name), mimeFromExt(name))
      if (url) return url
    }
    return null
  }
  const name = `full${entry.fullExt.startsWith('.') ? entry.fullExt : `.${entry.fullExt}`}`
  return dataUrlFromFile(join(cacheRoot(), id, name), mimeFromExt(entry.fullExt))
}

export function putCachedFull(id: string, buffer: Buffer, ext = '.png'): void {
  const safeExt = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext.toLowerCase())
    ? ext.toLowerCase()
    : '.png'
  const dir = itemDir(id)
  // remove previous full.* variants
  for (const name of ['full.png', 'full.jpg', 'full.jpeg', 'full.webp']) {
    const p = join(dir, name)
    if (existsSync(p)) {
      try {
        unlinkSync(p)
      } catch {
        /* ignore */
      }
    }
  }
  writeFileSync(join(dir, `full${safeExt}`), buffer)
  const idx = readIndex()
  const prev = idx.items[id]
  if (prev) {
    prev.hasFull = true
    prev.fullExt = safeExt
    prev.updatedAt = new Date().toISOString()
  } else {
    idx.items[id] = {
      meta: {
        id,
        author_name: '',
        author_username: '',
        status: 'published',
        prompt: '',
        mode: 'txt2img',
        width: 0,
        height: 0,
        steps: 0,
        ref_count: 0,
        created_at: '',
        updated_at: '',
        image_url: `/v1/showcase/${id}/image`,
        thumb_url: `/v1/showcase/${id}/thumb`,
        ref_urls: []
      },
      hasThumb: false,
      hasFull: true,
      fullExt: safeExt,
      updatedAt: new Date().toISOString()
    }
  }
  writeIndex(idx)
}

export function getCachedFullBuffer(
  id: string
): { buffer: Buffer; filename: string } | null {
  const entry = readIndex().items[id]
  const candidates = entry?.hasFull
    ? [`full${entry.fullExt.startsWith('.') ? entry.fullExt : `.${entry.fullExt}`}`]
    : ['full.png', 'full.jpg', 'full.jpeg', 'full.webp']
  for (const name of candidates) {
    const p = join(cacheRoot(), id, name)
    if (existsSync(p)) {
      return { buffer: readFileSync(p), filename: name.replace(/^full/, `showcase-${id.slice(0, 8)}`) }
    }
  }
  return null
}

/** Parse /v1/showcase/{id}/thumb|image|refs/n */
export function parseShowcaseAssetPath(
  path: string
): { id: string; kind: 'thumb' | 'image' | 'ref'; refIndex?: number } | null {
  const m = path.match(/^\/?v1\/showcase\/([^/]+)\/(thumb|image|refs\/(\d+))\/?$/i)
  if (!m) return null
  if (m[2] === 'thumb') return { id: m[1], kind: 'thumb' }
  if (m[2] === 'image') return { id: m[1], kind: 'image' }
  return { id: m[1], kind: 'ref', refIndex: Number(m[3]) }
}

export function ensureShowcaseCacheDir(): string {
  mkdirSync(cacheRoot(), { recursive: true })
  return cacheRoot()
}
