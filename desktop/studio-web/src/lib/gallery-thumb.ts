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

/** Downscale a still image blob for grid tiles (videos keep object URL). */
export async function blobToThumbUrl(blob: Blob, maxEdge = 480): Promise<string> {
  if (blob.type.startsWith('video/') || typeof createImageBitmap !== 'function') {
    return URL.createObjectURL(blob)
  }
  try {
    const bmp = await createImageBitmap(blob)
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height))
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
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    const thumb = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.72)
    )
    if (!thumb) return URL.createObjectURL(blob)
    return URL.createObjectURL(thumb)
  } catch {
    return URL.createObjectURL(blob)
  }
}
