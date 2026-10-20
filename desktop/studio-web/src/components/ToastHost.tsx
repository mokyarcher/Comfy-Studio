import { createPortal } from 'react-dom'
import { useToast } from '@/store/toast'

/** Portaled to body so it never becomes a flex sibling of the workspace (layout shift). */
export function ToastHost() {
  const items = useToast((s) => s.items)
  const dismiss = useToast((s) => s.dismiss)
  if (!items.length || typeof document === 'undefined') return null
  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
      {items.map((t) => {
        const toneClass =
          t.tone === 'error'
            ? 'glass-toast-error'
            : t.tone === 'success'
              ? 'glass-toast-success'
              : 'glass-toast-info'
        return (
          <button
            key={t.id}
            type="button"
            className={`pointer-events-auto glass-toast ${toneClass}`}
            onClick={() => dismiss(t.id)}
          >
            <span>{t.message}</span>
          </button>
        )
      })}
    </div>,
    document.body
  )
}
