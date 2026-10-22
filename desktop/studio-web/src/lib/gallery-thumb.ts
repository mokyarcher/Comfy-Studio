/** Yield to the browser so sidebar WAAPI / input stay smooth. */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    const sch = (window as unknown as { scheduler?: { yield?: () => Promise<void> } }).scheduler
    if (typeof sch?.yield === 'function') {
      void sch.yield().then(() => resolve())
      return
    }
    window.setTimeout(resolve, 0)
  })
}

/**
 * Thumb algorithm generation — bump when encode params change so session
 * cache drops stale soft thumbs (e.g. long-edge-only 360px).
 */
export const GALLERY_THUMB_GEN = 2

/**
 * Downscale a still for square `object-fit: cover` tiles.
 * Scale by the *short* edge so widescreen (1928×1088) still has enough
 * pixels after cover-crop; long-edge-only 360px made 1088→~203 and looked soft.
 */
export async function blobToThumbUrl(blob: Blob, minShortEdge = 0): Promise<string> {
  if (blob.type.startsWith('video/') || typeof createImageBitmap !== 'function') {
    return URL.createObjectURL(blob)
  }
  try {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    // ~280–320 CSS tile × dpr, capped so decode stays cheap on huge galleries
    const target =
      minShortEdge > 0
        ? minShortEdge
        : Math.round(Math.min(720, Math.max(480, 320 * Math.min(dpr, 2.5))))

    const bmp = await createImageBitmap(blob)
    const short = Math.max(1, Math.min(bmp.width, bmp.height))
    const scale = Math.min(1, target / short)
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bmp.close()
      return URL.createObjectURL(blob)
    }
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    const thumb = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85)
    )
    if (!thumb) return URL.createObjectURL(blob)
    return URL.createObjectURL(thumb)
  } catch {
    return URL.createObjectURL(blob)
  }
}
