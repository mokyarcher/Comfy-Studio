import './GeneratingPreview.css'

/** Fallback wall-clock estimates before first ComfyUI progress tick. */
export const ESTIMATE_MS = {
  txt2img: 25_000,
  image_edit: 60_000,
  image_to_video: 200_000
} as const

function formatSecs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${s}s`
}

export function GeneratingPreview(props: {
  mode: 'txt2img' | 'image_edit' | 'image_to_video'
  elapsedMs: number
  statusText?: string
  /** Real sampler progress from API (value/max). */
  progress?: { value: number; max: number; percent: number } | null
}) {
  const estimate = ESTIMATE_MS[props.mode] ?? ESTIMATE_MS.txt2img
  const real = props.progress && props.progress.max > 0 ? props.progress : null
  const ratio = real
    ? Math.min(1, Math.max(0, real.percent / 100))
    : Math.min(0.96, props.elapsedMs / estimate)
  const overtime = !real && props.elapsedMs > estimate
  const modeLabel =
    props.mode === 'image_edit' ? '图生图' : props.mode === 'image_to_video' ? '图生视频' : '文生图'

  const etaText = real
    ? `${modeLabel} · ${real.value}/${real.max} · ${Math.round(real.percent)}%`
    : `${modeLabel} · ${formatSecs(props.elapsedMs)}${overtime ? '' : ` / ~${formatSecs(estimate)}`}`

  return (
    <div className="gen-preview" role="status" aria-live="polite">
      <div className="gen-preview-ambient" />
      <div className="gen-preview-haze" />
      <div className="gen-preview-sheen" />
      <div className="gen-preview-body">
        <div className="gen-preview-icon" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            width="27"
            height="27"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.45"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3.5" y="4.5" width="17" height="15" rx="2.4" />
            <circle cx="9" cy="10" r="1.5" />
            <path d="m5.5 17 4.7-4.5 3.1 2.8 2.1-2 3.1 3.7" />
          </svg>
        </div>
        <div className="gen-preview-label">生成中</div>
        <div className="gen-preview-dots" aria-label="生成中">
          <i />
          <i />
          <i />
        </div>
        {props.statusText ? (
          <div className="gen-preview-sub">{props.statusText}</div>
        ) : null}
        <div className="gen-preview-eta">{etaText}</div>
      </div>
      <div className="gen-preview-bar">
        {overtime ? (
          <span className="gen-preview-bar-indeterminate" />
        ) : (
          <div className="gen-preview-bar-fill" style={{ width: `${Math.max(4, ratio * 100)}%` }} />
        )}
      </div>
    </div>
  )
}
