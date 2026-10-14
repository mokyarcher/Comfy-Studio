import { useLayoutEffect } from 'react'
import { useSettings } from '@/store/settings'

/** Sync glass opacity / blur settings → CSS variables on :root. */
export function GlassTheme() {
  const glassOpacity = useSettings((s) => s.glassOpacity)
  const glassBlur = useSettings((s) => s.glassBlur)

  // useLayoutEffect so first paint already has valid filter strings (blur(var()) is flaky in Edge)
  useLayoutEffect(() => {
    const root = document.documentElement
    const solid = glassOpacity
    const strong = Math.min(90, solid + 10)
    const soft = Math.max(6, Math.round(glassBlur * 0.55))
    root.style.setProperty('--glass-pct', `${solid}%`)
    root.style.setProperty('--glass-pct-strong', `${strong}%`)
    root.style.setProperty('--glass-filter', `blur(${glassBlur}px) saturate(170%)`)
    root.style.setProperty('--glass-filter-soft', `blur(${soft}px) saturate(150%)`)
  }, [glassOpacity, glassBlur])

  return null
}
