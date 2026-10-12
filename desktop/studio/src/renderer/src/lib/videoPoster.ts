/** Capture a still frame from a video URL for stable thumbnails (avoids live <video> flicker). */
export function captureVideoPoster(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    let settled = false

    const fail = (err: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err instanceof Error ? err : new Error('无法截取视频封面'))
    }

    const cleanup = () => {
      video.onloadeddata = null
      video.onseeked = null
      video.onerror = null
      video.removeAttribute('src')
      video.load()
    }

    const draw = () => {
      if (settled) return
      try {
        const w = video.videoWidth
        const h = video.videoHeight
        if (!w || !h) {
          fail(new Error('视频尺寸无效'))
          return
        }
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          fail(new Error('无法创建画布'))
          return
        }
        ctx.drawImage(video, 0, 0, w, h)
        settled = true
        const url = canvas.toDataURL('image/jpeg', 0.86)
        cleanup()
        resolve(url)
      } catch (err) {
        fail(err)
      }
    }

    video.onerror = () => fail(new Error('视频加载失败'))
    video.onloadeddata = () => {
      try {
        const t = Number.isFinite(video.duration) && video.duration > 0
          ? Math.min(0.08, video.duration * 0.02)
          : 0.08
        if (video.currentTime === t) draw()
        else video.currentTime = t
      } catch {
        draw()
      }
    }
    video.onseeked = () => draw()
    video.src = src
  })
}
