import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  className?: string
  delay?: number
}

/**
 * Scroll reveal via a temporary veil only.
 * Above-the-fold / already-visible blocks skip the veil entirely —
 * otherwise page navigation flashes a dark rectangle (the veil at opacity 1).
 * Never put opacity/transform on the content (breaks backdrop-filter).
 */
export function Reveal({ children, className, delay = 0 }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  /** null = measuring; false = waiting off-screen; true = unveiled / no veil */
  const [phase, setPhase] = useState<'measure' | 'wait' | 'out' | 'done'>('measure')

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setPhase('done')
      return
    }

    const rect = el.getBoundingClientRect()
    const vh = window.innerHeight || document.documentElement.clientHeight
    const alreadyVisible = rect.top < vh * 0.95 && rect.bottom > 8
    if (alreadyVisible) {
      setPhase('done')
      return
    }

    setPhase('wait')
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setPhase('out')
        io.disconnect()
      },
      { rootMargin: '0px 0px -32px 0px', threshold: 0.06 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const style = {
    ['--reveal-delay' as string]: `${delay}s`
  } as CSSProperties

  return (
    <div
      ref={ref}
      className={`reveal ${phase === 'out' ? 'reveal-leaving' : ''} ${className ?? ''}`}
      style={style}
    >
      {phase === 'wait' || phase === 'out' ? (
        <div
          className="reveal-veil"
          aria-hidden
          onAnimationEnd={() => {
            if (phase === 'out') setPhase('done')
          }}
        />
      ) : null}
      <div className="reveal-body">{children}</div>
    </div>
  )
}
