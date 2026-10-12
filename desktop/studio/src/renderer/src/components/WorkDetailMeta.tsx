import type { ReactNode } from 'react'
import { PromptTranslateButton } from './PromptTranslate'
import { formatElapsed, modeLabel } from '../lib/format'

/** Prompt + params block for gallery / showcase detail drawers. */
export function WorkDetailMeta(props: {
  prompt: string
  negativePrompt?: string | null
  width: number
  height: number
  steps: number
  seed?: number | null
  mode?: string
  elapsedMs?: number | null
  refCount?: number
  taskId?: string
  /** Line above prompts (e.g. author · time) */
  eyebrow?: ReactNode
  /** Extra lines under task id */
  footer?: ReactNode
}) {
  const neg = (props.negativePrompt || '').trim()

  return (
    <div className="mt-4 space-y-4">
      {props.eyebrow ? <div className="text-[11px] leading-relaxed text-muted">{props.eyebrow}</div> : null}

      <section>
        <h4 className="mb-1.5 text-[11px] font-medium tracking-wide text-muted">正向提示词</h4>
        <p className="whitespace-pre-wrap rounded-lg border border-[#1a1d27] bg-[#14171f] px-3 py-2.5 text-[13px] leading-[1.65] text-[#d5dae6]">
          {props.prompt}
        </p>
        <PromptTranslateButton text={props.prompt} className="mt-1.5" />
      </section>

      {neg ? (
        <section>
          <h4 className="mb-1.5 text-[11px] font-medium tracking-wide text-muted">负向提示词</h4>
          <p className="whitespace-pre-wrap rounded-lg border border-[#1a1d27] bg-[#14171f] px-3 py-2.5 text-[13px] leading-[1.65] text-[#d5dae6]">
            {neg}
          </p>
          <PromptTranslateButton text={neg} className="mt-1.5" />
        </section>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <MetaChip label="尺寸" value={`${props.width}×${props.height}`} />
        <MetaChip label="步数" value={String(props.steps)} />
        <MetaChip label="种子" value={props.seed != null ? String(props.seed) : '随机'} />
        <MetaChip label="模式" value={modeLabel(props.mode)} />
        {props.elapsedMs != null && props.elapsedMs > 0 ? (
          <MetaChip label="耗时" value={formatElapsed(props.elapsedMs)} />
        ) : null}
        {props.refCount != null && props.refCount > 0 ? (
          <MetaChip label="参考图" value={String(props.refCount)} />
        ) : null}
      </div>

      {(props.taskId || props.footer) && (
        <div className="space-y-1 border-t border-[#1a1d27] pt-3">
          {props.taskId ? (
            <p className="break-all font-mono text-[11px] text-muted/90">task {props.taskId}</p>
          ) : null}
          {props.footer}
        </div>
      )}
    </div>
  )
}

function MetaChip(props: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#1a1d27] bg-[#14171f] px-3 py-2">
      <p className="text-[10px] font-medium tracking-wide text-muted">{props.label}</p>
      <p className="mt-0.5 break-all font-mono text-[12px] leading-snug text-[#c9cfdd]">{props.value}</p>
    </div>
  )
}
