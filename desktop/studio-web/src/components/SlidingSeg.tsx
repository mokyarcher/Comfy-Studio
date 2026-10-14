import { useLayoutEffect, useRef, type ReactNode } from 'react'

export type SlidingSegOption<T extends string> = {
  value: T
  label: ReactNode
}

type PillBox = { top: number; left: number; width: number; height: number }

function readBox(rail: HTMLElement, item: HTMLElement): PillBox {
  const a = rail.getBoundingClientRect()
  const b = item.getBoundingClientRect()
  return {
    top: b.top - a.top,
    left: b.left - a.left,
    width: b.width,
    height: b.height
  }
}

function applyBox(el: HTMLDivElement, box: PillBox) {
  el.style.top = `${box.top}px`
  el.style.left = `${box.left}px`
  el.style.width = `${box.width}px`
  el.style.height = `${box.height}px`
  el.style.transform = 'scale(1)'
}

type Props<T extends string> = {
  value: T
  options: SlidingSegOption<T>[]
  onChange: (value: T) => void
  className?: string
  'aria-label'?: string
}

/** Segmented control with glass pill that shrinks mid-travel then grows into place. */
export function SlidingSeg<T extends string>({
  value,
  options,
  onChange,
  className = '',
  'aria-label': ariaLabel
}: Props<T>) {
  const railRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef(new Map<T, HTMLButtonElement>())
  const readyRef = useRef(false)
  const animRef = useRef<Animation | null>(null)

  useLayoutEffect(() => {
    const rail = railRef.current
    const ind = indicatorRef.current
    const item = itemRefs.current.get(value)
    if (!rail || !ind || !item) return

    const next = readBox(rail, item)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    animRef.current?.cancel()
    animRef.current = null

    if (!readyRef.current || reduceMotion) {
      applyBox(ind, next)
      readyRef.current = true
      return
    }

    const from: PillBox = {
      top: parseFloat(ind.style.top) || next.top,
      left: parseFloat(ind.style.left) || next.left,
      width: parseFloat(ind.style.width) || next.width,
      height: parseFloat(ind.style.height) || next.height
    }

    const same =
      Math.abs(from.top - next.top) < 0.5 &&
      Math.abs(from.left - next.left) < 0.5 &&
      Math.abs(from.width - next.width) < 0.5
    if (same) {
      applyBox(ind, next)
      return
    }

    const mid: PillBox = {
      top: (from.top + next.top) / 2,
      left: (from.left + next.left) / 2,
      width: (from.width + next.width) / 2,
      height: (from.height + next.height) / 2
    }

    const anim = ind.animate(
      [
        {
          top: `${from.top}px`,
          left: `${from.left}px`,
          width: `${from.width}px`,
          height: `${from.height}px`,
          transform: 'scale(1)'
        },
        {
          top: `${mid.top}px`,
          left: `${mid.left}px`,
          width: `${mid.width}px`,
          height: `${mid.height}px`,
          transform: 'scale(0.72)',
          offset: 0.48
        },
        {
          top: `${next.top}px`,
          left: `${next.left}px`,
          width: `${next.width}px`,
          height: `${next.height}px`,
          transform: 'scale(1)'
        }
      ],
      {
        duration: 420,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'forwards'
      }
    )
    animRef.current = anim
    anim.finished
      .then(() => {
        applyBox(ind, next)
        anim.cancel()
        if (animRef.current === anim) animRef.current = null
      })
      .catch(() => undefined)
  }, [value, options.length])

  return (
    <div
      ref={railRef}
      className={`sliding-seg ${className}`}
      role="tablist"
      aria-label={ariaLabel}
    >
      <div ref={indicatorRef} className="sliding-seg-indicator" aria-hidden />
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            ref={(el) => {
              if (el) itemRefs.current.set(opt.value, el)
              else itemRefs.current.delete(opt.value)
            }}
            className={`sliding-seg-item ${active ? 'sliding-seg-item-active' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
