import { useCallback, useEffect, useState } from 'react'
import { Globe2, Monitor, Play, Square, Cpu, Server, Waypoints } from 'lucide-react'
import { StatusCard } from '../components/StatusCard'
import { useAppStore } from '../stores/appStore'

type HoldState = {
  held: boolean
  message: string
  expires_at?: string | null
}

const TTL_OPTIONS: Array<{ label: string; seconds: number | null }> = [
  { label: '手动解除', seconds: null },
  { label: '30 分钟', seconds: 30 * 60 },
  { label: '1 小时', seconds: 60 * 60 },
  { label: '2 小时', seconds: 2 * 60 * 60 }
]

function formatExpires(iso?: string | null): string {
  if (!iso) return '直到手动解除'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return `至 ${new Date(t).toLocaleString()}`
}

export function OverviewPage() {
  const status = useAppStore((s) => s.status)
  const logs = useAppStore((s) => s.logs)
  const busy = useAppStore((s) => s.busy)
  const runAction = useAppStore((s) => s.runAction)
  const setPage = useAppStore((s) => s.setPage)
  const showToast = useAppStore((s) => s.showToast)
  const cfg = status?.config

  const [hold, setHold] = useState<HoldState | null>(null)
  const [holdError, setHoldError] = useState('')
  const [holdBusy, setHoldBusy] = useState(false)
  const [ttlSeconds, setTtlSeconds] = useState<number | null>(60 * 60)

  const refreshHold = useCallback(async () => {
    const res = await window.gateway.adminGetLocalHold()
    if (!res.ok || !res.hold) {
      setHold(null)
      setHoldError(res.message || '无法读取占用状态')
      return
    }
    setHoldError('')
    setHold(res.hold)
  }, [])

  useEffect(() => {
    void refreshHold()
    const id = window.setInterval(() => void refreshHold(), 15_000)
    return () => window.clearInterval(id)
  }, [refreshHold])

  const toggleHold = async (nextHeld: boolean) => {
    setHoldBusy(true)
    try {
      const res = await window.gateway.adminSetLocalHold(
        nextHeld
          ? {
              held: true,
              ttl_seconds: ttlSeconds,
              message: '本机占用中，服务端正在本地使用 ComfyUI，请稍后再试'
            }
          : { held: false }
      )
      if (!res.ok || !res.hold) {
        showToast('error', res.message)
        return
      }
      setHold(res.hold)
      setHoldError('')
      showToast('success', res.message)
    } finally {
      setHoldBusy(false)
    }
  }

  const held = Boolean(hold?.held)

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">运行总览</h1>
          <p className="page-desc">一览 ComfyUI、本地 API、FRP 与公网入口状态</p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => void runAction(() => window.gateway.startAll(), '已启动全部服务')}
          >
            <Play className="h-4 w-4" />
            启动全部
          </button>
          <button
            className="btn-danger"
            disabled={busy}
            onClick={() => void runAction(() => window.gateway.stopAll(), '已停止本应用启动的服务')}
          >
            <Square className="h-4 w-4" />
            停止全部
          </button>
        </div>
      </div>

      <div
        className={`card flex flex-wrap items-center justify-between gap-4 p-4 ${
          held ? 'border-warning/40 bg-warning/5' : ''
        }`}
      >
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              held ? 'bg-warning/15 text-warning' : 'bg-panel-elevated text-muted'
            }`}
          >
            <Monitor className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="font-medium text-text">本机占用</h2>
            <p className="mt-1 text-xs text-muted">
              开启后远端客户端无法新提交生图，已排队任务也会暂停下发到 ComfyUI，方便你本机桌面操作。
            </p>
            {holdError ? (
              <p className="mt-2 text-xs text-danger">{holdError}</p>
            ) : held ? (
              <p className="mt-2 text-xs text-warning">
                当前占用中 · {formatExpires(hold?.expires_at)}
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted">当前空闲，远端可正常生图</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!held && (
            <select
              className="input !w-36 !py-1.5 text-xs"
              value={ttlSeconds == null ? 'manual' : String(ttlSeconds)}
              onChange={(e) => {
                const v = e.target.value
                setTtlSeconds(v === 'manual' ? null : Number(v))
              }}
              disabled={holdBusy}
            >
              {TTL_OPTIONS.map((o) => (
                <option key={o.label} value={o.seconds == null ? 'manual' : String(o.seconds)}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          <button
            className={held ? 'btn-secondary' : 'btn-primary'}
            disabled={holdBusy || Boolean(holdError && !hold)}
            onClick={() => void toggleHold(!held)}
          >
            {holdBusy ? '处理中…' : held ? '解除占用' : '开启占用'}
          </button>
          <button className="btn-ghost text-xs" disabled={holdBusy} onClick={() => void refreshHold()}>
            刷新
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatusCard
          title="ComfyUI"
          icon={Cpu}
          probe={status?.comfy}
          detail={cfg?.comfyUrl || '未配置'}
          actions={
            <>
              <button
                className="btn-secondary"
                onClick={() =>
                  void runAction(() =>
                    window.gateway.testComfy().then((r) => ({ ok: r.ok, message: r.message }))
                  )
                }
              >
                检测
              </button>
              <button className="btn-ghost" onClick={() => setPage('workflow')}>
                工作流
              </button>
            </>
          }
        />
        <StatusCard
          title="FastAPI"
          icon={Server}
          runtime={status?.api}
          probe={status?.localApi}
          detail={`http://${cfg?.apiHost ?? '127.0.0.1'}:${cfg?.apiPort ?? 8000}`}
          actions={
            <>
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() => void runAction(() => window.gateway.startApi())}
              >
                启动
              </button>
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => void runAction(() => window.gateway.stopApi())}
              >
                停止
              </button>
            </>
          }
        />
        <StatusCard
          title="FRP 客户端"
          icon={Waypoints}
          runtime={status?.frp}
          detail={cfg?.frpcPath || '未配置 frpc.exe'}
          actions={
            <>
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() => void runAction(() => window.gateway.startFrp())}
              >
                启动
              </button>
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => void runAction(() => window.gateway.stopFrp())}
              >
                停止
              </button>
            </>
          }
        />
        <StatusCard
          title="公网 API"
          icon={Globe2}
          probe={status?.publicApi}
          detail={cfg?.publicBaseUrl || '未配置'}
          actions={
            <>
              <button
                className="btn-accent"
                onClick={() =>
                  void runAction(() =>
                    window.gateway.testPublicApi().then((r) => ({ ok: r.ok, message: r.message }))
                  )
                }
              >
                测试
              </button>
              <button className="btn-ghost" onClick={() => setPage('public')}>
                详情
              </button>
            </>
          }
        />
      </div>

      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium text-text">最近事件</h2>
          <button className="btn-ghost text-xs" onClick={() => setPage('logs')}>
            查看全部
          </button>
        </div>
        <div className="max-h-64 space-y-1 overflow-auto font-mono text-xs">
          {logs.slice(-10).reverse().map((line) => (
            <div key={line.id} className="flex gap-3 text-muted">
              <span className="shrink-0 text-muted/60">{new Date(line.ts).toLocaleTimeString()}</span>
              <span className="shrink-0 text-accent">[{line.source}]</span>
              <span className="min-w-0 break-all text-text/90">{line.text}</span>
            </div>
          ))}
          {logs.length === 0 && <div className="text-muted">暂无日志</div>}
        </div>
      </div>
    </div>
  )
}
