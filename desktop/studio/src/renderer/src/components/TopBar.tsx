import { RefreshCw, User, Wifi, WifiOff } from 'lucide-react'
import { useAppStore } from '../stores/appStore'

export function TopBar() {
  const profiles = useAppStore((s) => s.profiles)
  const activeProfileId = useAppStore((s) => s.activeProfileId)
  const connectionOk = useAppStore((s) => s.connectionOk)
  const connectionMessage = useAppStore((s) => s.connectionMessage)
  const checkConnection = useAppStore((s) => s.checkConnection)
  const setPage = useAppStore((s) => s.setPage)
  const busy = useAppStore((s) => s.busy)

  const active =
    profiles.find((p) => p.id === activeProfileId) ?? profiles.find((p) => p.isDefault) ?? profiles[0]
  const accountLabel = active?.username || active?.name || '未登录'

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-panel px-5">
      <div className="flex items-center gap-3">
        <div
          className={`flex items-center gap-2 rounded-lg border px-3 py-1 text-xs ${
            connectionOk
              ? 'border-accent/30 bg-accent/10 text-accent'
              : 'border-warning/30 bg-warning/10 text-warning'
          }`}
        >
          {connectionOk ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          <span className="max-w-[360px] truncate">{connectionMessage}</span>
        </div>
        <button
          className="btn-ghost !px-2 !py-1 text-xs"
          onClick={() => checkConnection()}
          disabled={busy}
          title="重新检测连接"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          重试
        </button>
      </div>

      <button
        type="button"
        className="flex items-center gap-2 rounded-lg border border-border bg-panel-elevated px-3 py-1.5 text-xs text-text transition hover:border-primary/40 hover:text-primary"
        onClick={() => setPage('connection')}
        title="账号管理"
      >
        <User className="h-3.5 w-3.5 text-muted" />
        <span className="max-w-[160px] truncate">{accountLabel}</span>
      </button>
    </header>
  )
}
