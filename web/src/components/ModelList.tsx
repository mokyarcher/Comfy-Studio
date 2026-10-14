import { motion } from 'motion/react'
import type { ModelsManifest, ProjectModel } from '../data/models'

type Props = {
  manifest: ModelsManifest
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
              primary
                ? 'border-accent/40 bg-accent/5'
                : 'border-border bg-panel/70'
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

export function ProjectModels({ manifest }: Props) {
  const models = manifest.models ?? []

  if (!models.length) {
    return (
      <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted">
        尚未配置本项目模型。编辑
        <code className="mx-1 font-mono text-accent">web/src/data/models.json</code>
        的 <code className="font-mono text-accent">models</code> 数组后重新构建部署。
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {models.map((model, i) => (
        <ModelCard key={model.id} model={model} index={i} />
      ))}
    </div>
  )
}

function ModelCard({ model, index }: { model: ProjectModel; index: number }) {
  const links = (model.links || []).filter((l) => hasUrl(l.url))
  const pending = (model.links || []).length > 0 && links.length === 0

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-20px' }}
      transition={{ delay: Math.min(index * 0.04, 0.24), duration: 0.4 }}
      className="rounded-xl border border-border bg-panel/70 p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-medium text-text">{model.name}</h3>
            {model.required ? (
              <span className="rounded border border-accent/35 bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent">
                必需
              </span>
            ) : (
              <span className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted">
                可选
              </span>
            )}
            {model.mode ? (
              <span className="font-mono text-[11px] text-muted">{model.mode}</span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted">{model.role}</p>
        </div>
        {model.sizeHint ? (
          <span className="font-mono text-xs text-muted">{model.sizeHint}</span>
        ) : null}
      </div>

      {model.savePath ? (
        <p className="mt-3 rounded-md border border-border bg-bg-elevated px-3 py-2 font-mono text-[12px] text-muted">
          建议路径：{model.savePath}
        </p>
      ) : null}

      {model.note ? <p className="mt-2 text-xs text-muted">{model.note}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
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
        {pending ? (
          <span className="inline-flex items-center rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted">
            直链待补充（编辑 models.json）
          </span>
        ) : null}
      </div>
    </motion.article>
  )
}
