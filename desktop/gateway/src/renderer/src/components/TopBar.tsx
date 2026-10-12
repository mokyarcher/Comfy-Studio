import { Minus, Square, X } from 'lucide-react'
import { useAppStore } from '../stores/appStore'

function Dot({ ok, label }: { ok?: boolean; label: string }) {
  const color = ok === undefined ? 'bg-muted' : ok ? 'bg-success' : 'bg-danger'
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-panel-elevated px-2.5 py-1 text-xs text-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
      {label}
    </span>
  )
}

export function TopBar() {
  const status = useAppStore((s) => s.status)

  return (
    <header className="app-drag flex h-14 shrink-0 items-center justify-between border-b border-border bg-panel px-4">
      <div className="app-no-drag flex flex-wrap items-center gap-2">
        <Dot ok={status?.localApi.ok} label="本地服务" />
        <Dot ok={status?.comfy.ok} label="ComfyUI" />
        <Dot ok={status?.frp.state === 'running'} label="FRP 隧道" />
        <Dot ok={status?.publicApi.ok} label="公网 API" />
      </div>
      <div className="app-no-drag flex items-center gap-1">
        <button className="btn-ghost h-8 w-8 p-0" onClick={() => void window.gateway.minimize()}>
          <Minus className="h-4 w-4" />
        </button>
        <button className="btn-ghost h-8 w-8 p-0" onClick={() => void window.gateway.maximize()}>
          <Square className="h-3.5 w-3.5" />
        </button>
        <button className="btn-ghost h-8 w-8 p-0 hover:text-danger" onClick={() => void window.gateway.close()}>
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  )
}
