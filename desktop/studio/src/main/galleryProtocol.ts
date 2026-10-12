import { existsSync } from 'fs'
import { extname } from 'path'
import { pathToFileURL } from 'url'
import { net, protocol } from 'electron'
import { getGalleryItem } from './store/gallery'

export const GALLERY_PROTOCOL = 'studio-gallery'

export function galleryMediaUrl(id: string): string {
  return `${GALLERY_PROTOCOL}://${id}`
}

export function isGalleryMediaUrl(url: string): boolean {
  return url.startsWith(`${GALLERY_PROTOCOL}://`)
}

function mimeForPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.mp4':
      return 'video/mp4'
    case '.webm':
      return 'video/webm'
    case '.mov':
      return 'video/quicktime'
    default:
      return 'image/png'
  }
}

export function getGalleryMediaInfo(
  id: string
): { url: string; kind: 'image' | 'video'; mime: string } | null {
  const item = getGalleryItem(id)
  if (!item || !existsSync(item.path)) return null
  const mime = mimeForPath(item.path)
  const kind = mime.startsWith('video/') || item.mode === 'image_to_video' ? 'video' : 'image'
  return { url: galleryMediaUrl(id), kind, mime }
}

/** Must run before app.whenReady(). */
export function registerGalleryScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: GALLERY_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
        corsEnabled: true
      }
    }
  ])
}

/** Register after app.whenReady(). */
export function registerGalleryProtocolHandler(): void {
  protocol.handle(GALLERY_PROTOCOL, (request) => {
    try {
      const u = new URL(request.url)
      const id = decodeURIComponent(u.hostname || u.pathname.replace(/^\//, ''))
      if (!id) return new Response('Not Found', { status: 404 })
      const item = getGalleryItem(id)
      if (!item || !existsSync(item.path)) {
        return new Response('Not Found', { status: 404 })
      }
      return net.fetch(pathToFileURL(item.path).href)
    } catch {
      return new Response('Bad Request', { status: 400 })
    }
  })
}
