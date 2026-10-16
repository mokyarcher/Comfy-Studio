import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, Download, Expand, Loader2, Trash2, X } from 'lucide-react'
import { WorkDetailMeta } from '@/components/WorkDetailMeta'
import { findByShowcaseId } from '@/lib/gallery-db'
import { fetchAuthedBlob, listShowcase, unlistShowcase } from '@/lib/api'
import { formatDateTime, modeLabel } from '@/lib/format'
import type { GenerateMode, ShowcaseItem } from '@/lib/types'
import { useSession } from '@/store/session'
import { useToast } from '@/store/toast'

type Row = ShowcaseItem & { thumb?: string }
type BusyAction = 'download' | 'unlist' | null

export function ShowcasePage() {
  const apiKey = useSession((s) => s.user!.apiKey)
  const push = useToast((s) => s.push)
  const navigate = useNavigate()
  const [items, setItems] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState<Row | null>(null)
  const [activeUrl, setActiveUrl] = useState<string | null>(null)
  const [loadingFull, setLoadingFull] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [busy, setBusy] = useState<BusyAction>(null)
  /** Keep full-res object URLs across open/close — avoid re-download every click. */
  const fullCacheRef = useRef(new Map<string, string>())
  const inflightRef = useRef(new Map<string, Promise<string>>())
  const activeIdRef = useRef<string | null>(null)

  function clearFullCache() {
    for (const url of fullCacheRef.current.values()) URL.revokeObjectURL(url)
    fullCacheRef.current.clear()
    inflightRef.current.clear()
  }

  async function ensureFullUrl(item: Row): Promise<string> {
    const cached = fullCacheRef.current.get(item.id)
    if (cached) return cached

    const pending = inflightRef.current.get(item.id)
    if (pending) return pending

    const task = (async () => {
      // Own shares: prefer local gallery blob (already on disk / IndexedDB).
      if (item.mine) {
        try {
          const local = await findByShowcaseId(item.id)
          if (local?.blob) {
            const url = URL.createObjectURL(local.blob)
            fullCacheRef.current.set(item.id, url)
            return url
          }
        } catch {
          /* fall through to network */
        }
      }
      const blob = await fetchAuthedBlob({ apiKey, path: item.image_url })
      const url = URL.createObjectURL(blob)
      fullCacheRef.current.set(item.id, url)
      return url
    })().finally(() => {
      inflightRef.current.delete(item.id)
    })

    inflightRef.current.set(item.id, task)
    return task
  }

  async function reload() {
    setLoading(true)
    try {
      const { items: list } = await listShowcase({ apiKey, limit: 48 })
      const withThumbs: Row[] = []
      for (const item of list) {
        const path = item.thumb_url || item.image_url
        try {
          const blob = await fetchAuthedBlob({ apiKey, path })
          withThumbs.push({ ...item, thumb: URL.createObjectURL(blob) })
        } catch {
          withThumbs.push(item)
        }
      }
      setItems((prev) => {
        prev.forEach((p) => p.thumb && URL.revokeObjectURL(p.thumb))
        return withThumbs
      })
      // Drop stale full cache entries that are no longer in the list.
      const keep = new Set(list.map((i) => i.id))
      for (const [id, url] of fullCacheRef.current) {
        if (!keep.has(id)) {
          URL.revokeObjectURL(url)
          fullCacheRef.current.delete(id)
        }
      }
    } catch (err) {
      push(err instanceof Error ? err.message : '加载失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    return () => clearFullCache()
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
      closePreview()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, fullscreen])

  async function openItem(item: Row) {
    setFullscreen(false)
    activeIdRef.current = item.id
    setActive(item)

    const cached = fullCacheRef.current.get(item.id)
    if (cached) {
      setActiveUrl(cached)
      setLoadingFull(false)
      return
    }

    setActiveUrl(item.thumb || null)
    setLoadingFull(true)
    try {
      const url = await ensureFullUrl(item)
      if (activeIdRef.current !== item.id) return
      setActiveUrl(url)
    } catch (err) {
      if (activeIdRef.current === item.id) {
        push(err instanceof Error ? err.message : '加载原图失败', 'error')
      }
    } finally {
      if (activeIdRef.current === item.id) setLoadingFull(false)
    }
  }

  function closePreview() {
    if (busy) return
    activeIdRef.current = null
    setFullscreen(false)
    setActive(null)
    setActiveUrl(null)
    setLoadingFull(false)
  }

  async function onCopy(item: Row) {
    try {
      await navigator.clipboard.writeText(item.prompt)
      push('已复制提示词', 'success')
    } catch {
      push('复制失败', 'error')
    }
  }

  function onReuse(item: Row) {
    const mode: GenerateMode =
      item.mode === 'image_edit'
        ? 'image_edit'
        : item.mode === 'image_to_video'
          ? 'image_to_video'
          : 'txt2img'
    sessionStorage.setItem(
      'comfy-studio-web-apply-prompt',
      JSON.stringify({
        prompt: item.prompt,
        negative: item.negative_prompt || '',
        width: item.width,
        height: item.height,
        steps: item.steps,
        seed: item.seed ?? '',
        mode
      })
    )
    closePreview()
    navigate('/create')
    push('已填入创作参数', 'success')
  }

  async function onDownload(item: Row) {
    if (busy) return
    setBusy('download')
    try {
      const href = fullCacheRef.current.get(item.id) || (await ensureFullUrl(item))
      const a = document.createElement('a')
      a.href = href
      a.download = `showcase-${item.id.slice(0, 8)}.png`
      a.click()
      push('已开始下载', 'success')
    } catch (err) {
      push(err instanceof Error ? err.message : '下载失败', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function onUnlist(item: Row) {
    if (busy || !item.mine) return
    setBusy('unlist')
    try {
      await unlistShowcase({ apiKey, itemId: item.id })
      push('已从展馆下架', 'success')
      closePreview()
      void reload()
    } catch (err) {
      push(err instanceof Error ? err.message : '下架失败', 'error')
    } finally {
      setBusy(null)
    }
  }

  const mediaSrc = activeUrl || active?.thumb || ''

  return (
    <div className="page space-y-4">
      <div className="page-header mb-0">
        <div>
          <h1 className="page-title">作品展馆</h1>
          <p className="page-sub">来自本机服务端的共享作品。</p>
        </div>
        <button type="button" className="btn-secondary text-xs" onClick={() => void reload()}>
          刷新
        </button>
      </div>

      {loading ? <p className="text-sm text-muted">加载中…</p> : null}
      {!loading && !items.length ? (
        <div className="empty-state min-h-[16rem]">
          <p className="text-sm text-muted">暂无展馆作品</p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="card gallery-card overflow-hidden text-left transition hover:border-white/30"
            onClick={() => void openItem(item)}
          >
            <div className="media-thumb">
              {item.thumb ? (
                <img src={item.thumb} alt="" loading="lazy" decoding="async" />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center text-xs text-muted">
                  无预览
                </span>
              )}
            </div>
            <div className="space-y-1.5 p-2.5">
              <p className="line-clamp-2 text-xs leading-relaxed text-text">{item.prompt}</p>
              <div className="flex items-center justify-between gap-2 text-[10px] text-muted">
                <span className="truncate">
                  {item.author_name} · {modeLabel(item.mode)}
                </span>
                {item.mine ? <span className="shrink-0 text-accent">我的</span> : null}
              </div>
            </div>
          </button>
        ))}
      </div>

      {active ? (
        <div
          className="fixed inset-y-0 right-0 z-50 flex bg-black/90 transition-[left] duration-200"
          style={{ left: 'var(--sidebar-w, 13rem)' }}
          role="dialog"
          aria-modal="true"
          aria-label="展馆作品详情"
        >
          <div
            className="relative flex min-w-0 flex-1 items-center justify-center p-3 sm:p-5"
            onClick={closePreview}
          >
            {mediaSrc ? (
              <button
                type="button"
                className="group relative max-h-full max-w-full"
                title="点击全屏"
                onClick={(e) => {
                  e.stopPropagation()
                  if (!loadingFull) setFullscreen(true)
                }}
              >
                <img
                  src={mediaSrc}
                  alt=""
                  className="max-h-[calc(100dvh-2.5rem)] max-w-full object-contain"
                />
                {loadingFull ? (
                  <span className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-black/55 px-2 py-1 text-[11px] text-white/85">
                    加载原图…
                  </span>
                ) : (
                  <span className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1 rounded-lg bg-black/55 px-2 py-1 text-[11px] text-white opacity-70 group-hover:opacity-100">
                    <Expand className="h-3.5 w-3.5" />
                    全屏
                  </span>
                )}
              </button>
            ) : (
              <p className="text-sm text-muted">{loadingFull ? '加载原图…' : '无预览'}</p>
            )}
          </div>

          <aside
            className="glass-panel flex h-full w-full max-w-md shrink-0 flex-col border-l border-white/10 shadow-panel sm:max-w-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h3 className="font-semibold text-text">展馆作品</h3>
              <button
                type="button"
                className="btn-ghost !p-1"
                onClick={closePreview}
                disabled={Boolean(busy)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <WorkDetailMeta
                eyebrow={
                  <>
                    {active.author_name || active.author_username}
                    {' · '}
                    {formatDateTime(active.created_at)}
                    {active.mine ? ' · 我的分享' : ''}
                  </>
                }
                prompt={active.prompt}
                negativePrompt={active.negative_prompt}
                width={active.width}
                height={active.height}
                steps={active.steps}
                seed={active.seed}
                mode={active.mode}
                footer={
                  active.ref_urls?.length ? (
                    <p className="text-[11px] text-muted">参考图 {active.ref_urls.length} 张</p>
                  ) : null
                }
              />
            </div>

            <div className="space-y-2 border-t border-border p-4">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!mediaSrc || loadingFull || Boolean(busy)}
                  onClick={() => setFullscreen(true)}
                >
                  <Expand className="h-4 w-4" />
                  全屏
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
                  复用参数
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy === 'download'}
                  onClick={() => void onDownload(active)}
                >
                  {busy === 'download' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {busy === 'download' ? '下载中…' : '下载效果图'}
                </button>
              </div>

              {active.mine ? (
                <button
                  type="button"
                  className="btn-danger w-full"
                  disabled={busy === 'unlist'}
                  onClick={() => void onUnlist(active)}
                >
                  {busy === 'unlist' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  {busy === 'unlist' ? '下架中…' : '下架我的分享'}
                </button>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}

      {fullscreen && mediaSrc ? (
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
