import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { DemoFeature, DemoImage, DemoManifest } from '../data/demo'
import { withBase } from '../lib/paths'

type Mode = 'image' | 'video'

type Props = {
  manifest: DemoManifest
}

function mediaUrl(path: string) {
  return withBase(path.replace(/^\//, ''))
}

export function DemoPanel({ manifest }: Props) {
  const features = manifest.features ?? []
  const [activeId, setActiveId] = useState(features[0]?.id ?? '')
  const [mode, setMode] = useState<Mode>('image')
  const [imageIndex, setImageIndex] = useState(0)
  const [zoomed, setZoomed] = useState(false)

  useEffect(() => {
    if (!features.some((f) => f.id === activeId) && features[0]) {
      setActiveId(features[0].id)
    }
  }, [features, activeId])

  useEffect(() => {
    setImageIndex(0)
    setZoomed(false)
  }, [activeId])

  const active = useMemo(
    () => features.find((f) => f.id === activeId) ?? features[0],
    [features, activeId]
  )

  const images = active?.images ?? []
  const safeIndex = images.length ? Math.min(imageIndex, images.length - 1) : 0
  const currentImage = images[safeIndex]

  useEffect(() => {
    if (!zoomed) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setZoomed(false)
        return
      }
      const n = images.length
      if (n <= 1) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setImageIndex((i) => (i - 1 + n) % n)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setImageIndex((i) => (i + 1) % n)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomed, images.length])

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)] lg:items-stretch">
      <ol className="flex h-full flex-col gap-3">
        {features.map((step, i) => {
          const on = step.id === active?.id
          return (
            <motion.li
              key={step.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <button
                type="button"
                onClick={() => {
                  setActiveId(step.id)
                  setMode('image')
                }}
                className={`flex w-full gap-4 rounded-xl border p-4 text-left transition ${
                  on
                    ? 'border-accent/45 bg-accent/10'
                    : 'border-border bg-panel/60 hover:border-accent/30'
                }`}
              >
                <span
                  className={`display flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-sm ${
                    on
                      ? 'border-accent/40 bg-accent/15 text-accent'
                      : 'border-accent/30 bg-accent/10 text-accent'
                  }`}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-medium text-text">{step.title}</h3>
                  <p className="mt-1 text-sm text-muted">{step.body}</p>
                </div>
              </button>
            </motion.li>
          )
        })}
      </ol>

      <div className="flex min-h-[32rem] flex-col overflow-hidden rounded-xl border border-border bg-panel lg:h-full lg:min-h-0">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <p className="text-sm font-medium text-text">产品演示</p>
          <div className="flex rounded-md border border-border bg-bg-elevated p-0.5">
            <ModeButton active={mode === 'image'} onClick={() => setMode('image')}>
              图片演示
            </ModeButton>
            <ModeButton
              active={mode === 'video'}
              onClick={() => {
                setMode('video')
                setZoomed(false)
              }}
            >
              视频演示
            </ModeButton>
          </div>
        </div>

        <div className="min-h-0 flex-1 bg-bg-elevated">
          {mode === 'image' && active ? (
            <ImageCarousel
              feature={active}
              index={safeIndex}
              onIndexChange={setImageIndex}
              onToggleZoom={() => setZoomed((z) => !z)}
            />
          ) : (
            <video
              key={manifest.video}
              className="h-full w-full object-contain"
              controls
              preload="metadata"
              poster={mediaUrl(manifest.videoPoster || 'og.svg')}
            >
              <source src={mediaUrl(manifest.video)} type="video/mp4" />
              浏览器不支持视频播放，可先看图片演示。
            </video>
          )}
        </div>

        <div className="shrink-0 border-t border-border bg-panel px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
            <div className="min-w-0 shrink-0">
              <p className="text-[11px] text-muted">当前功能</p>
              <p className="mt-0.5 display text-base text-text sm:text-lg">{active?.title || '—'}</p>
            </div>
            <div className="min-w-0 flex-1 sm:text-right">
              <p className="text-[11px] text-muted">演示说明</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
                {mode === 'image' && currentImage?.note?.trim()
                  ? currentImage.note
                  : mode === 'video'
                    ? '视频导览'
                    : '\u00a0'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {zoomed && mode === 'image' && currentImage ? (
          <motion.div
            role="dialog"
            aria-label="放大预览"
            className="fixed inset-0 z-[80] flex cursor-zoom-out items-center justify-center bg-bg/80 p-6 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setZoomed(false)}
          >
            <div className="flex max-w-full items-center gap-2 sm:gap-3">
              {images.length > 1 ? (
                <button
                  type="button"
                  aria-label="上一张"
                  className="flex h-20 w-12 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border/80 bg-bg/85 text-3xl leading-none text-text backdrop-blur hover:bg-panel sm:h-24 sm:w-14"
                  onClick={(e) => {
                    e.stopPropagation()
                    setImageIndex((i) => (i - 1 + images.length) % images.length)
                  }}
                >
                  ‹
                </button>
              ) : null}
              <motion.img
                key={currentImage.src}
                src={mediaUrl(currentImage.src)}
                alt={currentImage.caption || active?.title || '演示'}
                className="max-h-[85vh] max-w-[min(85vw,calc(100vw-8rem))] cursor-zoom-out rounded-lg border border-border object-contain shadow-2xl"
                initial={{ scale: 0.92, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.96, opacity: 0 }}
                transition={{ duration: 0.22 }}
                onClick={(e) => {
                  e.stopPropagation()
                  setZoomed(false)
                }}
              />
              {images.length > 1 ? (
                <button
                  type="button"
                  aria-label="下一张"
                  className="flex h-20 w-12 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border/80 bg-bg/85 text-3xl leading-none text-text backdrop-blur hover:bg-panel sm:h-24 sm:w-14"
                  onClick={(e) => {
                    e.stopPropagation()
                    setImageIndex((i) => (i + 1) % images.length)
                  }}
                >
                  ›
                </button>
              ) : null}
            </div>
            {images.length > 1 ? (
              <p className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-bg/70 px-3 py-1 text-xs text-muted backdrop-blur">
                {(currentImage.caption || active?.title || '') +
                  ` · ${safeIndex + 1}/${images.length}`}
              </p>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function ModeButton({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-3 py-1 text-xs transition ${
        active ? 'bg-accent/20 text-accent' : 'text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}

function ImageCarousel({
  feature,
  index,
  onIndexChange,
  onToggleZoom
}: {
  feature: DemoFeature
  index: number
  onIndexChange: (i: number) => void
  onToggleZoom: () => void
}) {
  const images = feature.images ?? []
  const [broken, setBroken] = useState<Record<string, boolean>>({})
  const dragRef = useRef(false)
  const count = images.length
  const current = count ? images[Math.min(index, count - 1)] : null

  useEffect(() => {
    setBroken({})
  }, [feature.id])

  function go(delta: number) {
    if (!count) return
    onIndexChange((index + delta + count) % count)
  }

  if (!count) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">该功能暂无截图</div>
    )
  }

  const brokenKey = `${feature.id}:${index}:${current?.src || ''}`
  const showPlaceholder = !current || broken[brokenKey]

  return (
    <div className="relative h-full w-full min-h-[16rem]">
      <AnimatePresence mode="wait">
        <motion.div
          key={brokenKey}
          className="absolute inset-0 cursor-zoom-in"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.12}
          onDragStart={() => {
            dragRef.current = true
          }}
          onDragEnd={(_, info) => {
            if (Math.abs(info.offset.x) > 48) {
              if (info.offset.x < 0) go(1)
              else go(-1)
            }
            window.setTimeout(() => {
              dragRef.current = false
            }, 0)
          }}
          onClick={() => {
            if (dragRef.current || showPlaceholder) return
            onToggleZoom()
          }}
        >
          {showPlaceholder ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-sm text-muted">
                {current?.caption || feature.title}
                {count > 1 ? ` · ${index + 1}/${count}` : ''}
              </p>
              <p className="font-mono text-[11px] text-muted/70">{current?.src}</p>
            </div>
          ) : (
            <img
              src={mediaUrl(current.src)}
              alt={current.caption || feature.title}
              className="h-full w-full object-contain"
              draggable={false}
              onError={() => setBroken((b) => ({ ...b, [brokenKey]: true }))}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {count > 1 ? (
        <>
          <button
            type="button"
            aria-label="上一张"
            className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-md border border-border/80 bg-bg/70 px-2 py-1.5 text-sm text-text backdrop-blur hover:bg-panel"
            onClick={(e) => {
              e.stopPropagation()
              go(-1)
            }}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="下一张"
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-md border border-border/80 bg-bg/70 px-2 py-1.5 text-sm text-text backdrop-blur hover:bg-panel"
            onClick={(e) => {
              e.stopPropagation()
              go(1)
            }}
          >
            ›
          </button>
        </>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 bg-gradient-to-t from-bg/85 to-transparent px-3 pb-3 pt-10">
        <p className="truncate text-xs text-text">
          {current?.caption || feature.title}
          {count > 1 ? ` · ${index + 1}/${count}` : ''}
        </p>
        {count > 1 ? (
          <div className="pointer-events-auto flex shrink-0 items-center gap-1.5">
            {images.map((_: DemoImage, i: number) => (
              <button
                key={i}
                type="button"
                aria-label={`第 ${i + 1} 张`}
                className={`h-1.5 rounded-full transition ${
                  i === index ? 'w-4 bg-accent' : 'w-1.5 bg-muted/50 hover:bg-muted'
                }`}
                onClick={() => onIndexChange(i)}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
