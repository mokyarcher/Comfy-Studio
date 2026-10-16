import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ShowcaseItem } from '../data/showcase'
import { Reveal } from './Reveal'

type Props = {
  items: ShowcaseItem[]
}

export function ShowcaseWall({ items }: Props) {
  const [active, setActive] = useState<ShowcaseItem | null>(null)
  const [fullReady, setFullReady] = useState(false)

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActive(null)
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [active])

  useEffect(() => {
    if (!active?.image) {
      setFullReady(false)
      return
    }
    setFullReady(false)
    const img = new Image()
    img.src = active.image
    if (img.complete) {
      setFullReady(true)
      return
    }
    const done = () => setFullReady(true)
    img.addEventListener('load', done)
    img.addEventListener('error', done)
    return () => {
      img.removeEventListener('load', done)
      img.removeEventListener('error', done)
    }
  }, [active])

  if (!items.length) {
    return (
      <div className="glass-soft rounded-xl px-6 py-16 text-center text-sm text-muted">
        样例作品即将上架。可先查看演示导览或部署自己的展馆。
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {items.map((item, i) => {
          const preview = item.thumb || item.image
          return (
            <Reveal key={item.id} delay={Math.min(i * 0.04, 0.3)}>
              <figure className="glass-panel group overflow-hidden rounded-lg">
                <div className="aspect-square overflow-hidden bg-bg-elevated">
                  {preview ? (
                    <button
                      type="button"
                      className="block h-full w-full cursor-zoom-in"
                      onClick={() => setActive(item)}
                      aria-label="查看大图"
                    >
                      <img
                        src={preview}
                        alt={item.prompt || '样例作品'}
                        loading="lazy"
                        decoding="async"
                        width={480}
                        height={480}
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                      />
                    </button>
                  ) : (
                    <div
                      className="flex h-full w-full items-end p-3"
                      style={{
                        background: `linear-gradient(145deg, ${item.tint || '#1a3d2e'}, #0b0d10 70%)`
                      }}
                    >
                      <span className="text-[11px] text-muted">{item.modeLabel}</span>
                    </div>
                  )}
                </div>
                <figcaption className="space-y-1 p-3">
                  <p className="line-clamp-2 text-xs text-text">{item.prompt}</p>
                  <p className="text-[11px] text-muted">{item.modeLabel}</p>
                </figcaption>
              </figure>
            </Reveal>
          )
        })}
      </div>

      {active && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3 backdrop-blur-[2px] sm:p-4"
              onClick={() => setActive(null)}
              role="dialog"
              aria-modal="true"
              aria-label="作品大图"
            >
              <button
                type="button"
                className="relative flex h-[85vh] w-[85vw] max-h-[85vh] max-w-[85vw] cursor-zoom-out items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/40 p-2 outline-none"
                onClick={(e) => {
                  e.stopPropagation()
                  setActive(null)
                }}
                aria-label="收起大图"
              >
                {(active.thumb || active.image) && !fullReady ? (
                  <img
                    src={active.thumb || active.image}
                    alt=""
                    aria-hidden
                    className="absolute inset-0 m-auto max-h-full max-w-full object-contain opacity-50 blur-sm"
                  />
                ) : null}
                {!fullReady ? (
                  <span className="relative z-10 text-sm text-muted">加载原图…</span>
                ) : null}
                {active.image ? (
                  <img
                    src={active.image}
                    alt={active.prompt || '样例作品'}
                    className={`relative z-10 max-h-full max-w-full object-contain transition-opacity duration-200 ${
                      fullReady ? 'opacity-100' : 'opacity-0'
                    }`}
                    onLoad={() => setFullReady(true)}
                  />
                ) : null}
              </button>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
