import { useEffect } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useAppStore } from '../stores/appStore'

export function Toast() {
  const toast = useAppStore((s) => s.toast)
  const clearToast = useAppStore((s) => s.clearToast)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(clearToast, 1000)
    return () => clearTimeout(t)
  }, [toast, clearToast])

  if (!toast) return null

  const Icon = toast.type === 'success' ? CheckCircle2 : toast.type === 'error' ? AlertCircle : Info
  const tone =
    toast.type === 'success'
      ? 'border-[#34d399] text-[#34d399]'
      : toast.type === 'error'
        ? 'border-[#f87171] text-[#f87171]'
        : 'border-[#22d3ee] text-[#22d3ee]'

  return (
    <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center p-6">
      <div
        className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border-2 px-5 py-4 shadow-[0_16px_48px_rgba(0,0,0,0.55)] ${tone}`}
        style={{ backgroundColor: '#1a1d27' }}
        role="status"
      >
        <Icon className="mt-0.5 h-5 w-5 shrink-0" />
        <p className="flex-1 text-sm leading-relaxed text-[#e8eaf0]">{toast.message}</p>
        <button className="btn-ghost !p-1" onClick={clearToast} aria-label="关闭">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
