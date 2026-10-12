import { useEffect, useState } from 'react'
import { ExternalLink, Play } from 'lucide-react'
import { captureVideoPoster } from '../lib/videoPoster'

/**
 * Poster-only video preview. Embedded Chromium playback flickers on Comfy/Wan
 * exports — open with the OS player instead.
 */
export function StableVideo(props: {
  src: string
  poster?: string | null
  className?: string
  onOpenExternal: () => void
}) {
  const [poster, setPoster] = useState<string | null>(props.poster ?? null)
  const [posterBusy, setPosterBusy] = useState(!props.poster)

  useEffect(() => {
    if (props.poster) {
      setPoster(props.poster)
      setPosterBusy(false)
      return
    }
    let cancelled = false
    setPosterBusy(true)
    setPoster(null)
    void captureVideoPoster(props.src)
      .then((url) => {
        if (!cancelled) setPoster(url)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setPosterBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [props.src, props.poster])

  return (
    <button
      type="button"
      className="group relative block w-full overflow-hidden bg-black text-left"
      title="用系统播放器打开"
      onClick={props.onOpenExternal}
    >
      {poster ? (
        <img
          src={poster}
          alt=""
          className={props.className ?? 'max-h-[360px] w-full object-contain'}
          draggable={false}
        />
      ) : (
        <div
          className={`flex items-center justify-center bg-[#12141a] text-sm text-muted ${props.className ?? 'h-48 w-full'}`}
        >
          {posterBusy ? '准备封面…' : '视频'}
        </div>
      )}
      <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/25 transition group-hover:bg-black/35">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/70 text-white shadow-lg transition group-hover:scale-105">
          <Play className="h-7 w-7 fill-white pl-0.5" />
        </span>
        <span className="flex items-center gap-1 rounded-md bg-black/70 px-2.5 py-1 text-[11px] text-white">
          <ExternalLink className="h-3.5 w-3.5" />
          系统播放器打开
        </span>
      </span>
    </button>
  )
}
