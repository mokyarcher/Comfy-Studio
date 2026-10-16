import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  approveUser,
  deleteUser,
  listUsers,
  patchUser,
  rejectUser,
  resetPassword,
  type AdminUser
} from '@/lib/api'

/** Match API ACTIVE_USER_WINDOW_MINUTES default. */
const ONLINE_WINDOW_MS = 15 * 60 * 1000

function isOnline(user: AdminUser): boolean {
  if (!user.last_seen_at || !user.enabled || user.status !== 'active') return false
  const t = Date.parse(user.last_seen_at)
  if (Number.isNaN(t)) return false
  return Date.now() - t <= ONLINE_WINDOW_MS
}

function formatSeen(iso?: string | null): string {
  if (!iso) return '从未上线'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const diff = Date.now() - t
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  return new Date(t).toLocaleString('zh-CN')
}

export function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [error, setError] = useState('')
  const [tempPw, setTempPw] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function reload() {
    setError('')
    try {
      setUsers(await listUsers())
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    }
  }

  useEffect(() => {
    void reload()
    const id = window.setInterval(() => void reload(), 15_000)
    return () => window.clearInterval(id)
  }, [])

  const pending = useMemo(() => users.filter((u) => u.status === 'pending'), [users])
  const others = useMemo(() => users.filter((u) => u.status !== 'pending'), [users])
  const onlineCount = useMemo(() => others.filter(isOnline).length, [others])

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusyId(id)
    setError('')
    try {
      await fn()
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">用户</h1>
        <button type="button" className="btn-ghost text-xs" onClick={() => void reload()}>
          刷新
        </button>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {tempPw ? (
        <div className="card border border-warning/30 p-4 text-sm">
          <p className="text-warning">临时密码（只显示一次）</p>
          <p className="mt-1 font-mono text-text">{tempPw}</p>
          <button type="button" className="btn-ghost mt-2 text-xs" onClick={() => setTempPw(null)}>
            关闭
          </button>
        </div>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">待审 · {pending.length}</h2>
        {!pending.length ? <p className="text-sm text-muted">暂无待审</p> : null}
        {pending.map((u) => (
          <UserCard
            key={u.id}
            user={u}
            busy={busyId === u.id}
            actions={
              <>
                <button
                  type="button"
                  className="btn-primary !py-1.5 text-xs"
                  disabled={busyId === u.id}
                  onClick={() => void run(u.id, () => approveUser(u.id))}
                >
                  通过
                </button>
                <button
                  type="button"
                  className="btn-danger !py-1.5 text-xs"
                  disabled={busyId === u.id}
                  onClick={() => void run(u.id, () => rejectUser(u.id))}
                >
                  拒绝
                </button>
                <button
                  type="button"
                  className="btn-ghost !py-1.5 text-xs text-danger"
                  disabled={busyId === u.id}
                  onClick={() => {
                    const label = u.username || u.name || u.id
                    if (
                      !window.confirm(
                        `确定注销用户 ${label}？将永久删除账号及相关数据，不可恢复。`
                      )
                    ) {
                      return
                    }
                    void run(u.id, () => deleteUser(u.id))
                  }}
                >
                  注销
                </button>
              </>
            }
          />
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">
          全部 · {others.length}
          <span className="ml-2 font-normal text-success">在线 {onlineCount}</span>
        </h2>
        {others.map((u) => (
          <UserCard
            key={u.id}
            user={u}
            busy={busyId === u.id}
            actions={
              u.is_admin ? (
                <span className="text-xs text-muted">管理员</span>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn-secondary !py-1.5 text-xs"
                    disabled={busyId === u.id}
                    onClick={() =>
                      void run(u.id, () => patchUser(u.id, { enabled: !u.enabled }))
                    }
                  >
                    {u.enabled ? '禁用' : '启用'}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost !py-1.5 text-xs"
                    disabled={busyId === u.id}
                    onClick={() =>
                      void run(u.id, async () => {
                        const r = await resetPassword(u.id)
                        setTempPw(r.temporary_password)
                      })
                    }
                  >
                    重置密码
                  </button>
                  <button
                    type="button"
                    className="btn-danger !py-1.5 text-xs"
                    disabled={busyId === u.id}
                    onClick={() => {
                      const label = u.username || u.name || u.id
                      if (
                        !window.confirm(
                          `确定注销用户 ${label}？将永久删除账号及云端画廊、展馆、共享提示词等数据，不可恢复。`
                        )
                      ) {
                        return
                      }
                      void run(u.id, () => deleteUser(u.id))
                    }}
                  >
                    注销
                  </button>
                </>
              )
            }
          />
        ))}
      </section>
    </div>
  )
}

function UserCard(props: {
  user: AdminUser
  busy: boolean
  actions: ReactNode
}) {
  const u = props.user
  const online = isOnline(u)

  return (
    <div className={`card flex flex-wrap items-start justify-between gap-3 p-4 ${props.busy ? 'opacity-70' : ''}`}>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">
          <span>
            {u.name || u.username}{' '}
            <span className="text-xs font-normal text-muted">@{u.username}</span>
          </span>
          {u.status === 'active' ? (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-normal ${
                online
                  ? 'bg-success/15 text-success'
                  : 'bg-white/5 text-muted'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-success' : 'bg-muted'}`}
                aria-hidden
              />
              {online ? '在线' : '离线'}
            </span>
          ) : null}
        </p>
        <p className="mt-1 text-xs text-muted">
          {u.status} · {u.enabled ? '启用' : '禁用'} · 生成 {u.generate_today}/{u.daily_generate_limit}
          {u.api_key_prefix ? ` · Key ${u.api_key_prefix}…` : ''}
          {u.status === 'active' ? ` · ${formatSeen(u.last_seen_at)}` : ''}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">{props.actions}</div>
    </div>
  )
}
