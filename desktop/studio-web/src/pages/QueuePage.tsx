import { useQueue } from '@/store/queue'

export function QueuePage() {
  const tasks = useQueue((s) => s.tasks)
  const remove = useQueue((s) => s.remove)
  const clearFinished = useQueue((s) => s.clearFinished)

  return (
    <div className="page space-y-4">
      <div className="page-header mb-0">
        <div>
          <h1 className="page-title">任务队列</h1>
          <p className="page-sub">无法取消远端 GPU 任务；移除仅删本地记录。</p>
        </div>
        <button type="button" className="btn-secondary text-xs" onClick={clearFinished}>
          清理已结束
        </button>
      </div>

      {!tasks.length ? (
        <div className="empty-state min-h-[16rem]">
          <p className="text-sm text-muted">暂无任务</p>
        </div>
      ) : (
        <ul className="grid gap-3 xl:grid-cols-2">
          {tasks.map((t) => (
            <li key={t.id} className="card flex gap-3 p-3.5 sm:p-4">
              {t.previewUrl ? (
                <img src={t.previewUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-bg text-[10px] text-muted">
                  无预览
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm text-text">{t.prompt}</p>
                <p className="mt-1.5 text-xs text-muted">
                  {t.mode} · {t.status}
                  {t.progressMessage ? ` · ${t.progressMessage}` : ''}
                  {t.remoteTaskId ? ` · ${t.remoteTaskId.slice(0, 8)}` : ''}
                </p>
                {t.error ? <p className="mt-1 text-xs text-danger">{t.error}</p> : null}
              </div>
              <button type="button" className="btn-ghost shrink-0 self-start text-xs" onClick={() => remove(t.id)}>
                移除
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
