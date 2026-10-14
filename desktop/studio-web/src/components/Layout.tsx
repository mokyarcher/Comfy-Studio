import { NavLink, Outlet } from 'react-router-dom'
import {
  Clapperboard,
  FolderHeart,
  Images,
  Library,
  ListOrdered,
  LogOut,
  Settings,
  Sparkles,
  Wand2
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { fetchGpuStatus, testConnection } from '@/lib/api'
import { useSession } from '@/store/session'
import { ToastHost } from './ToastHost'

const nav = [
  { to: '/create', label: '开始创作', icon: Wand2 },
  { to: '/queue', label: '任务队列', icon: ListOrdered },
  { to: '/gallery', label: '作品画廊', icon: Images },
  { to: '/showcase', label: '作品展馆', icon: Clapperboard },
  { to: '/prompts', label: '提示词库', icon: Library },
  { to: '/settings', label: '参数设置', icon: Settings }
]

export function Layout() {
  const user = useSession((s) => s.user)!
  const logout = useSession((s) => s.logout)
  const [gpu, setGpu] = useState('—')
  const [health, setHealth] = useState('检测中…')
  const [bgHint, setBgHint] = useState(false)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      const [h, g] = await Promise.all([
        testConnection({ timeoutMs: 10_000 }),
        fetchGpuStatus({ apiKey: user.apiKey })
      ])
      if (!alive) return
      setHealth(h.ok ? `已连接 · ${h.latencyMs} ms` : h.message)
      setGpu(g.ok ? (g.state === 'idle' ? 'GPU 空闲' : 'GPU 繁忙') : g.message)
    }
    tick()
    const id = window.setInterval(tick, 12_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [user.apiKey])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') setBgHint(true)
      else setBgHint(false)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-panel">
        <div className="flex items-center gap-2 border-b border-border px-4 py-4">
          <Sparkles className="h-5 w-5 text-primary" />
          <div>
            <p className="text-sm font-semibold text-text">
              Comfy <span className="text-primary">Studio</span>
            </p>
            <p className="text-[11px] text-muted">Web 工作空间</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition ${
                  isActive
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted hover:bg-panel-elevated hover:text-text'
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-border p-3">
          <div className="mb-2 flex items-center gap-2 text-xs text-muted">
            <FolderHeart className="h-3.5 w-3.5" />
            <span className="truncate">{user.name || user.username}</span>
          </div>
          <button type="button" className="btn-ghost w-full justify-start px-2" onClick={logout}>
            <LogOut className="h-4 w-4" />
            退出登录
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-panel px-4 py-2.5 text-xs text-muted">
          <span className="rounded-full border border-border bg-bg px-2.5 py-1">{health}</span>
          <span className="rounded-full border border-border bg-bg px-2.5 py-1">{gpu}</span>
          {bgHint ? (
            <span className="rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-warning">
              标签页在后台时轮询可能变慢
            </span>
          ) : null}
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
      <ToastHost />
    </div>
  )
}
