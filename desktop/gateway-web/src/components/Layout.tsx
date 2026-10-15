import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { LayoutDashboard, LogOut, Users } from 'lucide-react'
import { logoutSms } from '@/lib/api'

export function Layout({ username }: { username: string }) {
  const navigate = useNavigate()

  async function onLogout() {
    try {
      await logoutSms()
    } catch {
      /* ignore */
    }
    navigate('/login', { replace: true })
  }

  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <header className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-4">
          <p className="text-sm font-semibold">
            Comfy <span className="text-primary">Gateway</span>
          </p>
          <nav className="flex gap-1">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `btn-ghost !px-3 ${isActive ? '!bg-white/15 !text-text' : ''}`
              }
            >
              <LayoutDashboard className="h-4 w-4" />
              总览
            </NavLink>
            <NavLink
              to="/users"
              className={({ isActive }) =>
                `btn-ghost !px-3 ${isActive ? '!bg-white/15 !text-text' : ''}`
              }
            >
              <Users className="h-4 w-4" />
              用户
            </NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">{username}</span>
          <button type="button" className="btn-ghost" onClick={() => void onLogout()}>
            <LogOut className="h-4 w-4" />
            退出
          </button>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
