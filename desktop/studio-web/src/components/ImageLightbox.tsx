import { Minus, Plus, RotateCcw, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const MIN_ZOOM = 1
const MAX_ZOOM = 5
const ZOOM_STEP = 0.25

type Props = {
  src: string
  alt?: string
  onClose: () => void
}

/**
 * Fullscreen image viewer with wheel/button zoom and drag-to-pan.
 * Used by Gallery / Showcase detail “全屏”.
 */
export function ImageLightbox({ src, alt = '', onClose }: Props) {
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

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
    function onMove(e: PointerEvent) {
      const d = dragRef.current
      if (!d) return
      setOffset({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) })
    }
    function onUp() {
      dragRef.current = null
      setDragging(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

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

  return createPortal(
    <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="图片放大预览"
      onClick={onClose}
    >
      <div className="image-lightbox-toolbar" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="image-lightbox-btn"
          title="缩小（-）"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => setZoomAround(zoom - ZOOM_STEP)}
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="image-lightbox-zoom-label">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className="image-lightbox-btn"
          title="放大（+）"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => setZoomAround(zoom + ZOOM_STEP)}
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="image-lightbox-btn"
          title="重置（0）"
          disabled={zoom === 1 && offset.x === 0 && offset.y === 0}
          onClick={resetView}
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button type="button" className="image-lightbox-btn" title="关闭（Esc）" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div
        ref={stageRef}
        className="image-lightbox-stage"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => {
          if (zoom <= MIN_ZOOM) return
          e.currentTarget.setPointerCapture(e.pointerId)
          dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
          setDragging(true)
        }}
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
        滚轮缩放 · 双击放大/还原 · 放大后拖拽
      </p>
    </div>,
    document.body
  )
}
