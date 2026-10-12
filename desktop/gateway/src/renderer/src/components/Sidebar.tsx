import {
  Activity,
  FileJson,
  Globe2,
  KeyRound,
  Landmark,
  LayoutDashboard,
  Library,
  ScrollText,
  Server,
  Settings,
  Users
} from 'lucide-react'
import type { NavPage } from '../stores/appStore'
import { useAppStore } from '../stores/appStore'

const items: { id: NavPage; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: '运行总览', icon: LayoutDashboard },
  { id: 'services', label: '服务管理', icon: Server },
  { id: 'users', label: '用户与监控', icon: Users },
  { id: 'showcase', label: '作品展馆', icon: Landmark },
  { id: 'prompts', label: '提示词库', icon: Library },
  { id: 'workflow', label: '工作流', icon: FileJson },
  { id: 'public', label: '公网入口', icon: Globe2 },
  { id: 'apikey', label: '访问密钥', icon: KeyRound },
  { id: 'logs', label: '日志与诊断', icon: ScrollText },
  { id: 'settings', label: '设置', icon: Settings }
]

export function Sidebar() {
  const page = useAppStore((s) => s.page)
  const setPage = useAppStore((s) => s.setPage)
  const status = useAppStore((s) => s.status)

  return (
    <aside className="flex w-[232px] shrink-0 flex-col border-r border-border bg-bg-deep">
      <div className="app-drag border-b border-border px-5 py-5">
        <div className="text-lg font-bold tracking-wide text-text">
          Comfy <span className="text-primary">Gateway</span>
        </div>
        <p className="mt-1 text-xs text-muted">服务端控制台</p>
      </div>
      <nav className="app-no-drag flex flex-1 flex-col gap-1 p-3">
        {items.map((item) => {
          const active = page === item.id
          const Icon = item.icon
          return (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                active
                  ? 'bg-primary/15 text-primary shadow-[inset_0_0_0_1px_rgba(139,92,246,0.35)]'
                  : 'text-muted hover:bg-panel-elevated hover:text-text'
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </button>
          )
        })}
      </nav>
      <div className="space-y-1 border-t border-border px-4 py-3 text-[11px] text-muted">
        <div className="flex items-center gap-1.5">
          <Activity className="h-3 w-3 text-accent" />
          v1.0.0 · 真实进程管理
        </div>
        <div className="truncate">
          {status?.config.apiHost}:{status?.config.apiPort ?? 8000}
        </div>
      </div>
    </aside>
  )
}
