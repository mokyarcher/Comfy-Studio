import type { GalleryItem, GenerateMode } from './types'
import { invalidateGallerySession } from './gallery-session'

const DB_NAME = 'comfy-studio-web'
const STORE = 'gallery'
const DB_VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

export type GalleryRecord = Omit<GalleryItem, 'blob'> & { blob: Blob }

export async function listGallery(): Promise<GalleryRecord[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => {
      const rows = (req.result as GalleryRecord[]) || []
      rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      resolve(rows)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function putGallery(item: GalleryRecord): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(item)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getGallery(id: string): Promise<GalleryRecord | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id)
    req.onsuccess = () => resolve((req.result as GalleryRecord) || null)
    req.onerror = () => reject(req.error)
  })
}

export async function deleteGallery(id: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function toggleFavorite(id: string): Promise<GalleryRecord | null> {
  const item = await getGallery(id)
  if (!item) return null
  item.favorite = !item.favorite
  await putGallery(item)
  return item
}

export function newGalleryId(): string {
  return crypto.randomUUID()
}

export async function saveFromTask(opts: {
  taskId: string
  blob: Blob
  mimeType: string
  prompt: string
  negativePrompt?: string
  width: number
  height: number
  steps: number
  seed?: number | null
  mode: GenerateMode
}): Promise<GalleryRecord> {
  const item: GalleryRecord = {
    id: newGalleryId(),
    taskId: opts.taskId,
    blob: opts.blob,
    mimeType: opts.mimeType,
    prompt: opts.prompt,
    negativePrompt: opts.negativePrompt,
    width: opts.width,
    height: opts.height,
    steps: opts.steps,
    seed: opts.seed,
    mode: opts.mode,
    createdAt: new Date().toISOString(),
    favorite: false,
    showcaseId: null,
    cloudId: null
  }
  await putGallery(item)
  // New work: drop session cache so next gallery visit picks it up
  invalidateGallerySession()
  return item
}

export async function setGalleryCloudId(id: string, cloudId: string): Promise<void> {
  const item = await getGallery(id)
  if (!item) return
  item.cloudId = cloudId
  await putGallery(item)
}

export async function setGalleryShowcaseId(
  id: string,
  showcaseId: string | null
): Promise<GalleryRecord | null> {
  const item = await getGallery(id)
  if (!item) return null
  item.showcaseId = showcaseId
  await putGallery(item)
  return item
}

export async function findByCloudId(cloudId: string): Promise<GalleryRecord | null> {
  const rows = await listGallery()
  return (
    rows.find((r) => r.cloudId === cloudId) ||
    rows.find((r) => r.taskId === `cloud:${cloudId}`) ||
    null
  )
}

export async function findByShowcaseId(showcaseId: string): Promise<GalleryRecord | null> {
  const rows = await listGallery()
  return rows.find((r) => r.showcaseId === showcaseId) || null
}

/** Resolve cloud gallery id from a local row (explicit cloudId or taskId cloud:…). */
export function cloudIdOf(row: Pick<GalleryRecord, 'cloudId' | 'taskId'>): string | null {
  if (row.cloudId) return row.cloudId
  if (row.taskId.startsWith('cloud:')) return row.taskId.slice('cloud:'.length) || null
  return null
}

/**
 * Drop duplicate IndexedDB rows for the same cloud gallery id
 * (concurrent syncCloud used to insert the same image multiple times).
 * Keeps favorite / showcase / earliest copy.
 */
export async function dedupeGalleryByCloudId(): Promise<number> {
  const rows = await listGallery()
  const groups = new Map<string, GalleryRecord[]>()
  for (const r of rows) {
    const cid = cloudIdOf(r)
    if (!cid) continue
    const list = groups.get(cid) || []
    list.push(r)
    groups.set(cid, list)
  }
  let removed = 0
  for (const [, list] of groups) {
    if (list.length < 2) continue
    list.sort((a, b) => {
      const score = (x: GalleryRecord) =>
        (x.favorite ? 4 : 0) + (x.showcaseId ? 2 : 0) + (x.cloudId ? 1 : 0)
      const d = score(b) - score(a)
      if (d !== 0) return d
      return a.createdAt.localeCompare(b.createdAt)
    })
    const [keep, ...dupes] = list
    if (!keep.cloudId) {
      keep.cloudId = cloudIdOf(keep)
      await putGallery(keep)
    }
    for (const d of dupes) {
      await deleteGallery(d.id)
      removed += 1
    }
  }
  if (removed) invalidateGallerySession()
  return removed
}
