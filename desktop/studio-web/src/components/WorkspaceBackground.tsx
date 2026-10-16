import { useEffect, useState } from 'react'
import {
  getBackground,
  isBackgroundReady,
  preloadBackground,
  type BackgroundOption
} from '@/lib/backgrounds'

type Layer = BackgroundOption & { key: string; displayUrl: string }

type Props = {
  backgroundId: string
}

function displayUrlFor(bg: BackgroundOption): string {
  return isBackgroundReady(bg.id) ? bg.url : bg.previewUrl
}

/** Cross-slide workspace photo; preview first, full res when cached/preloaded. */
export function WorkspaceBackground({ backgroundId }: Props) {
  const target = getBackground(backgroundId)
  const [shown, setShown] = useState<Layer>(() => ({
    ...target,
    key: `${target.id}-0`,
    displayUrl: displayUrlFor(target)
  }))
  const [leaving, setLeaving] = useState<Layer | null>(null)
  const [seq, setSeq] = useState(0)

  // Upgrade preview → full when ready (preload or local fetch).
  useEffect(() => {
    let cancelled = false
    const bg = getBackground(backgroundId)

    void preloadBackground(bg.id).then(() => {
      if (cancelled) return
      setShown((prev) => {
        if (prev.id !== bg.id) return prev
        if (prev.displayUrl === bg.url) return prev
        return { ...prev, displayUrl: bg.url }
      })
    })

    return () => {
      cancelled = true
    }
  }, [backgroundId])

  useEffect(() => {
    if (target.id === shown.id && !leaving) return

    const nextSeq = seq + 1
    setSeq(nextSeq)
    setLeaving(shown)
    setShown({
      ...target,
      key: `${target.id}-${nextSeq}`,
      displayUrl: displayUrlFor(target)
    })

    const t = window.setTimeout(() => setLeaving(null), 560)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to id change
  }, [target.id])

  return (
    <div className="workspace-bg" aria-hidden>
      {leaving ? (
        <div
          key={leaving.key}
          className="workspace-bg-layer workspace-bg-layer-out"
          style={{ backgroundImage: `url('${leaving.displayUrl}')` }}
        />
      ) : null}
      <div
        key={shown.key}
        className={`workspace-bg-layer ${leaving ? 'workspace-bg-layer-in' : ''}`}
        style={{ backgroundImage: `url('${shown.displayUrl}')` }}
      />
    </div>
  )
}
