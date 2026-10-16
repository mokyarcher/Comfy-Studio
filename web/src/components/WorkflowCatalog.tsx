import type { WorkflowItem, WorkflowModel, WorkflowsManifest } from '../data/workflows'
import { Reveal } from './Reveal'

type Props = {
  manifest: WorkflowsManifest
}

function hasUrl(url?: string) {
  return Boolean(url && /^https?:\/\//i.test(url.trim()))
}

export function MirrorCards({ manifest }: Props) {
  const mirrors = [...manifest.mirrors].sort((a, b) => a.priority - b.priority)

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {mirrors.map((m, i) => {
        const primary = m.priority === 1
        return (
          <Reveal key={m.id} delay={i * 0.06}>
          <article
            className={`glass-panel flex flex-col rounded-xl p-5 ${
              primary ? 'shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_35%,transparent)]' : ''
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="display text-2xl text-text">{m.name}</h2>
              <span
                className={`rounded-md px-2 py-0.5 text-xs ${
                  primary
                    ? 'bg-accent/15 text-accent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_40%,transparent)]'
                    : 'bg-white/10 text-muted shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]'
                }`}
              >
                {primary ? '首选' : '次选'}
              </span>
            </div>
            {m.note ? <p className="mt-3 text-sm text-muted">{m.note}</p> : null}
            <div className="mt-auto pt-6">
              <a
                href={m.url}
                className={primary ? 'btn-glass-liquid !rounded-xl' : 'btn-secondary'}
                target="_blank"
                rel="noopener noreferrer"
              >
                打开站点
              </a>
            </div>
          </article>
          </Reveal>
        )
      })}
    </div>
  )
}

export function WorkflowList({ manifest }: Props) {
  const workflows = manifest.workflows ?? []

  if (!workflows.length) {
    return (
      <div className="glass-soft rounded-xl px-6 py-12 text-center text-sm text-muted">
        暂无工作流清单
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {workflows.map((wf, i) => (
        <WorkflowCard key={wf.id} workflow={wf} index={i} />
      ))}
    </div>
  )
}

function WorkflowCard({ workflow, index }: { workflow: WorkflowItem; index: number }) {
  return (
    <Reveal delay={Math.min(index * 0.05, 0.2)}>
    <section className="glass-panel overflow-hidden rounded-xl">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="display text-xl text-text">{workflow.name}</h3>
            {workflow.required ? (
              <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[11px] text-accent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_35%,transparent)]">
                必需
              </span>
            ) : (
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-muted shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]">
                可选
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted">{workflow.summary}</p>
        </div>
        <span className="font-mono text-[11px] text-muted">{workflow.mode}</span>
      </header>

      <ul className="divide-y divide-white/10">
        {(workflow.models || []).map((model) => (
          <li key={model.id} className="px-5 py-4">
            <ModelRow model={model} />
          </li>
        ))}
      </ul>
    </section>
    </Reveal>
  )
}

function ModelRow({ model }: { model: WorkflowModel }) {
  const allLinks = model.links || []
  const ready = allLinks.filter((l) => hasUrl(l.url))
  // Prefer 魔搭, then any ready link
  const primary =
    ready.find((l) => l.mirror === 'modelscope') || ready[0] || null
  const extras = ready.filter((l) => l !== primary)

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className="text-sm font-medium text-text">{model.name}</p>
          {model.sizeHint ? (
            <span className="font-mono text-[11px] text-muted">{model.sizeHint}</span>
          ) : null}
        </div>
        {model.role ? <p className="text-xs text-muted">{model.role}</p> : null}
        {model.savePath ? (
          <p className="font-mono text-[11px] text-muted/90">{model.savePath}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap gap-2">
        {primary ? (
          <a
            href={primary.url}
            className="btn-glass-liquid !rounded-lg !px-3 !py-1.5 text-xs"
            target="_blank"
            rel="noopener noreferrer"
            download
          >
            下载
          </a>
        ) : (
          <span
            className="inline-flex cursor-not-allowed items-center rounded-md bg-white/5 px-3 py-1.5 text-xs text-muted/50 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"
            aria-disabled="true"
          >
            下载
          </span>
        )}
        {extras.map((link) => (
          <a
            key={`${model.id}-${link.label}-${link.url}`}
            href={link.url}
            className="btn-secondary !px-3 !py-1.5 text-xs"
            target="_blank"
            rel="noopener noreferrer"
          >
            {link.label}
          </a>
        ))}
      </div>
    </div>
  )
}
