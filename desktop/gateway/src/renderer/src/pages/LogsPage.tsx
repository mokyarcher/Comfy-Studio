import { useEffect, useMemo, useState } from 'react'
import { Copy, Trash2 } from 'lucide-react'
import type { LogSource } from '../../../shared/types'
import { useAppStore } from '../stores/appStore'

const tabs: { id: LogSource | 'all'; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'comfy', label: 'ComfyUI' },
  { id: 'api', label: 'API' },
  { id: 'frp', label: 'FRP' },
  { id: 'system', label: '系统' }
]

export function LogsPage() {
  const logs = useAppStore((s) => s.logs)
  const refreshLogs = useAppStore((s) => s.refreshLogs)
  const showToast = useAppStore((s) => s.showToast)
  const [tab, setTab] = useState<LogSource | 'all'>('all')
  const [query, setQuery] = useState('')

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshLogs(tab === 'all' ? undefined : tab)
    }, 1500)
    void refreshLogs(tab === 'all' ? undefined : tab)
    return () => window.clearInterval(timer)
  }, [tab, refreshLogs])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return logs.filter((l) => {
      if (tab !== 'all' && l.source !== tab) return false
      if (!q) return true
      return l.text.toLowerCase().includes(q) || l.source.includes(q)
    })
  }, [logs, tab, query])

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4">
      <div>
        <h1 className="page-title">日志与诊断</h1>
        <p className="page-desc">子进程 stdout/stderr 已脱敏（API_KEY / token 等）</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <input
          className="input ml-auto max-w-xs"
          placeholder="搜索日志…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className="btn-secondary"
          onClick={async () => {
            const text = filtered.map((l) => `[${l.ts}] [${l.source}] ${l.text}`).join('\n')
            await navigator.clipboard.writeText(text)
            showToast('success', `已复制 ${filtered.length} 行`)
          }}
        >
          <Copy className="h-4 w-4" />
          复制
        </button>
        <button
          className="btn-danger"
          onClick={async () => {
            await window.gateway.clearLogs(tab === 'all' ? undefined : tab)
            await refreshLogs(tab === 'all' ? undefined : tab)
            showToast('info', '已清空')
          }}
        >
          <Trash2 className="h-4 w-4" />
          清空
        </button>
      </div>

      <div className="card min-h-0 flex-1 overflow-auto p-3 font-mono text-xs">
        {filtered.length === 0 && <div className="p-4 text-muted">暂无日志</div>}
        {filtered.map((line) => (
          <div key={line.id} className="flex gap-3 border-b border-border/40 px-2 py-1.5 text-muted">
            <span className="w-20 shrink-0 text-muted/60">
              {new Date(line.ts).toLocaleTimeString()}
            </span>
            <span className="w-14 shrink-0 text-accent">[{line.source}]</span>
            <span
              className={`min-w-0 break-all ${
                line.stream === 'stderr' ? 'text-warning' : 'text-text/90'
              }`}
            >
              {line.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
