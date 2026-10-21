import type { GalleryRecord } from './gallery-db'

/** Metadata + object URLs kept across Gallery route remounts (SPA session). */
export type GalleryCacheRow = Omit<GalleryRecord, 'blob'> & {
  thumbUrl: string
  fullUrl: string
}

type GallerySession = {
  rows: GalleryCacheRow[]
  blobs: Map<string, Blob>
}

let session: GallerySession | null = null

function revokeRowUrls(row: GalleryCacheRow): void {
  if (row.thumbUrl) URL.revokeObjectURL(row.thumbUrl)
  if (row.fullUrl && row.fullUrl !== row.thumbUrl) URL.revokeObjectURL(row.fullUrl)
}

/** Snapshot currently shown in GalleryPage — keeps thumb URLs alive when leaving the route. */
export function saveGallerySession(rows: GalleryCacheRow[], blobs: Map<string, Blob>): void {
  session = { rows: rows.map((r) => ({ ...r })), blobs }
}

export function peekGallerySession(): GallerySession | null {
  return session
}

export function patchGallerySessionRow(
  id: string,
  patch: Partial<GalleryCacheRow>
): void {
  if (!session) return
  session.rows = session.rows.map((r) => (r.id === id ? { ...r, ...patch } : r))
}

export function removeGallerySessionItem(id: string): void {
  if (!session) return
  const gone = session.rows.find((r) => r.id === id)
  if (gone) revokeRowUrls(gone)
  session.rows = session.rows.filter((r) => r.id !== id)
  session.blobs.delete(id)
}

/** Drop session (e.g. after new work saved) so next visit reloads from IndexedDB. */
export function invalidateGallerySession(): void {
  if (!session) return
  for (const row of session.rows) revokeRowUrls(row)
  session.blobs.clear()
  session = null
}
