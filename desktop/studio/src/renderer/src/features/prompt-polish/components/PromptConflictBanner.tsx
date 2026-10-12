import type { PromptPolishConflict } from '../../../../../shared/prompt-polish/types'

interface Props {
  conflicts: PromptPolishConflict[]
  ack: boolean
  onAckChange: (v: boolean) => void
}

export function PromptConflictBanner({ conflicts, ack, onAckChange }: Props) {
  const warnings = conflicts.filter((c) => c.severity === 'warning' || c.severity === 'blocking')
  if (warnings.length === 0) return null

  const blocking = warnings.some((c) => c.severity === 'blocking')

  return (
    <div
      className="rounded-xl border px-3 py-2 text-xs"
      style={{
        borderColor: 'color-mix(in srgb, var(--warning) 45%, transparent)',
        background: 'color-mix(in srgb, var(--warning) 10%, transparent)'
      }}
      role="alert"
    >
      <p className="font-medium text-warning">提示词可能有冲突</p>
      <ul className="mt-1 list-disc pl-4 text-muted">
        {warnings.map((c) => (
          <li key={`${c.code}-${c.message}`}>{c.message}</li>
        ))}
      </ul>
      {!blocking && (
        <label className="mt-2 flex items-center gap-2 text-muted">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => onAckChange(e.target.checked)}
          />
          仍要使用
        </label>
      )}
    </div>
  )
}
