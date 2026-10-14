import { motion } from 'motion/react'
import type { WorkflowItem, WorkflowModel, WorkflowsManifest } from '../data/workflows'

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
          <motion.article
            key={m.id}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 0.4 }}
            className={`flex flex-col rounded-xl border p-5 ${
              primary ? 'border-accent/40 bg-accent/5' : 'border-border bg-panel/70'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="display text-2xl text-text">{m.name}</h2>
              <span
                className={`rounded-md border px-2 py-0.5 text-xs ${
                  primary
                    ? 'border-accent/40 bg-accent/15 text-accent'
                    : 'border-border bg-bg-elevated text-muted'
                }`}
              >
                {primary ? '首选' : '次选'}
              </span>
            </div>
            {m.note ? <p className="mt-3 text-sm text-muted">{m.note}</p> : null}
            <div className="mt-auto pt-6">
              <a
                href={m.url}
                className={primary ? 'btn-primary' : 'btn-secondary'}
                target="_blank"
                rel="noopener noreferrer"
              >
                打开站点
              </a>
            </div>
          </motion.article>
        )
      })}
    </div>
  )
}

export function WorkflowList({ manifest }: Props) {
  const workflows = manifest.workflows ?? []

  if (!workflows.length) {
    return (
      <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted">
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
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-20px' }}
      transition={{ delay: Math.min(index * 0.05, 0.2), duration: 0.4 }}
      className="overflow-hidden rounded-xl border border-border bg-panel/70"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="display text-xl text-text">{workflow.name}</h3>
            {workflow.required ? (
              <span className="rounded border border-accent/35 bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent">
                必需
              </span>
            ) : (
              <span className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted">
                可选
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted">{workflow.summary}</p>
        </div>
        <span className="font-mono text-[11px] text-muted">{workflow.mode}</span>
      </header>

      <ul className="divide-y divide-border">
        {(workflow.models || []).map((model) => (
          <li key={model.id} className="px-5 py-4">
            <ModelRow model={model} />
          </li>
        ))}
      </ul>
    </motion.section>
  )
}

function ModelRow({ model }: { model: WorkflowModel }) {
  const links = (model.links || []).filter((l) => hasUrl(l.url))

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

      {links.length > 0 ? (
        <div className="flex shrink-0 flex-wrap gap-2">
          {links.map((link) => (
            <a
              key={`${model.id}-${link.label}-${link.url}`}
              href={link.url}
              className="btn-primary !px-3 !py-1.5 text-xs"
              target="_blank"
              rel="noopener noreferrer"
            >
              {link.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  )
}
