import { useToast } from '@/store/toast'

export function ToastHost() {
  const items = useToast((s) => s.items)
  const dismiss = useToast((s) => s.dismiss)
  if (!items.length) return null
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`pointer-events-auto rounded-lg border px-3 py-2 text-left text-sm shadow-lg ${
            t.tone === 'error'
              ? 'border-danger/40 bg-panel text-danger'
              : t.tone === 'success'
                ? 'border-success/40 bg-panel text-success'
                : 'border-border bg-panel text-text'
          }`}
          onClick={() => dismiss(t.id)}
        >
          {t.message}
        </button>
      ))}
    </div>
  )
}
