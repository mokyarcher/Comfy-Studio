import { useQueue } from '@/store/queue'

export function QueuePage() {
  const tasks = useQueue((s) => s.tasks)
  const remove = useQueue((s) => s.remove)
  const clearFinished = useQueue((s) => s.clearFinished)

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-medium text-text">任务队列</h1>
        <button type="button" className="btn-secondary text-xs" onClick={clearFinished}>
          清理已结束
        </button>
      </div>
      {!tasks.length ? (
        <p className="text-sm text-muted">暂无任务。记录保存在本会话，刷新后可能保留。</p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((t) => (
            <li key={t.id} className="card flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm text-text">{t.prompt}</p>
                <p className="mt-1 text-xs text-muted">
                  {t.mode} · {t.status}
                  {t.progressMessage ? ` · ${t.progressMessage}` : ''}
                  {t.remoteTaskId ? ` · ${t.remoteTaskId.slice(0, 8)}` : ''}
                </p>
                {t.error ? <p className="mt-1 text-xs text-danger">{t.error}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {t.previewUrl ? (
                  <img src={t.previewUrl} alt="" className="h-14 w-14 rounded object-cover" />
                ) : null}
                <button type="button" className="btn-ghost text-xs" onClick={() => remove(t.id)}>
                  移除本地
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-muted">无法取消远端 GPU 任务；移除仅删本地记录。</p>
    </div>
  )
}
