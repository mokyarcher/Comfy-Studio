import { useAppStore } from '../stores/appStore'

export function Toast() {
  const toast = useAppStore((s) => s.toast)
  const clearToast = useAppStore((s) => s.clearToast)
  if (!toast) return null

  const colors =
    toast.type === 'success'
      ? 'border-success/40 bg-success/15 text-success'
      : toast.type === 'error'
        ? 'border-danger/40 bg-danger/15 text-danger'
        : 'border-accent/40 bg-accent/15 text-accent'

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50">
      <button
        className={`pointer-events-auto max-w-md rounded-xl border px-4 py-3 text-sm shadow-panel ${colors}`}
        onClick={clearToast}
      >
        {toast.message}
      </button>
    </div>
  )
}
