import { useEffect, useState } from 'react'
import { getBackground, type BackgroundOption } from '@/lib/backgrounds'

type Layer = BackgroundOption & { key: string }

type Props = {
  backgroundId: string
}

/** Cross-slide workspace photo when backgroundId changes. */
export function WorkspaceBackground({ backgroundId }: Props) {
  const target = getBackground(backgroundId)
  const [shown, setShown] = useState<Layer>(() => ({
    ...target,
    key: `${target.id}-0`
  }))
  const [leaving, setLeaving] = useState<Layer | null>(null)
  const [seq, setSeq] = useState(0)

  useEffect(() => {
    if (target.id === shown.id && !leaving) return

    const nextSeq = seq + 1
    setSeq(nextSeq)
    setLeaving(shown)
    setShown({ ...target, key: `${target.id}-${nextSeq}` })

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
          style={{ backgroundImage: `url('${leaving.url}')` }}
        />
      ) : null}
      <div
        key={shown.key}
        className={`workspace-bg-layer ${leaving ? 'workspace-bg-layer-in' : ''}`}
        style={{ backgroundImage: `url('${shown.url}')` }}
      />
    </div>
  )
}
