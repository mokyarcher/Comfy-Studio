import type { ReactNode } from 'react'

type Props = {
  children: ReactNode
  disabled?: boolean
  className?: string
  onClick?: () => void
}

/**
 * Glass CTA for dense panels.
 * Avoids liquid-glass-react here: its filter/canvas layer is clipped or invisible
 * inside `.card { overflow: hidden }` stacking contexts.
 */
export function GlassButton({ children, disabled, className = '', onClick }: Props) {
  return (
    <button
      type="button"
      className={`glass-cta-btn ${disabled ? 'glass-cta-btn-disabled' : ''} ${className}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="glass-cta-btn-label">{children}</span>
    </button>
  )
}
