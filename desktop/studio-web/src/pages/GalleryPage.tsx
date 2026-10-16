import { startTransition, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Copy,
  Download,
  Expand,
  Heart,
  Loader2,
  Share2,
  Trash2,
  X
} from 'lucide-react'
import { WorkDetailMeta } from '@/components/WorkDetailMeta'
import {
  deleteGallery,
  findByCloudId,
  listGallery,
  newGalleryId,
  putGallery,
  setGalleryShowcaseId,
  toggleFavorite,
  type GalleryRecord
} from '@/lib/gallery-db'
import { blobToThumbUrl, yieldToMain } from '@/lib/gallery-thumb'
import { fetchAuthedBlob, listCloudGallery, shareToShowcase, unlistShowcase } from '@/lib/api'
import { formatDateTime, modeLabel } from '@/lib/format'
import type { GenerateMode } from '@/lib/types'
import { useSession } from '@/store/session'
import { useToast } from '@/store/toast'

type GalleryRow = GalleryRecord & { thumbUrl: string; fullUrl: string }
type BusyAction = 'share' | 'favorite' | 'delete' | 'export' | null

const BATCH = 4
const PAGE = 12

export function GalleryPage() {
  const apiKey = useSession((s) => s.user!.apiKey)
  const push = useToast((s) => s.push)
  const navigate = useNavigate()
  const [items, setItems] = useState<GalleryRow[]>([])
  const [visibleCount, setVisibleCount] = useState(PAGE)
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState<GalleryRow | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [busy, setBusy] = useState<BusyAction>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const sentinelRef = useRef<HTMLDivElement>(null)

  function revokeAll(rows: GalleryRow[]) {
    for (const i of rows) {
      URL.revokeObjectURL(i.thumbUrl)
      if (i.fullUrl && i.fullUrl !== i.thumbUrl) URL.revokeObjectURL(i.fullUrl)
    }
  }

  function patchRow(id: string, patch: Partial<GalleryRow>) {
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    setActive((cur) => (cur && cur.id === id ? { ...cur, ...patch } : cur))
  }

  async function reload() {
    const rows = await listGallery()
    setItems((prev) => {
      revokeAll(prev)
      return []
    })
    setVisibleCount(PAGE)
    setLoading(false)

    const built: GalleryRow[] = []
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH)
      const chunk = await Promise.all(
        slice.map(async (r) => {
          const thumbUrl = await blobToThumbUrl(r.blob)
          return { ...r, thumbUrl, fullUrl: '' }
        })
      )
      built.push(...chunk)
      startTransition(() => {
        setItems([...built])
      })
      await yieldToMain()
    }
  }

  async function syncCloud() {
    try {
      const { items: cloud } = await listCloudGallery({ apiKey, limit: 100 })
      let added = 0
      for (const c of cloud) {
        const existing = await findByCloudId(c.id)
        if (existing) continue
        const blob = await fetchAuthedBlob({ apiKey, path: c.image_url })
        await putGallery({
          id: newGalleryId(),
          taskId: `cloud:${c.id}`,
          blob,
          mimeType: c.mime_type || blob.type || 'image/png',
          prompt: c.prompt,
          negativePrompt: c.negative_prompt || undefined,
          width: c.width,
          height: c.height,
          steps: c.steps,
          seed: c.seed,
          mode: (c.mode as GenerateMode) || 'txt2img',
          createdAt: c.created_at,
          favorite: false,
          showcaseId: null,
          cloudId: c.id
        })
        added += 1
        await yieldToMain()
      }
      if (added) await reload()
    } catch {
      /* offline / API down — local gallery still works */
    }
  }

  useEffect(() => {
    let cancelled = false
    const boot = async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      await yieldToMain()
      if (cancelled) return
      await reload()
      if (cancelled) return
      window.setTimeout(() => {
        if (!cancelled) void syncCloud()
      }, 600)
    }
    void boot()
    return () => {
      cancelled = true
      revokeAll(itemsRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey])

  useEffect(() => {
    if (!active && !fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (fullscreen) {
        setFullscreen(false)
        return
      }
      if (confirmDelete) {
        setConfirmDelete(false)
        return
      }
      setActive(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, fullscreen, confirmDelete])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || visibleCount >= items.length) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setVisibleCount((n) => Math.min(items.length, n + PAGE))
      },
      { rootMargin: '240px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [items.length, visibleCount])

  async function ensureFullUrl(item: GalleryRow): Promise<GalleryRow> {
    if (item.fullUrl) return item
    const fullUrl = URL.createObjectURL(item.blob)
    const next = { ...item, fullUrl }
    patchRow(item.id, { fullUrl })
    return next
  }

  async function openItem(item: GalleryRow) {
    setConfirmDelete(false)
    setFullscreen(false)
    const next = await ensureFullUrl(item)
    setActive(next)
  }

  function closeDetail() {
    if (busy) return
    setConfirmDelete(false)
    setFullscreen(false)
    setActive(null)
  }

  async function onShareOrUnlist(item: GalleryRow) {
    if (busy) return
    setBusy('share')
    try {
      if (item.showcaseId) {
        await unlistShowcase({ apiKey, itemId: item.showcaseId })
        await setGalleryShowcaseId(item.id, null)
        patchRow(item.id, { showcaseId: null })
        push('已从作品展馆下架', 'success')
      } else {
        const shared = await shareToShowcase({
          apiKey,
          prompt: item.prompt,
          negativePrompt: item.negativePrompt,
          mode: item.mode,
          width: item.width,
          height: item.height,
          steps: item.steps,
          seed: item.seed,
          image: item.blob
        })
        await setGalleryShowcaseId(item.id, shared.id)
        patchRow(item.id, { showcaseId: shared.id })
        push('已分享至作品展馆', 'success')
      }
    } catch (err) {
      push(err instanceof Error ? err.message : '操作失败', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function onFavorite(item: GalleryRow) {
    if (busy) return
    setBusy('favorite')
    try {
      const updated = await toggleFavorite(item.id)
      if (updated) {
        patchRow(item.id, { favorite: updated.favorite })
        push(updated.favorite ? '已收藏' : '已取消收藏', 'success')
      }
    } catch (err) {
      push(err instanceof Error ? err.message : '收藏失败', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function onCopy(item: GalleryRow) {
    try {
      await navigator.clipboard.writeText(item.prompt)
      push('已复制提示词', 'success')
    } catch {
      push('复制失败', 'error')
    }
  }

  function onReuse(item: GalleryRow) {
    sessionStorage.setItem(
      'comfy-studio-web-apply-prompt',
      JSON.stringify({
        prompt: item.prompt,
        negative: item.negativePrompt || '',
        width: item.width,
        height: item.height,
        steps: item.steps,
        seed: item.seed ?? '',
        mode: item.mode
      })
    )
    closeDetail()
    navigate('/create')
    push('已填入创作参数', 'success')
  }

  async function onExport(item: GalleryRow) {
    if (busy) return
    setBusy('export')
    try {
      const ready = await ensureFullUrl(item)
      const a = document.createElement('a')
      a.href = ready.fullUrl
      a.download = `${item.id}.${item.mimeType.includes('video') ? 'mp4' : 'png'}`
      a.click()
      push('已开始下载', 'success')
    } catch (err) {
      push(err instanceof Error ? err.message : '导出失败', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function onDelete(item: GalleryRow) {
    if (busy) return
    setBusy('delete')
    try {
      await deleteGallery(item.id)
      setItems((prev) => {
        const gone = prev.find((r) => r.id === item.id)
        if (gone) revokeAll([gone])
        return prev.filter((r) => r.id !== item.id)
      })
      setActive(null)
      setConfirmDelete(false)
      setFullscreen(false)
      push('已删除', 'success')
    } catch (err) {
      push(err instanceof Error ? err.message : '删除失败', 'error')
    } finally {
      setBusy(null)
    }
  }

  const visible = items.slice(0, visibleCount)
  const isVideo = Boolean(active?.mimeType.startsWith('video/'))
  const mediaSrc = active ? active.fullUrl || active.thumbUrl : ''

  return (
    <div className="page space-y-4">
      <div className="page-header mb-0">
        <h1 className="page-title">作品画廊</h1>
        <span className="status-chip">{loading ? '加载中…' : `${items.length} 件`}</span>
      </div>

      {loading ? (
        <div className="empty-state min-h-[16rem]">
          <p className="text-sm text-muted">加载作品…</p>
        </div>
      ) : !items.length ? (
        <div className="empty-state min-h-[16rem]">
          <p className="text-sm text-muted">暂无作品</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {visible.map((item) => (
              <button
                key={item.id}
                type="button"
                className="card gallery-card group overflow-hidden text-left transition hover:border-white/30"
                onClick={() => void openItem(item)}
              >
                <div className="media-thumb">
                  {item.mimeType.startsWith('video/') ? (
                    <video src={item.thumbUrl} muted preload="metadata" />
                  ) : (
                    <img
                      src={item.thumbUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="transition duration-200 group-hover:scale-[1.02]"
                    />
                  )}
                  {item.favorite ? (
                    <span className="absolute right-1.5 top-1.5 rounded-md bg-black/55 p-1">
                      <Heart className="h-3 w-3 fill-primary text-primary" />
                    </span>
                  ) : null}
                </div>
                <div className="space-y-1.5 p-2.5">
                  <p className="line-clamp-2 text-xs leading-relaxed text-text">{item.prompt}</p>
                  <p className="text-[10px] text-muted">{modeLabel(item.mode)}</p>
                </div>
              </button>
            ))}
          </div>
          {visibleCount < items.length ? (
            <div ref={sentinelRef} className="h-8" aria-hidden />
          ) : null}
        </>
      )}

      {active ? (
        <div
          className="fixed inset-y-0 right-0 z-50 flex bg-black/90 transition-[left] duration-200"
          style={{ left: 'var(--sidebar-w, 13rem)' }}
          role="dialog"
          aria-modal="true"
          aria-label="作品详情"
        >
          {/* Left: full-size original — replaces the old dimmed gallery area */}
          <div
            className="relative flex min-w-0 flex-1 items-center justify-center p-3 sm:p-5"
            onClick={closeDetail}
          >
            {isVideo ? (
              <video
                src={mediaSrc}
                controls
                className="max-h-full max-w-full object-contain"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <button
                type="button"
                className="group relative max-h-full max-w-full"
                title="点击全屏"
                onClick={(e) => {
                  e.stopPropagation()
                  setFullscreen(true)
                }}
              >
                <img
                  src={mediaSrc}
                  alt=""
                  className="max-h-[calc(100dvh-2.5rem)] max-w-full object-contain"
                />
                <span className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1 rounded-lg bg-black/55 px-2 py-1 text-[11px] text-white opacity-70 group-hover:opacity-100">
                  <Expand className="h-3.5 w-3.5" />
                  全屏
                </span>
              </button>
            )}
          </div>

          {/* Right: params + actions only */}
          <aside
            className="glass-panel flex h-full w-full max-w-md shrink-0 flex-col border-l border-white/10 shadow-panel sm:max-w-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h3 className="font-semibold text-text">作品详情</h3>
              <button
                type="button"
                className="btn-ghost !p-1"
                onClick={closeDetail}
                disabled={Boolean(busy)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <p className="text-[11px] text-muted">{formatDateTime(active.createdAt)}</p>

              <WorkDetailMeta
                prompt={active.prompt}
                negativePrompt={active.negativePrompt}
                width={active.width}
                height={active.height}
                steps={active.steps}
                seed={active.seed}
                mode={active.mode}
                taskId={active.taskId}
                footer={
                  active.showcaseId ? (
                    <p className="text-[11px] text-muted">
                      已分享展馆 · {active.showcaseId.slice(0, 8)}…
                    </p>
                  ) : null
                }
              />
            </div>

            <div className="space-y-2 border-t border-border p-4">
              <button
                type="button"
                className={active.showcaseId ? 'btn-danger w-full' : 'btn-secondary w-full'}
                disabled={busy === 'share'}
                onClick={() => void onShareOrUnlist(active)}
              >
                {busy === 'share' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Share2 className="h-4 w-4" />
                )}
                {busy === 'share'
                  ? active.showcaseId
                    ? '下架中…'
                    : '分享中…'
                  : active.showcaseId
                    ? '从展馆下架'
                    : '分享至作品展馆'}
              </button>

              <div className="grid grid-cols-2 gap-2">
                {!isVideo ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={Boolean(busy)}
                    onClick={() => setFullscreen(true)}
                  >
                    <Expand className="h-4 w-4" />
                    全屏
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy === 'favorite'}
                  onClick={() => void onFavorite(active)}
                >
                  {busy === 'favorite' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Heart
                      className={`h-4 w-4 ${active.favorite ? 'fill-primary text-primary' : ''}`}
                    />
                  )}
                  {active.favorite ? '已藏' : '收藏'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={Boolean(busy)}
                  onClick={() => void onCopy(active)}
                >
                  <Copy className="h-4 w-4" />
                  复制
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={Boolean(busy)}
                  onClick={() => onReuse(active)}
                >
                  复用
                </button>
                <button
                  type="button"
                  className={`btn-secondary ${isVideo ? '' : 'col-span-2'}`}
                  disabled={busy === 'export'}
                  onClick={() => void onExport(active)}
                >
                  {busy === 'export' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {busy === 'export' ? '导出中…' : '导出…'}
                </button>
              </div>

              {confirmDelete ? (
                <div className="space-y-2 rounded-lg border border-danger/35 bg-danger/10 p-3">
                  <p className="text-xs text-text">删除后不可恢复，确认删除这件作品？</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={busy === 'delete'}
                      onClick={() => setConfirmDelete(false)}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="btn-danger"
                      disabled={busy === 'delete'}
                      onClick={() => void onDelete(active)}
                    >
                      {busy === 'delete' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      {busy === 'delete' ? '删除中…' : '确认删除'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn-danger w-full"
                  disabled={Boolean(busy)}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  删除
                </button>
              )}
            </div>
          </aside>
        </div>
      ) : null}

      {fullscreen && active && !isVideo ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 p-4"
          onClick={() => setFullscreen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="全屏预览"
        >
          <button
            type="button"
            className="absolute right-4 top-4 z-10 rounded-xl border border-white/20 bg-black/50 p-2 text-white hover:bg-black/70"
            title="关闭全屏（Esc）"
            onClick={() => setFullscreen(false)}
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={mediaSrc}
            alt=""
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  )
}
