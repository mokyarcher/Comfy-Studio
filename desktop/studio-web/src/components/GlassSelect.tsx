import { ChevronDown } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type GlassSelectOption = {
  value: string
  label: string
}

type Props = {
  value: string
  options: GlassSelectOption[]
  onChange: (value: string) => void
  className?: string
  disabled?: boolean
  'aria-label'?: string
}

type MenuPos = { top: number; left: number; width: number }

/** Custom select with glass-like panel (native <select> popup cannot be frosted). */
export function GlassSelect({ value, options, onChange, className = '', disabled, 'aria-label': ariaLabel }: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<MenuPos | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  const listId = useId()
  const selected = options.find((o) => o.value === value) ?? options[0]

  function updatePos() {
    const el = rootRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ top: r.bottom + 6, left: r.left, width: r.width })
  }

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    updatePos()
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onReposition() {
      updatePos()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open])

  return (
    <div ref={rootRef} className={`glass-select ${open ? 'glass-select-open' : ''} ${className}`}>
      <button
        type="button"
        className="glass-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((v) => !v)}
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 opacity-70 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && pos
        ? createPortal(
            <ul
              ref={menuRef}
              id={listId}
              className="glass-select-menu"
              role="listbox"
              aria-label={ariaLabel}
              style={{ top: pos.top, left: pos.left, width: pos.width }}
            >
              {options.map((opt) => {
                const active = opt.value === value
                return (
                  <li key={opt.value} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={`glass-select-option ${active ? 'glass-select-option-active' : ''}`}
                      onClick={() => {
                        onChange(opt.value)
                        setOpen(false)
                      }}
                    >
                      {opt.label}
                    </button>
                  </li>
                )
              })}
            </ul>,
            document.body
          )
        : null}
    </div>
  )
}
