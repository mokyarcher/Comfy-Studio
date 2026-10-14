import type { GalleryItem, GenerateMode } from './types'

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
    showcaseId: null
  }
  await putGallery(item)
  return item
}
