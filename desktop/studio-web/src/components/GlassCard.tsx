import LiquidGlass from 'liquid-glass-react'
import type { CSSProperties, ReactNode, RefObject } from 'react'

type Props = {
  children: ReactNode
  className?: string
  style?: CSSProperties
  cornerRadius?: number
  mouseContainer?: RefObject<HTMLElement | null> | null
  padding?: string
}

/** Floating liquid-glass panel for hero surfaces (login, etc.). Prefer CSS `.card` for dense scrollable UI. */
export function GlassCard({
  children,
  className = '',
  style,
  cornerRadius = 16,
  mouseContainer,
  padding = '0'
}: Props) {
  return (
    <LiquidGlass
      displacementScale={56}
      blurAmount={0.1}
      saturation={135}
      aberrationIntensity={1.2}
      elasticity={0.12}
      cornerRadius={cornerRadius}
      padding={padding}
      mode="standard"
      mouseContainer={mouseContainer}
      className={className}
      style={style}
    >
      {children}
    </LiquidGlass>
  )
}
