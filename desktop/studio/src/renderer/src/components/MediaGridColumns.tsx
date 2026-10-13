import type { CSSProperties } from 'react'
import type { MediaGridColumns } from '../../../shared/types'
import { useAppStore } from '../stores/appStore'

const OPTIONS: MediaGridColumns[] = [4, 5, 6, 7, 8]

export function useMediaGridColumns(): MediaGridColumns {
  const n = useAppStore((s) => s.settings.mediaGridColumns)
  if (n === 5 || n === 6 || n === 7 || n === 8) return n
  return 4
}

export async function setMediaGridColumns(cols: MediaGridColumns): Promise<void> {
  const next = await window.studio.saveSettings({ mediaGridColumns: cols })
  useAppStore.setState({ settings: next })
}

/** Compact 4–8 column picker for gallery / showcase headers. */
export function MediaGridColumnsPicker() {
  const cols = useMediaGridColumns()

  return (
    <div className="flex items-center gap-1" title="每行列数">
      <span className="mr-1 text-[11px] text-muted">列</span>
      {OPTIONS.map((n) => {
        const active = cols === n
        return (
          <button
            key={n}
            type="button"
            className={`min-w-[1.75rem] rounded-md px-1.5 py-1 text-xs transition ${
              active
                ? 'bg-primary/20 text-primary'
                : 'text-muted hover:bg-panel-elevated hover:text-text'
            }`}
            onClick={() => void setMediaGridColumns(n)}
          >
            {n}
          </button>
        )
      })}
    </div>
  )
}

export function mediaGridClass(cols: MediaGridColumns): string {
  // Fixed column count (not responsive breakpoints) — user chooses density.
  const gap = cols >= 7 ? 'gap-2' : cols >= 5 ? 'gap-3' : 'gap-4'
  return `grid ${gap}`
}

export function mediaGridStyle(cols: MediaGridColumns): CSSProperties {
  return { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }
}
