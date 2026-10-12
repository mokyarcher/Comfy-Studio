import { randomUUID } from 'crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { basename, extname, join } from 'path'
import { shell } from 'electron'
import type { GalleryItem } from '../../shared/types'
import { galleryDir, galleryMetaPath } from './paths'

interface GalleryFile {
  version: 1
  items: GalleryItem[]
}

function readMeta(): GalleryFile {
  const p = galleryMetaPath()
  if (!existsSync(p)) return { version: 1, items: [] }
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as GalleryFile
  } catch {
    return { version: 1, items: [] }
  }
}

function writeMeta(data: GalleryFile): void {
  writeFileSync(galleryMetaPath(), JSON.stringify(data, null, 2), 'utf8')
}

export function listGallery(): GalleryItem[] {
  return readMeta().items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getGalleryItem(id: string): GalleryItem | null {
  return readMeta().items.find((i) => i.id === id) ?? null
}

export function saveImageFromBuffer(payload: {
  buffer: ArrayBuffer | Buffer | Uint8Array
  prompt: string
  negativePrompt?: string
  width: number
  height: number
  steps: number
  seed?: number | null
  taskId: string
  profileId?: string
  profileName?: string
  favorite?: boolean
  mode?: 'txt2img' | 'image_edit' | 'image_to_video'
  contentType?: string
  /** Wall-clock generate duration (ms) */
  elapsedMs?: number | null
  /** Optional reference image bytes for image_edit / image_to_video */
  refBuffers?: Array<{ bytes: Buffer; filename?: string }>
}): GalleryItem {
  const dir = galleryDir()
  const id = randomUUID()
  const ct = (payload.contentType || '').toLowerCase()
  const ext =
    payload.mode === 'image_to_video' || ct.startsWith('video/')
      ? ct.includes('webm')
        ? '.webm'
        : ct.includes('quicktime') || ct.includes('mov')
          ? '.mov'
          : '.mp4'
      : '.png'
  const filename = `${id}${ext}`
  const filePath = join(dir, filename)
  const raw = payload.buffer
  const buf = Buffer.isBuffer(raw)
    ? raw
    : Buffer.from(raw instanceof ArrayBuffer ? new Uint8Array(raw) : Uint8Array.from(raw as ArrayLike<number>))
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, buf)
  renameSync(tmp, filePath)

  const refPaths: string[] = []
  if (payload.refBuffers?.length) {
    const refsDir = join(dir, `${id}_refs`)
    mkdirSync(refsDir, { recursive: true })
    payload.refBuffers.forEach((ref, index) => {
      const ext = extname(ref.filename || '') || '.png'
      const safeExt = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext.toLowerCase())
        ? ext.toLowerCase()
        : '.png'
      const refPath = join(refsDir, `ref_${index}${safeExt}`)
      writeFileSync(refPath, ref.bytes)
      refPaths.push(refPath)
    })
  }

  const item: GalleryItem = {
    id,
    prompt: payload.prompt,
    negativePrompt: payload.negativePrompt,
    width: payload.width,
    height: payload.height,
    steps: payload.steps,
    seed: payload.seed ?? null,
    taskId: payload.taskId,
    path: filePath,
    createdAt: new Date().toISOString(),
    favorite: payload.favorite ?? false,
    profileId: payload.profileId,
    profileName: payload.profileName,
    mode: payload.mode ?? 'txt2img',
    elapsedMs:
      payload.elapsedMs != null && payload.elapsedMs > 0
        ? Math.round(payload.elapsedMs)
        : null,
    refPaths,
    showcaseId: null
  }

  const data = readMeta()
  data.items.unshift(item)
  writeMeta(data)
  return item
}

export function setGalleryShowcaseId(id: string, showcaseId: string | null): GalleryItem | null {
  const data = readMeta()
  const item = data.items.find((i) => i.id === id)
  if (!item) return null
  item.showcaseId = showcaseId
  writeMeta(data)
  return item
}

export function deleteGalleryItem(id: string): void {
  const data = readMeta()
  const idx = data.items.findIndex((i) => i.id === id)
  if (idx < 0) return
  const item = data.items[idx]
  data.items.splice(idx, 1)
  writeMeta(data)
  if (item.path && existsSync(item.path)) {
    try {
      unlinkSync(item.path)
    } catch {
      /* ignore */
    }
  }
  for (const rp of item.refPaths || []) {
    if (rp && existsSync(rp)) {
      try {
        unlinkSync(rp)
      } catch {
        /* ignore */
      }
    }
  }
}

export function toggleFavorite(id: string, favorite: boolean): GalleryItem | null {
  const data = readMeta()
  const item = data.items.find((i) => i.id === id)
  if (!item) return null
  item.favorite = favorite
  writeMeta(data)
  return item
}

export function exportImage(id: string, destPath: string): void {
  const data = readMeta()
  const item = data.items.find((i) => i.id === id)
  if (!item || !existsSync(item.path)) throw new Error('作品文件不存在')
  copyFileSync(item.path, destPath)
}

export function openInFolder(id: string): void {
  const data = readMeta()
  const item = data.items.find((i) => i.id === id)
  if (!item) throw new Error('作品不存在')
  shell.showItemInFolder(item.path)
}

/** Open media with the OS default app (reliable for Comfy video playback). */
export async function openGalleryFile(id: string): Promise<{ ok: boolean; message?: string }> {
  const item = getGalleryItem(id)
  if (!item || !existsSync(item.path)) {
    return { ok: false, message: '作品文件不存在' }
  }
  const err = await shell.openPath(item.path)
  if (err) return { ok: false, message: err }
  return { ok: true }
}

export function readImageAsDataUrl(id: string): string | null {
  const data = readMeta()
  const item = data.items.find((i) => i.id === id)
  if (!item || !existsSync(item.path)) return null
  const buf = readFileSync(item.path)
  const ext = extname(item.path).toLowerCase()
  const mime =
    ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : ext === '.webp'
        ? 'image/webp'
        : ext === '.mp4'
          ? 'video/mp4'
          : ext === '.webm'
            ? 'video/webm'
            : ext === '.mov'
              ? 'video/quicktime'
              : 'image/png'
  return `data:${mime};base64,${buf.toString('base64')}`
}

export function clearGallery(): void {
  const data = readMeta()
  for (const item of data.items) {
    if (item.path && existsSync(item.path)) {
      try {
        unlinkSync(item.path)
      } catch {
        /* ignore */
      }
    }
    for (const rp of item.refPaths || []) {
      if (rp && existsSync(rp)) {
        try {
          unlinkSync(rp)
        } catch {
          /* ignore */
        }
      }
    }
  }
  writeMeta({ version: 1, items: [] })
}

export function readGalleryFileBuffer(id: string): { buffer: Buffer; filename: string } | null {
  const item = getGalleryItem(id)
  if (!item || !existsSync(item.path)) return null
  return { buffer: readFileSync(item.path), filename: basename(item.path) }
}

export function readGalleryRefBuffers(
  id: string
): Array<{ buffer: Buffer; filename: string }> {
  const item = getGalleryItem(id)
  if (!item?.refPaths?.length) return []
  const out: Array<{ buffer: Buffer; filename: string }> = []
  for (const rp of item.refPaths) {
    if (!rp || !existsSync(rp)) continue
    out.push({ buffer: readFileSync(rp), filename: basename(rp) })
  }
  return out
}
