import { useState } from 'react'
import { ListTodo, RotateCcw, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { formatDateTime, formatElapsed, statusLabel } from '../lib/format'
import { useGenerate } from '../hooks/useGenerate'
import { useAppStore } from '../stores/appStore'

export function QueuePage() {
  const tasks = useAppStore((s) => s.tasks)
  const removeTask = useAppStore((s) => s.removeTask)
  const applyReuse = useAppStore((s) => s.applyReuse)
  const showToast = useAppStore((s) => s.showToast)
  const busy = useAppStore((s) => s.busy)
  const { run } = useGenerate()
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [retryId, setRetryId] = useState<string | null>(null)

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mb-5">
        <h1 className="page-title flex items-center gap-2">
          <ListTodo className="h-5 w-5 text-primary" />
          任务队列
        </h1>
      </div>

      {tasks.length === 0 ? (
        <div className="card flex h-64 items-center justify-center text-sm text-muted">暂无任务</div>
      ) : (
        <div className="space-y-3">
          {tasks.map((t) => {
            const elapsed =
              t.startedAt && (t.finishedAt || t.status === 'queued' || t.status === 'running' || t.status === 'submitting')
                ? (t.finishedAt ? new Date(t.finishedAt).getTime() : Date.now()) -
                  new Date(t.startedAt).getTime()
                : 0
            return (
              <div key={t.id} className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <StatusBadge status={t.status} />
                      <span className="font-mono text-[11px] text-muted">
                        {t.remoteTaskId ? `task ${t.remoteTaskId.slice(0, 8)}…` : '本地'}
                      </span>
                      <span className="text-[11px] text-muted">{formatDateTime(t.createdAt)}</span>
                    </div>
                    <p className="line-clamp-2 text-sm text-text">{t.prompt}</p>
                    <p className="mt-2 text-xs text-muted">
                      {t.width}×{t.height} · steps {t.steps}
                      {t.seed != null ? ` · seed ${t.seed}` : ' · seed 随机'}
                      {elapsed > 0 ? ` · 耗时 ${formatElapsed(elapsed)}` : ''}
                    </p>
                    {t.error && <p className="mt-2 text-xs text-danger">{t.error}</p>}
                  </div>
                  <div className="flex gap-2">
                    {(t.status === 'queued' || t.status === 'submitting' || t.status === 'waiting') && (
                      <button
                        className="btn-secondary !px-3 text-xs"
                        onClick={() => setConfirmId(t.id)}
                        title="仅移除本地记录"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        移除本地
                      </button>
                    )}
                    {t.status === 'failed' && (
                      <button
                        className="btn-primary !px-3 text-xs"
                        disabled={busy}
                        onClick={() => setRetryId(t.id)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        重试
                      </button>
                    )}
                    {(t.status === 'succeeded' || t.status === 'failed') && (
                      <button
                        className="btn-ghost !px-3 text-xs"
                        onClick={() => removeTask(t.id)}
                      >
                        删除记录
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmId)}
        title="移除本地记录？"
        message="仅删除本机记录，远端任务不会取消。"
        confirmText="移除"
        danger
        onCancel={() => setConfirmId(null)}
        onConfirm={() => {
          if (confirmId) removeTask(confirmId)
          setConfirmId(null)
          showToast('info', '已移除本地记录')
        }}
      />

      <ConfirmDialog
        open={Boolean(retryId)}
        title="重试？"
        message="将用相同参数重新提交。"
        confirmText="重试"
        onCancel={() => setRetryId(null)}
        onConfirm={() => {
          const t = tasks.find((x) => x.id === retryId)
          setRetryId(null)
          if (!t) return
          applyReuse({
            prompt: t.prompt,
            negativePrompt: t.negativePrompt,
            width: t.width,
            height: t.height,
            steps: t.steps,
            seed: t.seed
          })
          void run()
        }}
      />
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    waiting: 'bg-muted/20 text-muted',
    submitting: 'bg-primary/15 text-primary',
    queued: 'bg-warning/15 text-warning',
    running: 'bg-accent/15 text-accent',
    succeeded: 'bg-success/15 text-success',
    failed: 'bg-danger/15 text-danger',
    cancelled: 'bg-muted/20 text-muted'
  }
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs ${map[status] || 'bg-muted/20 text-muted'}`}>
      {statusLabel(status)}
    </span>
  )
}
