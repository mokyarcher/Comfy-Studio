type Props = {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label: string
  description?: string
  className?: string
}

/** iOS-style pill toggle for glass panels. */
export function GlassSwitch({
  checked,
  onChange,
  disabled,
  label,
  description,
  className = ''
}: Props) {
  return (
    <label
      className={`glass-switch ${checked ? 'glass-switch-on' : ''} ${
        disabled ? 'glass-switch-disabled' : ''
      } ${className}`}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="glass-switch-track" aria-hidden>
        <span className="glass-switch-knob" />
      </span>
      <span className="glass-switch-copy">
        <span className="glass-switch-label">{label}</span>
        {description ? <span className="glass-switch-desc">{description}</span> : null}
      </span>
    </label>
  )
}
