import type { PromptPolishResult } from '../../../../../shared/prompt-polish/types'

interface Props {
  result: PromptPolishResult | null
}

export function PromptChangeSummary({ result }: Props) {
  if (!result) {
    return <p className="text-xs text-muted">暂无润色结果</p>
  }

  return (
    <div className="space-y-3 text-xs">
      <section>
        <h4 className="mb-1 font-medium text-text">本次补充</h4>
        {result.addedDetails.length === 0 ? (
          <p className="text-muted">无</p>
        ) : (
          <ul className="list-disc space-y-0.5 pl-4 text-muted">
            {result.addedDetails.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
      </section>
      {result.preservedConstraints.length > 0 && (
        <section>
          <h4 className="mb-1 font-medium text-text">已保留</h4>
          <ul className="list-disc space-y-0.5 pl-4 text-muted">
            {result.preservedConstraints.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </section>
      )}
      {(result.assumptions.length > 0 || result.conflicts.length > 0) && (
        <section>
          <h4 className="mb-1 font-medium text-text">需确认</h4>
          <ul className="list-disc space-y-0.5 pl-4 text-muted">
            {result.assumptions.map((d) => (
              <li key={d}>{d}</li>
            ))}
            {result.conflicts.map((c) => (
              <li
                key={`${c.code}-${c.message}`}
                className={c.severity === 'blocking' ? 'text-danger' : 'text-warning'}
              >
                {c.message}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
