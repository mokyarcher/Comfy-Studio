import { Minus, Plus, RotateCcw, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const MIN_ZOOM = 1
const MAX_ZOOM = 5
const ZOOM_STEP = 0.25
const DOUBLE_TAP_MS = 300
const SWIPE_CLOSE_PX = 90

type Props = {
  src: string
  alt?: string
  onClose: () => void
}

type Pt = { x: number; y: number }

function dist(a: Pt, b: Pt) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.hypot(dx, dy)
}

function mid(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/**
 * Fullscreen image viewer: wheel / buttons / pinch zoom, drag or one-finger pan.
 * Touch: pinch, double-tap zoom, swipe-down to close at 100%.
 */
export function ImageLightbox({ src, alt = '', onClose }: Props) {
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const pointersRef = useRef(new Map<number, Pt>())
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null)
  const swipeRef = useRef<{ y: number; moved: boolean } | null>(null)
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null)
  const suppressClickRef = useRef(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(zoom)
  const offsetRef = useRef(offset)
  zoomRef.current = zoom
  offsetRef.current = offset

  const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100))

  const setZoomAround = useCallback((next: number, clientX?: number, clientY?: number) => {
    setZoom((prev) => {
      const z = clampZoom(next)
      if (z === prev) return prev
      if (z <= MIN_ZOOM) {
        setOffset({ x: 0, y: 0 })
        return MIN_ZOOM
      }
      const el = stageRef.current
      if (el && clientX != null && clientY != null) {
        const r = el.getBoundingClientRect()
        const cx = clientX - r.left - r.width / 2
        const cy = clientY - r.top - r.height / 2
        const ratio = z / prev
        setOffset((o) => ({
          x: cx - (cx - o.x) * ratio,
          y: cy - (cy - o.y) * ratio
        }))
      }
      return z
    })
  }, [])

  const resetView = useCallback(() => {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === '+' || e.key === '=') setZoomAround(zoomRef.current + ZOOM_STEP)
      if (e.key === '-' || e.key === '_') setZoomAround(zoomRef.current - ZOOM_STEP)
      if (e.key === '0') resetView()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, resetView, setZoomAround])

  useEffect(() => {
    function pts(): Pt[] {
      return [...pointersRef.current.values()]
    }

    function onMove(e: PointerEvent) {
      if (!pointersRef.current.has(e.pointerId)) return
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const list = pts()

      if (list.length >= 2 && pinchRef.current) {
        const d = dist(list[0], list[1])
        if (d > 0 && pinchRef.current.dist > 0) {
          const ratio = d / pinchRef.current.dist
          const center = mid(list[0], list[1])
          setZoomAround(pinchRef.current.zoom * ratio, center.x, center.y)
        }
        suppressClickRef.current = true
        return
      }

      const d = dragRef.current
      if (d && zoomRef.current > MIN_ZOOM) {
        setOffset({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) })
        if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 6) {
          suppressClickRef.current = true
        }
        return
      }

      const sw = swipeRef.current
      if (sw && zoomRef.current <= MIN_ZOOM) {
        if (Math.abs(e.clientY - sw.y) > 12) sw.moved = true
      }
    }

    function onUp(e: PointerEvent) {
      pointersRef.current.delete(e.pointerId)
      if (pointersRef.current.size < 2) pinchRef.current = null

      if (dragRef.current) {
        dragRef.current = null
        setDragging(false)
      }

      const sw = swipeRef.current
      if (sw && zoomRef.current <= MIN_ZOOM && pointersRef.current.size === 0) {
        const dy = e.clientY - sw.y
        swipeRef.current = null
        if (sw.moved && dy > SWIPE_CLOSE_PX) {
          suppressClickRef.current = true
          onClose()
          return
        }
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [onClose, setZoomAround])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP
      setZoomAround(zoomRef.current + delta, e.clientX, e.clientY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setZoomAround])

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointersRef.current.size === 2) {
      const list = [...pointersRef.current.values()]
      pinchRef.current = { dist: dist(list[0], list[1]), zoom: zoomRef.current }
      dragRef.current = null
      swipeRef.current = null
      setDragging(false)
      return
    }

    // Double-tap zoom (touch / pen)
    if (e.pointerType !== 'mouse') {
      const now = Date.now()
      const last = lastTapRef.current
      if (
        last &&
        now - last.t < DOUBLE_TAP_MS &&
        Math.hypot(e.clientX - last.x, e.clientY - last.y) < 36
      ) {
        lastTapRef.current = null
        suppressClickRef.current = true
        if (zoomRef.current > 1) resetView()
        else setZoomAround(2.5, e.clientX, e.clientY)
        return
      }
      lastTapRef.current = { t: now, x: e.clientX, y: e.clientY }
    }

    if (zoomRef.current > MIN_ZOOM) {
      dragRef.current = {
        x: e.clientX,
        y: e.clientY,
        ox: offsetRef.current.x,
        oy: offsetRef.current.y
      }
      setDragging(true)
    } else {
      swipeRef.current = { y: e.clientY, moved: false }
    }
  }

  const touchHint =
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

  return createPortal(
    <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="图片放大预览"
      onClick={() => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false
          return
        }
        onClose()
      }}
    >
      <div className="image-lightbox-toolbar" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="image-lightbox-btn"
          title="缩小"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => setZoomAround(zoom - ZOOM_STEP)}
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="image-lightbox-zoom-label">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className="image-lightbox-btn"
          title="放大"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => setZoomAround(zoom + ZOOM_STEP)}
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="image-lightbox-btn"
          title="重置"
          disabled={zoom === 1 && offset.x === 0 && offset.y === 0}
          onClick={resetView}
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button type="button" className="image-lightbox-btn" title="关闭" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div
        ref={stageRef}
        className="image-lightbox-stage"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onDoubleClick={(e) => {
          e.preventDefault()
          if (zoom > 1) resetView()
          else setZoomAround(2, e.clientX, e.clientY)
        }}
        style={{ cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in' }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="image-lightbox-img"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`
          }}
        />
      </div>

      <p className="image-lightbox-hint" onClick={(e) => e.stopPropagation()}>
        {touchHint
          ? '双指捏合缩放 · 双击放大 · 放大后拖动 · 下滑关闭'
          : '滚轮缩放 · 双击放大/还原 · 放大后拖拽'}
      </p>
    </div>,
    document.body
  )
}
