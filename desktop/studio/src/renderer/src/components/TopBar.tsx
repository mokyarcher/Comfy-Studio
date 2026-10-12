import { useEffect, useState } from 'react'
import { Cpu, RefreshCw, User, Wifi, WifiOff } from 'lucide-react'
import { useAppStore } from '../stores/appStore'

type GpuView = {
  state: 'idle' | 'busy' | null
  detail: string
}

export function TopBar() {
  const profiles = useAppStore((s) => s.profiles)
  const activeProfileId = useAppStore((s) => s.activeProfileId)
  const connectionOk = useAppStore((s) => s.connectionOk)
  const connectionMessage = useAppStore((s) => s.connectionMessage)
  const checkConnection = useAppStore((s) => s.checkConnection)
  const setPage = useAppStore((s) => s.setPage)
  const busy = useAppStore((s) => s.busy)
  const [gpu, setGpu] = useState<GpuView>({ state: null, detail: '' })

  const active =
    profiles.find((p) => p.id === activeProfileId) ?? profiles.find((p) => p.isDefault) ?? profiles[0]
  const accountLabel = active?.username || active?.name || '未登录'

  // Auto reconnect / health probe every 30s while logged in
  useEffect(() => {
    if (!activeProfileId) return
    const timer = setInterval(() => {
      void checkConnection()
    }, 30_000)
    return () => clearInterval(timer)
  }, [activeProfileId, checkConnection])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined

    const refreshGpu = async () => {
      if (!activeProfileId || !connectionOk) {
        if (!cancelled) setGpu({ state: null, detail: '' })
        return
      }
      try {
        const res = await window.studio.getGpuStatus({ profileId: activeProfileId })
        if (cancelled) return
        if (!res?.ok || (res.state !== 'idle' && res.state !== 'busy')) {
          setGpu({ state: null, detail: res?.message || '' })
          return
        }
        const parts: string[] = []
        if (res.localHold) parts.push('本机占用')
        if (res.queueRunning > 0) parts.push('生成中')
        else if (res.queueQueued > 0) parts.push(`排队 ${res.queueQueued}`)
        setGpu({
          state: res.state,
          detail: parts.join(' · ')
        })
      } catch {
        if (!cancelled) setGpu({ state: null, detail: '' })
      }
    }

    void refreshGpu()
    if (activeProfileId && connectionOk) {
      timer = setInterval(() => void refreshGpu(), 4000)
    }
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [activeProfileId, connectionOk])

  const gpuLabel =
    gpu.state === 'busy' ? 'GPU 繁忙' : gpu.state === 'idle' ? 'GPU 空闲' : connectionOk ? 'GPU —' : null

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#1a1d27] bg-panel px-5">
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
        {gpuLabel ? (
          <div
            className={`flex items-center gap-2 rounded-lg border px-3 py-1 text-xs ${
              gpu.state === 'busy'
                ? 'border-warning/30 bg-warning/10 text-warning'
                : gpu.state === 'idle'
                  ? 'border-accent/30 bg-accent/10 text-accent'
                  : 'border-border bg-panel-elevated text-muted'
            }`}
            title={gpu.detail || undefined}
          >
            <Cpu className="h-3.5 w-3.5" />
            <span>
              {gpuLabel}
              {gpu.detail ? ` · ${gpu.detail}` : ''}
            </span>
          </div>
        ) : null}
        <button
          className="btn-ghost !px-2 !py-1 text-xs"
          onClick={() => checkConnection()}
          disabled={busy}
          title="重新检测连接（掉线时也会每 30 秒自动重试）"
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
