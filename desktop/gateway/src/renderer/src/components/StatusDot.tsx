type Tone = 'success' | 'warning' | 'danger' | 'muted' | 'primary' | 'accent'

const colors: Record<Tone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  muted: 'bg-muted',
  primary: 'bg-primary',
  accent: 'bg-accent'
}

export function StatusDot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      {pulse && (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-40 ${colors[tone]}`}
        />
      )}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${colors[tone]}`} />
    </span>
  )
}
