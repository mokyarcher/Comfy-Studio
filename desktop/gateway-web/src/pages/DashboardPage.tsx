import { useEffect, useState } from 'react'
import { GlassSwitch } from '@/components/GlassSwitch'
import {
  fetchHostServices,
  fetchLocalHold,
  fetchStats,
  hostServiceAction,
  setLocalHold,
  type AdminStats,
  type HostServiceAction,
  type HostServiceItem,
  type LocalHold
} from '@/lib/api'

type PendingAction = {
  service: 'comfy' | 'api' | 'frp' | 'lhm'
  action: HostServiceAction
  title: string
  hint?: string
}

export function DashboardPage() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [hold, setHold] = useState<LocalHold | null>(null)
  const [services, setServices] = useState<HostServiceItem[]>([])
  const [servicesEnabled, setServicesEnabled] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionBusy, setActionBusy] = useState('')
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [totp, setTotp] = useState('')

  async function reload() {
    setError('')
    try {
      const [s, h, hs] = await Promise.all([
        fetchStats(),
        fetchLocalHold(),
        fetchHostServices().catch(() => null)
      ])
      setStats(s)
      setHold(h)
      if (hs) {
        setServices(hs.services)
        setServicesEnabled(hs.enabled)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    }
  }

  useEffect(() => {
    void reload()
    const id = window.setInterval(() => void reload(), 12_000)
    return () => window.clearInterval(id)
  }, [])

  async function onHold(next: boolean) {
    setBusy(true)
    setError('')
    try {
      const h = await setLocalHold(next, next ? 3600 : null)
      setHold(h)
      const s = await fetchStats()
      setStats(s)
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  function requestAction(next: PendingAction) {
    setError('')
    setTotp('')
    setPending(next)
  }

  async function confirmAction() {
    if (!pending) return
    const code = totp.trim()
    if (!/^\d{6}$/.test(code)) {
      setError('请输入 6 位动态码')
      return
    }
    const { service, action } = pending
    const key = `${service}:${action}`
    setActionBusy(key)
    setError('')
    try {
      const res = await hostServiceAction(service, action, code)
      setServices(res.services)
      setPending(null)
      setTotp('')
      if (!res.ok) setError(res.message)
      if (service === 'api' && action === 'restart' && res.ok) {
        setError('')
        window.setTimeout(() => void reload(), 4000)
      } else {
        void reload()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setActionBusy('')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">总览</h1>
        <button type="button" className="btn-ghost text-xs" onClick={() => void reload()}>
          刷新
        </button>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <section className="card space-y-3 p-5">
        <div>
          <h2 className="text-sm font-medium">本机服务</h2>
          <p className="mt-1 text-xs text-muted">
            启停需再次输入 Authenticator 六位动态码。停 FRP 或重启 API 会短暂断开公网。
          </p>
        </div>
        {!servicesEnabled ? (
          <p className="text-xs text-warning">HOST_SERVICES_ENABLED=false，远程启停已关闭</p>
        ) : null}
        <div className="grid gap-3 lg:grid-cols-3">
          {services.length === 0 ? (
            <p className="text-xs text-muted">暂无服务状态（需升级并重启本机 API）</p>
          ) : (
            services.map((svc) => (
              <ServiceCard
                key={svc.id}
                svc={svc}
                disabled={!servicesEnabled || Boolean(actionBusy) || Boolean(pending)}
                busyKey={actionBusy}
                onAction={requestAction}
              />
            ))
          )}
        </div>
      </section>

      <section className="card p-5">
        <GlassSwitch
          label="本地占用 GPU（远程任务暂停）"
          checked={Boolean(hold?.held)}
          disabled={busy}
          onChange={(v) => void onHold(v)}
        />
        {hold?.expires_at ? (
          <p className="mt-2 text-xs text-muted">到期 {new Date(hold.expires_at).toLocaleString('zh-CN')}</p>
        ) : null}
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="排队" value={stats?.queue_queued ?? '—'} />
        <StatCard label="运行中" value={stats?.queue_running ?? '—'} />
        <StatCard label="待审用户" value={stats?.pending_users ?? '—'} />
        <StatCard label="名额剩余" value={stats?.pool_remaining ?? '—'} />
        <StatCard label="今日生成" value={stats?.generate_today ?? '—'} />
        <StatCard label="今日润色" value={stats?.polish_today ?? '—'} />
        <StatCard label="在线用户" value={stats?.active_users_15m ?? '—'} />
        <StatCard label="用户总数" value={stats?.users_total ?? '—'} />
      </div>

      {pending ? (
        <TotpModal
          title={pending.title}
          hint={pending.hint}
          totp={totp}
          busy={Boolean(actionBusy)}
          onTotp={setTotp}
          onCancel={() => {
            setPending(null)
            setTotp('')
          }}
          onConfirm={() => void confirmAction()}
        />
      ) : null}
    </div>
  )
}

function TotpModal({
  title,
  hint,
  totp,
  busy,
  onTotp,
  onCancel,
  onConfirm
}: {
  title: string
  hint?: string
  totp: string
  busy: boolean
  onTotp: (v: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="二次校验"
      onClick={onCancel}
    >
      <div
        className="card w-full max-w-sm space-y-4 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="mt-1 text-xs text-muted">请输入 Authenticator 当前 6 位动态码确认操作</p>
          {hint ? <p className="mt-2 text-xs text-warning">{hint}</p> : null}
        </div>
        <div>
          <label className="label">动态码</label>
          <input
            className="input font-mono tracking-[0.35em]"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            placeholder="••••••"
            value={totp}
            onChange={(e) => onTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onConfirm()
            }}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost text-sm" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn-primary text-sm" disabled={busy} onClick={onConfirm}>
            {busy ? '提交中…' : '确认'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ServiceCard({
  svc,
  disabled,
  busyKey,
  onAction
}: {
  svc: HostServiceItem
  disabled: boolean
  busyKey: string
  onAction: (next: PendingAction) => void
}) {
  const id = svc.id as 'comfy' | 'api' | 'frp' | 'lhm'
  const stateColor = svc.ok ? 'text-success' : svc.state === 'starting' ? 'text-warning' : 'text-danger'

  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{svc.label}</p>
          <p className={`mt-0.5 text-sm ${stateColor}`}>
            {svc.ok ? '在线' : svc.state === 'starting' ? '启动中' : '离线'}
          </p>
        </div>
        {svc.pid != null ? <span className="text-[11px] text-muted">PID {svc.pid}</span> : null}
      </div>
      <p className="mt-2 truncate text-[11px] text-muted" title={svc.detail}>
        {svc.detail || '—'}
      </p>
      <p className="mt-1 line-clamp-2 text-[11px] text-muted/80">{svc.message}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {id === 'api' ? (
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={disabled}
            onClick={() =>
              onAction({
                service: 'api',
                action: 'restart',
                title: '重启 FastAPI',
                hint: '公网入口会短暂断开，约数秒后恢复。'
              })
            }
          >
            {busyKey === 'api:restart' ? '重启中…' : '重启'}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn-primary text-xs"
              disabled={disabled || !svc.configured}
              onClick={() =>
                onAction({
                  service: id,
                  action: 'start',
                  title: `启动 ${svc.label}`
                })
              }
            >
              {busyKey === `${id}:start` ? '启动中…' : '启动'}
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={disabled}
              onClick={() =>
                onAction({
                  service: id,
                  action: 'stop',
                  title: `停止 ${svc.label}`,
                  hint: id === 'frp' ? '停止后公网入口将不可达。' : undefined
                })
              }
            >
              {busyKey === `${id}:stop` ? '停止中…' : '停止'}
            </button>
            {id === 'comfy' ? (
              <button
                type="button"
                className="btn-ghost text-xs text-danger"
                disabled={disabled}
                onClick={() =>
                  onAction({
                    service: 'comfy',
                    action: 'force_stop',
                    title: '强制停止 ComfyUI',
                    hint: '将结束占用 8188 的进程。'
                  })
                }
              >
                强制停止
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}
