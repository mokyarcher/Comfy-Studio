import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ShowcaseItem } from '../data/showcase'

type Props = {
  items: ShowcaseItem[]
}

/** Dual-column vertical marquee — hero visual, thumbs only until lightbox. */
export function ShowcaseMarquee({ items }: Props) {
  const [active, setActive] = useState<ShowcaseItem | null>(null)
  const [fullReady, setFullReady] = useState(false)

  const photos = items.filter((i) => i.thumb || i.image)
  const colA = photos.filter((_, i) => i % 2 === 0)
  const colB = photos.filter((_, i) => i % 2 === 1)

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

  if (!photos.length) return null

  return (
    <>
      <div className="showcase-marquee relative mx-auto h-[min(68vh,34rem)] w-full max-w-lg select-none lg:max-w-none">
        <div className="showcase-marquee-fade pointer-events-none absolute inset-x-0 top-0 z-10 h-16" />
        <div className="showcase-marquee-fade-b pointer-events-none absolute inset-x-0 bottom-0 z-10 h-20" />
        <div className="grid h-full grid-cols-2 gap-2.5 overflow-hidden sm:gap-3">
          <MarqueeColumn items={colA} direction="up" onOpen={setActive} />
          <MarqueeColumn items={colB.length ? colB : colA} direction="down" onOpen={setActive} />
        </div>
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

function MarqueeColumn({
  items,
  direction,
  onOpen
}: {
  items: ShowcaseItem[]
  direction: 'up' | 'down'
  onOpen: (item: ShowcaseItem) => void
}) {
  const loop = [...items, ...items]
  return (
    <div className="relative h-full overflow-hidden">
      <div
        className={`showcase-marquee-track flex flex-col gap-2.5 sm:gap-3 ${
          direction === 'up' ? 'showcase-marquee-up' : 'showcase-marquee-down'
        }`}
      >
        {loop.map((item, i) => {
          const src = item.thumb || item.image!
          return (
            <button
              key={`${item.id}-${i}`}
              type="button"
              className="group relative block w-full shrink-0 overflow-hidden rounded-lg outline-none ring-0 focus-visible:ring-2 focus-visible:ring-accent/60"
              onClick={() => onOpen(item)}
              aria-label={item.prompt || '查看样例'}
            >
              <img
                src={src}
                alt=""
                loading={i < items.length ? 'eager' : 'lazy'}
                decoding="async"
                width={480}
                height={480}
                className="aspect-[4/5] w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                draggable={false}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
