import type { ReactNode } from 'react'
import { PromptTranslateButton } from '@/components/PromptTranslateButton'
import { modeLabel } from '@/lib/format'

/** Prompt + params block for gallery detail drawer (aligned with desktop Studio). */
export function WorkDetailMeta(props: {
  prompt: string
  negativePrompt?: string | null
  width: number
  height: number
  steps: number
  seed?: number | null
  mode?: string
  taskId?: string
  eyebrow?: ReactNode
  footer?: ReactNode
}) {
  const neg = (props.negativePrompt || '').trim()

  return (
    <div className="space-y-4">
      {props.eyebrow ? <div className="text-[11px] leading-relaxed text-muted">{props.eyebrow}</div> : null}

      <section>
        <h4 className="mb-1.5 text-[11px] font-medium tracking-wide text-muted">正向提示词</h4>
        <p className="whitespace-pre-wrap rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 text-[13px] leading-[1.65] text-text">
          {props.prompt}
        </p>
        <PromptTranslateButton text={props.prompt} className="mt-1.5" />
      </section>

      <section>
        <h4 className="mb-1.5 text-[11px] font-medium tracking-wide text-muted">负向提示词</h4>
        <p className="whitespace-pre-wrap rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 text-[13px] leading-[1.65] text-text">
          {neg || '（无）'}
        </p>
        {neg ? <PromptTranslateButton text={neg} className="mt-1.5" /> : null}
      </section>

      <div className="grid grid-cols-2 gap-2">
        <MetaChip label="尺寸" value={`${props.width}×${props.height}`} />
        <MetaChip label="步数" value={String(props.steps)} />
        <MetaChip label="种子" value={props.seed != null ? String(props.seed) : '随机'} />
        <MetaChip label="模式" value={modeLabel(props.mode)} />
      </div>

      {(props.taskId || props.footer) && (
        <div className="space-y-1 border-t border-white/10 pt-3">
          {props.taskId ? (
            <p className="break-all font-mono text-[11px] text-muted">task {props.taskId}</p>
          ) : null}
          {props.footer}
        </div>
      )}
    </div>
  )
}

function MetaChip(props: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/25 px-3 py-2">
      <p className="text-[10px] font-medium tracking-wide text-muted">{props.label}</p>
      <p className="mt-0.5 break-all font-mono text-[12px] leading-snug text-text">{props.value}</p>
    </div>
  )
}
