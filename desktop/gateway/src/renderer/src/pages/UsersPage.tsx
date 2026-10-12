import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Users } from 'lucide-react'
import { useAppStore } from '../stores/appStore'

interface AdminStats {
  queue_open: number
  queue_queued: number
  queue_running: number
  max_queue_size: number
  generate_today: number
  polish_today: number
  active_users_15m: number
  users_total: number
  users_enabled: number
  polish_enabled: boolean
  pending_users?: number
  pool_remaining?: number
  max_approved_users?: number
  approved_users?: number
}

interface AdminUser {
  id: string
  name: string
  username?: string
  status?: string
  api_key_prefix: string
  enabled: boolean
  is_admin: boolean
  daily_generate_limit: number
  daily_polish_limit: number
  generate_today: number
  polish_today: number
  note: string
  created_at: string
  last_seen_at?: string | null
}

const statusLabel: Record<string, string> = {
  pending: '待审核',
  active: '已通过',
  rejected: '已拒绝',
  disabled: '已禁用'
}

export function UsersPage() {
  const showToast = useAppStore((s) => s.showToast)
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tempPassword, setTempPassword] = useState<{
    username: string
    password: string
  } | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [st, us] = await Promise.all([
        window.gateway.adminStats(),
        window.gateway.adminListUsers()
      ])
      if (!st.ok) {
        setError(st.message)
        setStats(null)
      } else {
        setStats(st.stats ?? null)
      }
      if (!us.ok) {
        setError((prev) => prev || us.message)
      } else {
        setUsers(us.users ?? [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), 5000)
    return () => window.clearInterval(id)
  }, [refresh])

  const pending = useMemo(() => users.filter((u) => u.status === 'pending'), [users])
  const others = useMemo(() => users.filter((u) => u.status !== 'pending'), [users])

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            用户与监控
          </h1>
          <p className="page-desc">
            用户在 Studio 自行注册后出现在待审列表。通过后自动分配 API Key（占用名额）；用户再登录即可使用。
          </p>
        </div>
        <button className="btn-secondary" disabled={loading} onClick={() => void refresh()}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {tempPassword && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <p className="font-medium text-warning">
            已为 {tempPassword.username} 重置密码（请立即复制发给对方，只显示一次）
          </p>
          <code className="mt-2 block break-all font-mono text-text">{tempPassword.password}</code>
          <button
            className="btn-secondary mt-3"
            onClick={async () => {
              await navigator.clipboard.writeText(tempPassword.password)
              showToast('success', '已复制临时密码')
            }}
          >
            复制密码
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          {
            label: '名额剩余/上限',
            value: stats
              ? `${stats.pool_remaining ?? '—'} / ${stats.max_approved_users ?? '—'}`
              : '—'
          },
          { label: '待审核', value: stats ? String(stats.pending_users ?? pending.length) : '—' },
          { label: '已批准用户', value: stats ? String(stats.approved_users ?? '—') : '—' },
          {
            label: '队列中/运行中',
            value: stats ? `${stats.queue_queued} / ${stats.queue_running}` : '—'
          },
          { label: '今日生图', value: stats ? String(stats.generate_today) : '—' },
          { label: '今日润色', value: stats ? String(stats.polish_today) : '—' },
          { label: '近15分钟活跃', value: stats ? String(stats.active_users_15m) : '—' },
          { label: '润色代理', value: stats ? (stats.polish_enabled ? '已开启' : '关闭') : '—' }
        ].map((c) => (
          <div key={c.label} className="card p-4">
            <div className="text-xs text-muted">{c.label}</div>
            <div className="mt-1 text-xl font-semibold text-text">{c.value}</div>
          </div>
        ))}
      </div>

      <section className="card overflow-hidden">
        <div className="border-b border-border px-5 py-3 text-sm font-semibold">待审核</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="bg-panel-elevated text-muted">
              <tr>
                <th className="px-3 py-2">用户名</th>
                <th className="px-3 py-2">显示名</th>
                <th className="px-3 py-2">注册时间</th>
                <th className="px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((u) => (
                <tr key={u.id} className="border-t border-border/70">
                  <td className="px-3 py-2 font-mono">{u.username || '—'}</td>
                  <td className="px-3 py-2">{u.name}</td>
                  <td className="px-3 py-2 text-muted">{u.created_at}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <button
                        className="btn-primary !px-2 !py-1 text-[11px]"
                        onClick={async () => {
                          const res = await window.gateway.adminApproveUser(u.id)
                          showToast(res.ok ? 'success' : 'error', res.message)
                          void refresh()
                        }}
                      >
                        通过
                      </button>
                      <button
                        className="btn-ghost !px-2 !py-1 text-[11px]"
                        onClick={async () => {
                          const res = await window.gateway.adminRejectUser(u.id)
                          showToast(res.ok ? 'success' : 'error', res.message)
                          void refresh()
                        }}
                      >
                        拒绝
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {pending.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-muted">
                    暂无待审用户
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-border px-5 py-3 text-sm font-semibold">全部用户</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-left text-xs">
            <thead className="bg-panel-elevated text-muted">
              <tr>
                <th className="px-3 py-2">用户名</th>
                <th className="px-3 py-2">状态</th>
                <th className="px-3 py-2">Key前缀</th>
                <th className="px-3 py-2">今日生图</th>
                <th className="px-3 py-2">今日润色</th>
                <th className="px-3 py-2">最近活跃</th>
                <th className="px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {others.map((u) => (
                <tr key={u.id} className="border-t border-border/70">
                  <td className="px-3 py-2">
                    <div className="font-mono">{u.username || u.name}</div>
                    {u.is_admin ? <div className="text-[10px] text-primary">管理员</div> : null}
                  </td>
                  <td className="px-3 py-2">{statusLabel[u.status || ''] || u.status || '—'}</td>
                  <td className="px-3 py-2 font-mono">
                    {u.api_key_prefix ? `${u.api_key_prefix}…` : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {u.generate_today}/{u.daily_generate_limit || '∞'}
                  </td>
                  <td className="px-3 py-2">
                    {u.polish_today}/{u.daily_polish_limit || '∞'}
                  </td>
                  <td className="px-3 py-2 text-muted">{u.last_seen_at || '—'}</td>
                  <td className="px-3 py-2">
                    {!u.is_admin && (
                      <div className="flex flex-wrap gap-1">
                        {(u.status === 'active' || u.status === 'pending') && (
                          <button
                            className="btn-ghost !px-2 !py-1 text-[11px]"
                            onClick={async () => {
                              if (!window.confirm(`确定重置用户 ${u.username || u.name} 的密码？`)) {
                                return
                              }
                              const res = await window.gateway.adminResetPassword(u.id)
                              if (res.ok && res.temporaryPassword) {
                                setTempPassword({
                                  username: res.username || u.username || u.name,
                                  password: res.temporaryPassword
                                })
                                showToast('success', res.message)
                              } else {
                                showToast('error', res.message)
                              }
                            }}
                          >
                            重置密码
                          </button>
                        )}
                        {u.status === 'active' && (
                          <>
                            <button
                              className="btn-ghost !px-2 !py-1 text-[11px]"
                              onClick={async () => {
                                const res = await window.gateway.adminPatchUser(u.id, {
                                  enabled: !u.enabled
                                })
                                showToast(res.ok ? 'success' : 'error', res.message)
                                void refresh()
                              }}
                            >
                              {u.enabled ? '禁用' : '启用'}
                            </button>
                            <button
                              className="btn-ghost !px-2 !py-1 text-[11px]"
                              onClick={async () => {
                                const res = await window.gateway.adminRotateKey(u.id)
                                showToast(res.ok ? 'success' : 'error', res.message)
                                void refresh()
                              }}
                            >
                              轮换Key
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {others.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted">
                    暂无用户。启动 API 后会导入 .env 管理员；普通用户请走 Studio 注册。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
