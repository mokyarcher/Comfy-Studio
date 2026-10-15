import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ImageIcon, X } from 'lucide-react'
import { PromptTranslateButton } from '@/components/PromptTranslateButton'
import { formatDateTime, formatElapsed, modeLabel, statusLabel } from '@/lib/format'
import type { LocalTask } from '@/lib/types'
import { useQueue } from '@/store/queue'
import { useToast } from '@/store/toast'

function isActiveStatus(status: LocalTask['status']): boolean {
  return (
    status === 'waiting' ||
    status === 'submitting' ||
    status === 'queued' ||
    status === 'running'
  )
}

function taskElapsedMs(t: LocalTask): number {
  const start = Date.parse(t.createdAt)
  const end = Date.parse(t.updatedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0
  if (isActiveStatus(t.status) || t.status === 'succeeded' || t.status === 'failed') {
    return (isActiveStatus(t.status) ? Date.now() : end) - start
  }
  return 0
}

export function QueuePage() {
  const tasks = useQueue((s) => s.tasks)
  const remove = useQueue((s) => s.remove)
  const clearHistory = useQueue((s) => s.clearHistory)
  const push = useToast((s) => s.push)
  const navigate = useNavigate()
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

  function reuseTask(t: LocalTask) {
    sessionStorage.setItem(
      'comfy-studio-web-apply-prompt',
      JSON.stringify({
        prompt: t.prompt,
        negative: t.negativePrompt || '',
        width: t.width,
        height: t.height,
        steps: t.steps,
        seed: t.seed ?? '',
        mode: t.mode
      })
    )
    navigate('/create')
    push('已填入创作参数', 'success')
  }

  return (
    <div className="page space-y-6">
      <div className="page-header mb-0">
        <h1 className="page-title">任务队列</h1>
      </div>

      {!tasks.length ? (
        <div className="empty-state min-h-[16rem]">
          <p className="text-sm text-muted">暂无任务</p>
        </div>
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-sm font-medium text-text">进行中 · {active.length}</h2>
            {active.length === 0 ? (
              <p className="text-sm text-muted">当前没有进行中的任务</p>
            ) : (
              <div className="space-y-3">
                {active.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    onOpen={() => setDetailId(t.id)}
                    onRemove={() => remove(t.id)}
                    onReuse={() => reuseTask(t)}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium text-text">历史 · {history.length}</h2>
              {history.length > 0 ? (
                <button
                  type="button"
                  className="btn-ghost !px-3 text-xs"
                  onClick={() => {
                    clearHistory()
                    push('已清空历史', 'success')
                  }}
                >
                  清空历史
                </button>
              ) : null}
            </div>
            {history.length === 0 ? (
              <p className="text-sm text-muted">暂无历史记录</p>
            ) : (
              <div className="space-y-3">
                {history.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    onOpen={() => setDetailId(t.id)}
                    onRemove={() => remove(t.id)}
                    onReuse={() => reuseTask(t)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {detail ? (
        <TaskDetailPanel
          task={detail}
          onClose={() => setDetailId(null)}
          onReuse={() => {
            reuseTask(detail)
            setDetailId(null)
          }}
          onDelete={() => {
            remove(detail.id)
            setDetailId(null)
          }}
        />
      ) : null}
    </div>
  )
}

function TaskCard(props: {
  task: LocalTask
  onOpen: () => void
  onRemove: () => void
  onReuse: () => void
}) {
  const t = props.task
  const elapsed = taskElapsedMs(t)
  const done = t.status === 'succeeded' || t.status === 'failed'

  return (
    <div
      className="card cursor-pointer p-4 transition-colors hover:border-white/30"
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
      <div className="flex items-start gap-3">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border bg-bg">
          {t.previewUrl && !t.previewUrl.startsWith('data:video/') ? (
            <img src={t.previewUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted/50">
              <ImageIcon className="h-5 w-5" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <StatusBadge status={t.status} />
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-muted">
              {modeLabel(t.mode)}
            </span>
            <span className="text-[11px] text-muted">{formatDateTime(t.createdAt)}</span>
          </div>
          <p className="line-clamp-2 text-sm text-text">{t.prompt}</p>
          <p className="mt-2 text-xs text-muted">
            {t.width}×{t.height} · steps {t.steps}
            {t.seed != null ? ` · seed ${t.seed}` : ' · seed 随机'}
            {elapsed > 0 ? ` · 耗时 ${formatElapsed(elapsed)}` : ''}
            {t.progressMessage ? ` · ${t.progressMessage}` : ''}
            {t.progress && t.status === 'running'
              ? ` ${Math.round(t.progress.percent)}%`
              : ''}
          </p>
          {t.error ? <p className="mt-2 text-xs text-danger">{t.error}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
          {done ? (
            <>
              <button type="button" className="btn-secondary !px-3 text-xs" onClick={props.onReuse}>
                复用参数
              </button>
              <button type="button" className="btn-ghost !px-3 text-xs" onClick={props.onRemove}>
                删除记录
              </button>
            </>
          ) : (
            <button type="button" className="btn-ghost !px-3 text-xs" onClick={props.onRemove}>
              移除
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function TaskDetailPanel(props: {
  task: LocalTask
  onClose: () => void
  onReuse: () => void
  onDelete: () => void
}) {
  const t = props.task
  const elapsed = taskElapsedMs(t)
  const negative = t.negativePrompt?.trim()
  const done = t.status === 'succeeded' || t.status === 'failed'

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/70"
      onClick={props.onClose}
      role="presentation"
    >
      <div
        className="glass-panel flex h-full w-full max-w-lg flex-col border-l border-white/10 shadow-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="任务详情"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="font-semibold text-text">任务详情</h3>
          <button type="button" className="btn-ghost !p-1" onClick={props.onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {t.previewUrl ? (
            <div className="overflow-hidden rounded-xl border border-border bg-bg">
              {t.mode === 'image_to_video' ? (
                <video src={t.previewUrl} controls className="max-h-64 w-full object-contain" />
              ) : (
                <img src={t.previewUrl} alt="" className="max-h-64 w-full object-contain" />
              )}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={t.status} />
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-muted">
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
            <DetailStat label="耗时" value={elapsed > 0 ? formatElapsed(elapsed) : '—'} />
          </div>

          {t.error ? (
            <DetailBlock label="错误">
              <p className="text-sm text-danger">{t.error}</p>
            </DetailBlock>
          ) : null}

          {t.remoteTaskId ? (
            <p className="font-mono text-[11px] text-muted">task {t.remoteTaskId}</p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-border p-4">
          {done ? (
            <>
              <button type="button" className="btn-secondary" onClick={props.onReuse}>
                复用参数
              </button>
              <button type="button" className="btn-ghost" onClick={props.onDelete}>
                删除记录
              </button>
            </>
          ) : (
            <button type="button" className="btn-secondary col-span-2" onClick={props.onClose}>
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
    <div className="rounded-lg border border-border bg-bg/50 px-3 py-2.5">
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
    failed: 'bg-danger/15 text-danger'
  }
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs ${map[status] || 'bg-white/10 text-muted'}`}>
      {statusLabel(status)}
    </span>
  )
}
