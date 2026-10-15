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
  }, [])

  const pending = useMemo(() => users.filter((u) => u.status === 'pending'), [users])
  const others = useMemo(() => users.filter((u) => u.status !== 'pending'), [users])

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
        <h2 className="text-sm font-medium text-muted">全部 · {others.length}</h2>
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
  return (
    <div className={`card flex flex-wrap items-start justify-between gap-3 p-4 ${props.busy ? 'opacity-70' : ''}`}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-text">
          {u.name || u.username}{' '}
          <span className="text-xs font-normal text-muted">@{u.username}</span>
        </p>
        <p className="mt-1 text-xs text-muted">
          {u.status} · {u.enabled ? '启用' : '禁用'} · 生成 {u.generate_today}/{u.daily_generate_limit}
          {u.api_key_prefix ? ` · Key ${u.api_key_prefix}…` : ''}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">{props.actions}</div>
    </div>
  )
}
