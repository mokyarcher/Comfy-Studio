import { useEffect, useState } from 'react'
import { GlassSwitch } from '@/components/GlassSwitch'
import { fetchLocalHold, fetchStats, setLocalHold, type AdminStats, type LocalHold } from '@/lib/api'

export function DashboardPage() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [hold, setHold] = useState<LocalHold | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function reload() {
    setError('')
    try {
      const [s, h] = await Promise.all([fetchStats(), fetchLocalHold()])
      setStats(s)
      setHold(h)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    }
  }

  useEffect(() => {
    void reload()
    const id = window.setInterval(() => void reload(), 12_000)
    return () => clearInterval(id)
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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">总览</h1>
        <button type="button" className="btn-ghost text-xs" onClick={() => void reload()}>
          刷新
        </button>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

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
