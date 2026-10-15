type Props = {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label: string
}

export function GlassSwitch({ checked, onChange, disabled, label }: Props) {
  return (
    <label
      className={`glass-switch ${checked ? 'glass-switch-on' : ''} ${
        disabled ? 'opacity-50' : ''
      }`}
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
      <span className="glass-switch-label">{label}</span>
    </label>
  )
}
