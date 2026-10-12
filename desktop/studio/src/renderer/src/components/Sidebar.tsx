import {
  Cable,
  GalleryHorizontalEnd,
  Landmark,
  Library,
  ListTodo,
  PenLine,
  Settings
} from 'lucide-react'
import type { NavPage } from '../stores/appStore'
import { useAppStore } from '../stores/appStore'

const items: { id: NavPage; label: string; icon: typeof PenLine }[] = [
  { id: 'create', label: '开始创作', icon: PenLine },
  { id: 'queue', label: '任务队列', icon: ListTodo },
  { id: 'gallery', label: '作品画廊', icon: GalleryHorizontalEnd },
  { id: 'showcase', label: '作品展馆', icon: Landmark },
  { id: 'prompts', label: '提示词库', icon: Library },
  { id: 'connection', label: '账号管理', icon: Cable },
  { id: 'settings', label: '参数设置', icon: Settings }
]

export function Sidebar() {
  const page = useAppStore((s) => s.page)
  const setPage = useAppStore((s) => s.setPage)

  return (
    <aside className="flex w-[232px] shrink-0 flex-col bg-[#0e1016]">
      {/* Brand sits above the chrome lines so header/sidebar borders don't form a hard T */}
      <div className="flex h-14 shrink-0 items-center px-5">
        <div className="text-lg font-bold leading-none tracking-wide text-text">
          Comfy <span className="text-primary">Studio</span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col border-r border-[#1a1d27]">
        <nav className="flex flex-1 flex-col gap-1 p-3 pt-1">
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
      </div>
    </aside>
  )
}
