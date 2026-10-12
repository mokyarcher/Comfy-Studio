import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ListTodo, RotateCcw, Trash2, X } from 'lucide-react'
import type { LocalTask } from '../../../shared/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { PromptTranslateButton } from '../components/PromptTranslate'
import { formatDateTime, formatElapsed, modeLabel, statusLabel } from '../lib/format'
import { useGenerate } from '../hooks/useGenerate'
import { useAppStore } from '../stores/appStore'

function isActiveStatus(status: LocalTask['status']): boolean {
  return (
    status === 'waiting' ||
    status === 'submitting' ||
    status === 'queued' ||
    status === 'running'
  )
}

function taskElapsedMs(t: LocalTask): number {
  if (!t.startedAt) return 0
  if (
    !(
      t.finishedAt ||
      t.status === 'queued' ||
      t.status === 'running' ||
      t.status === 'submitting'
    )
  ) {
    return 0
  }
  return (
    (t.finishedAt ? new Date(t.finishedAt).getTime() : Date.now()) -
    new Date(t.startedAt).getTime()
  )
}

export function QueuePage() {
  const tasks = useAppStore((s) => s.tasks)
  const removeTask = useAppStore((s) => s.removeTask)
  const clearHistoryTasks = useAppStore((s) => s.clearHistoryTasks)
  const applyReuse = useAppStore((s) => s.applyReuse)
  const showToast = useAppStore((s) => s.showToast)
  const busy = useAppStore((s) => s.busy)
  const { run } = useGenerate()
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [retryId, setRetryId] = useState<string | null>(null)
  const [clearHistoryOpen, setClearHistoryOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  const { active, history } = useMemo(() => {
    const a: LocalTask[] = []
    const h: LocalTask[] = []
    for (const t of tasks) {
      if (isActiveStatus(t.status)) a.push(t)
      else h.push(t)
    }
    return { active: a, history: h }
  }, [tasks])

  const detail = detailId ? tasks.find((t) => t.id === detailId) ?? null : null

  useEffect(() => {
    if (!detail) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetailId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detail])

  const reuseTask = (t: LocalTask) => {
    applyReuse({
      prompt: t.prompt,
      negativePrompt: t.negativePrompt,
      width: t.width,
      height: t.height,
      steps: t.steps,
      seed: t.seed,
      mode: t.mode
    })
    showToast('info', '已填入创作参数')
  }

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
        <div className="space-y-8">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-text">进行中 · {active.length}</h2>
            </div>
            {active.length === 0 ? (
              <p className="text-sm text-muted">当前没有进行中的任务</p>
            ) : (
              <div className="space-y-3">
                {active.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    busy={busy}
                    onOpen={() => setDetailId(t.id)}
                    onRemoveLocal={() => setConfirmId(t.id)}
                    onRetry={() => setRetryId(t.id)}
                    onDelete={() => removeTask(t.id)}
                    onReuse={() => reuseTask(t)}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium text-text">历史 · {history.length}</h2>
              {history.length > 0 && (
                <button
                  className="btn-ghost !px-3 text-xs"
                  onClick={() => setClearHistoryOpen(true)}
                >
                  清空历史
                </button>
              )}
            </div>
            {history.length === 0 ? (
              <p className="text-sm text-muted">暂无历史记录</p>
            ) : (
              <div className="space-y-3">
                {history.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    busy={busy}
                    onOpen={() => setDetailId(t.id)}
                    onRemoveLocal={() => setConfirmId(t.id)}
                    onRetry={() => setRetryId(t.id)}
                    onDelete={() => removeTask(t.id)}
                    onReuse={() => reuseTask(t)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {detail && (
        <TaskDetailPanel
          task={detail}
          busy={busy}
          onClose={() => setDetailId(null)}
          onReuse={() => {
            reuseTask(detail)
            setDetailId(null)
          }}
          onRetry={() => {
            setDetailId(null)
            setRetryId(detail.id)
          }}
          onDelete={() => {
            removeTask(detail.id)
            setDetailId(null)
          }}
        />
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
            seed: t.seed,
            mode: t.mode
          })
          void run()
        }}
      />

      <ConfirmDialog
        open={clearHistoryOpen}
        title="清空历史？"
        message="将删除所有已完成 / 失败的本地记录，进行中的任务不受影响。"
        confirmText="清空"
        danger
        onCancel={() => setClearHistoryOpen(false)}
        onConfirm={() => {
          setClearHistoryOpen(false)
          void clearHistoryTasks().then(() => showToast('info', '已清空历史'))
        }}
      />
    </div>
  )
}

function TaskCard(props: {
  task: LocalTask
  busy: boolean
  onOpen: () => void
  onRemoveLocal: () => void
  onRetry: () => void
  onDelete: () => void
  onReuse: () => void
}) {
  const t = props.task
  const elapsed = taskElapsedMs(t)

  return (
    <div
      className="card cursor-pointer p-4 transition-colors hover:border-primary/40"
      role="button"
      tabIndex={0}
      onClick={props.onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          props.onOpen()
        }
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <StatusBadge status={t.status} />
            <span className="rounded-full bg-muted/15 px-2 py-0.5 text-[11px] text-muted">
              {modeLabel(t.mode)}
            </span>
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
        <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
          {(t.status === 'queued' || t.status === 'submitting' || t.status === 'waiting') && (
            <button
              className="btn-secondary !px-3 text-xs"
              onClick={props.onRemoveLocal}
              title="仅移除本地记录"
            >
              <Trash2 className="h-3.5 w-3.5" />
              移除本地
            </button>
          )}
          {t.status === 'failed' && (
            <button
              className="btn-primary !px-3 text-xs"
              disabled={props.busy}
              onClick={props.onRetry}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              重试
            </button>
          )}
          {(t.status === 'succeeded' || t.status === 'failed' || t.status === 'cancelled') && (
            <>
              <button className="btn-secondary !px-3 text-xs" onClick={props.onReuse}>
                复用参数
              </button>
              <button className="btn-ghost !px-3 text-xs" onClick={props.onDelete}>
                删除记录
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function TaskDetailPanel(props: {
  task: LocalTask
  busy: boolean
  onClose: () => void
  onReuse: () => void
  onRetry: () => void
  onDelete: () => void
}) {
  const t = props.task
  const elapsed = taskElapsedMs(t)
  const negative = t.negativePrompt?.trim()

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/70"
      onClick={props.onClose}
      role="presentation"
    >
      <div
        className="flex h-full w-full max-w-lg flex-col border-l border-border bg-panel shadow-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="任务详情"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="font-semibold">任务详情</h3>
          <button className="btn-ghost !p-1" onClick={props.onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={t.status} />
            <span className="rounded-full bg-muted/15 px-2 py-0.5 text-[11px] text-muted">
              {modeLabel(t.mode)}
            </span>
            <span className="text-[11px] text-muted">{formatDateTime(t.createdAt)}</span>
          </div>

          <DetailBlock label="正向提示词">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-text">{t.prompt}</p>
            <PromptTranslateButton text={t.prompt} className="mt-1.5" />
          </DetailBlock>

          <DetailBlock label="负向提示词">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-text">
              {negative || '（无）'}
            </p>
            {negative ? <PromptTranslateButton text={negative} className="mt-1.5" /> : null}
          </DetailBlock>

          <div className="grid grid-cols-2 gap-3">
            <DetailStat label="尺寸" value={`${t.width}×${t.height}`} />
            <DetailStat label="步数" value={String(t.steps)} />
            <DetailStat label="种子" value={t.seed != null ? String(t.seed) : '随机'} />
            <DetailStat
              label="耗时"
              value={elapsed > 0 ? formatElapsed(elapsed) : '—'}
            />
          </div>

          {t.error && (
            <DetailBlock label="错误">
              <p className="text-sm text-danger">{t.error}</p>
            </DetailBlock>
          )}

          {t.remoteTaskId && (
            <p className="font-mono text-[11px] text-muted">task {t.remoteTaskId}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-border p-4">
          {(t.status === 'succeeded' || t.status === 'failed' || t.status === 'cancelled') && (
            <>
              <button className="btn-secondary" onClick={props.onReuse}>
                复用参数
              </button>
              {t.status === 'failed' ? (
                <button className="btn-primary" disabled={props.busy} onClick={props.onRetry}>
                  重试
                </button>
              ) : (
                <button className="btn-ghost" onClick={props.onDelete}>
                  删除记录
                </button>
              )}
              {t.status === 'failed' && (
                <button className="btn-ghost col-span-2" onClick={props.onDelete}>
                  删除记录
                </button>
              )}
            </>
          )}
          {(t.status === 'queued' || t.status === 'submitting' || t.status === 'waiting') && (
            <button className="btn-secondary col-span-2" onClick={props.onClose}>
              关闭
            </button>
          )}
          {t.status === 'running' && (
            <button className="btn-secondary col-span-2" onClick={props.onClose}>
              关闭
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function DetailBlock(props: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs text-muted">{props.label}</p>
      {props.children}
    </div>
  )
}

function DetailStat(props: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg px-3 py-2.5">
      <p className="text-[11px] text-muted">{props.label}</p>
      <p className="mt-1 break-all font-mono text-sm text-text">{props.value}</p>
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
