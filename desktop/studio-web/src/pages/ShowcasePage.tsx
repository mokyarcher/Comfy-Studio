import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bookmark,
  Copy,
  Download,
  Expand,
  Heart,
  Loader2,
  MessageCircle,
  Trash2,
  X
} from 'lucide-react'
import { ImageLightbox } from '@/components/ImageLightbox'
import { WorkDetailMeta } from '@/components/WorkDetailMeta'
import { findByShowcaseId } from '@/lib/gallery-db'
import {
  addShowcaseComment,
  deleteShowcaseComment,
  fetchAuthedBlob,
  listShowcase,
  listShowcaseComments,
  toggleShowcaseFavorite,
  toggleShowcaseLike,
  unlistShowcase
} from '@/lib/api'
import { formatDateTime, modeLabel } from '@/lib/format'
import type { GenerateMode, ShowcaseComment, ShowcaseEngagement, ShowcaseItem } from '@/lib/types'
import { useSession } from '@/store/session'
import { useToast } from '@/store/toast'

type Row = ShowcaseItem & { thumb?: string }
type BusyAction = 'download' | 'unlist' | 'like' | 'favorite' | 'comment' | null

/** 6×2 dense grid — only decode thumbs for the current page. */
const PAGE_SIZE = 12

function applyEngagement(row: Row, eng: ShowcaseEngagement): Row {
  return { ...row, ...eng }
}

export function ShowcasePage() {
  const apiKey = useSession((s) => s.user!.apiKey)
  const push = useToast((s) => s.push)
  const navigate = useNavigate()
  const [items, setItems] = useState<Row[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState<Row | null>(null)
  const [activeUrl, setActiveUrl] = useState<string | null>(null)
  const [loadingFull, setLoadingFull] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [busy, setBusy] = useState<BusyAction>(null)
  const [comments, setComments] = useState<ShowcaseComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  /** Keep full-res object URLs across open/close — avoid re-download every click. */
  const fullCacheRef = useRef(new Map<string, string>())
  const inflightRef = useRef(new Map<string, Promise<string>>())
  const thumbInflight = useRef(new Set<string>())
  const listGen = useRef(0)
  const activeIdRef = useRef<string | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items

  function clearFullCache() {
    for (const url of fullCacheRef.current.values()) URL.revokeObjectURL(url)
    fullCacheRef.current.clear()
    inflightRef.current.clear()
  }

  function patchItem(id: string, patch: Partial<Row>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
    setActive((cur) => (cur && cur.id === id ? { ...cur, ...patch } : cur))
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

  async function ensurePageThumbs(from: number, until: number, generation: number) {
    const slice = itemsRef.current.slice(from, until)
    const pending = slice.filter((r) => !r.thumb && !thumbInflight.current.has(r.id))
    if (!pending.length) return

    for (const row of pending) thumbInflight.current.add(row.id)
    const results = await Promise.all(
      pending.map(async (row) => {
        const path = row.thumb_url || row.image_url
        try {
          const blob = await fetchAuthedBlob({ apiKey, path })
          return { id: row.id, thumb: URL.createObjectURL(blob) }
        } catch {
          return { id: row.id, thumb: '' }
        }
      })
    )
    if (generation !== listGen.current) {
      for (const r of results) {
        if (r.thumb) URL.revokeObjectURL(r.thumb)
        thumbInflight.current.delete(r.id)
      }
      return
    }
    const byId = new Map(results.map((r) => [r.id, r.thumb]))
    setItems((prev) =>
      prev.map((row) => {
        const thumb = byId.get(row.id)
        if (!thumb || row.thumb) return row
        return { ...row, thumb }
      })
    )
    for (const row of pending) thumbInflight.current.delete(row.id)
  }

  async function reload() {
    const generation = ++listGen.current
    thumbInflight.current.clear()
    setLoading(true)
    setPage(1)
    try {
      const { items: list } = await listShowcase({ apiKey, limit: 100 })
      if (generation !== listGen.current) return
      setItems((prev) => {
        prev.forEach((p) => p.thumb && URL.revokeObjectURL(p.thumb))
        return list
      })
      itemsRef.current = list
      // Drop stale full cache entries that are no longer in the list.
      const keep = new Set(list.map((i) => i.id))
      for (const [id, url] of fullCacheRef.current) {
        if (!keep.has(id)) {
          URL.revokeObjectURL(url)
          fullCacheRef.current.delete(id)
        }
      }
      if (activeIdRef.current) {
        const fresh = list.find((i) => i.id === activeIdRef.current)
        if (fresh) setActive((cur) => (cur ? { ...fresh, thumb: cur.thumb } : fresh))
      }
      await ensurePageThumbs(0, PAGE_SIZE, generation)
    } catch (err) {
      push(err instanceof Error ? err.message : '加载失败', 'error')
    } finally {
      if (generation === listGen.current) setLoading(false)
    }
  }

  async function loadComments(itemId: string) {
    setCommentsLoading(true)
    try {
      const { items: rows } = await listShowcaseComments({ apiKey, itemId, limit: 100 })
      if (activeIdRef.current === itemId) setComments(rows)
    } catch (err) {
      if (activeIdRef.current === itemId) {
        push(err instanceof Error ? err.message : '评论加载失败', 'error')
        setComments([])
      }
    } finally {
      if (activeIdRef.current === itemId) setCommentsLoading(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * PAGE_SIZE
  const pageItems = items.slice(pageStart, pageStart + PAGE_SIZE)

  useEffect(() => {
    void reload()
    return () => {
      listGen.current += 1
      clearFullCache()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  useEffect(() => {
    if (loading || !items.length) return
    void ensurePageThumbs(pageStart, pageStart + PAGE_SIZE, listGen.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safePage, pageStart, items.length, loading])

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
    setCommentDraft('')
    setComments([])
    void loadComments(item.id)

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
    setComments([])
    setCommentDraft('')
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

  async function onLike(item: Row) {
    if (busy) return
    setBusy('like')
    try {
      const eng = await toggleShowcaseLike({ apiKey, itemId: item.id })
      patchItem(item.id, applyEngagement(item, eng))
    } catch (err) {
      push(err instanceof Error ? err.message : '点赞失败', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function onFavorite(item: Row) {
    if (busy) return
    setBusy('favorite')
    try {
      const eng = await toggleShowcaseFavorite({ apiKey, itemId: item.id })
      patchItem(item.id, applyEngagement(item, eng))
    } catch (err) {
      push(err instanceof Error ? err.message : '收藏失败', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function onSubmitComment() {
    if (!active || busy) return
    const body = commentDraft.trim()
    if (!body) {
      push('请输入评论', 'error')
      return
    }
    setBusy('comment')
    try {
      const row = await addShowcaseComment({ apiKey, itemId: active.id, body })
      setComments((prev) => [...prev, row])
      setCommentDraft('')
      patchItem(active.id, { comment_count: (active.comment_count || 0) + 1 })
    } catch (err) {
      push(err instanceof Error ? err.message : '评论失败', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function onDeleteComment(c: ShowcaseComment) {
    if (!active || busy || !c.mine) return
    setBusy('comment')
    try {
      await deleteShowcaseComment({ apiKey, itemId: active.id, commentId: c.id })
      setComments((prev) => prev.filter((x) => x.id !== c.id))
      patchItem(active.id, {
        comment_count: Math.max(0, (active.comment_count || 1) - 1)
      })
    } catch (err) {
      push(err instanceof Error ? err.message : '删除失败', 'error')
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

      {!loading && items.length ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {pageItems.map((item) => (
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
                    <div className="h-full w-full animate-pulse bg-white/5" aria-hidden />
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
                  <div className="flex items-center gap-2.5 text-[10px] text-muted">
                    <span className="inline-flex items-center gap-0.5">
                      <Heart
                        className={`h-3 w-3 ${item.liked_by_me ? 'fill-primary text-primary' : ''}`}
                      />
                      {item.like_count || 0}
                    </span>
                    <span className="inline-flex items-center gap-0.5">
                      <Bookmark
                        className={`h-3 w-3 ${item.favorited_by_me ? 'fill-primary text-primary' : ''}`}
                      />
                      {item.favorite_count || 0}
                    </span>
                    <span className="inline-flex items-center gap-0.5">
                      <MessageCircle className="h-3 w-3" />
                      {item.comment_count || 0}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
          {items.length > PAGE_SIZE ? (
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              <button
                type="button"
                className="btn-secondary px-3 py-1.5 text-xs"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </button>
              <span className="min-w-[5.5rem] text-center text-xs tabular-nums text-muted">
                {safePage} / {totalPages}
                <span className="ml-1.5 text-[11px] opacity-70">共 {items.length}</span>
              </span>
              <button
                type="button"
                className="btn-secondary px-3 py-1.5 text-xs"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                下一页
              </button>
            </div>
          ) : null}
        </>
      ) : null}

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

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted">
                  <MessageCircle className="h-3.5 w-3.5" />
                  评论 {active.comment_count || 0}
                </div>
                {commentsLoading ? (
                  <p className="text-xs text-muted">加载评论…</p>
                ) : null}
                {!commentsLoading && !comments.length ? (
                  <p className="text-xs text-muted">暂无评论</p>
                ) : null}
                <ul className="space-y-2">
                  {comments.map((c) => (
                    <li
                      key={c.id}
                      className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
                    >
                      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-muted">
                        <span className="truncate">
                          {c.author_name}
                          {c.mine ? ' · 我' : ''}
                          {' · '}
                          {formatDateTime(c.created_at)}
                        </span>
                        {c.mine ? (
                          <button
                            type="button"
                            className="shrink-0 text-muted hover:text-danger"
                            disabled={busy === 'comment'}
                            onClick={() => void onDeleteComment(c)}
                          >
                            删除
                          </button>
                        ) : null}
                      </div>
                      <p className="whitespace-pre-wrap text-xs leading-relaxed text-text">
                        {c.body}
                      </p>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="input flex-1 text-xs"
                    maxLength={500}
                    placeholder="写一句评论"
                    value={commentDraft}
                    disabled={busy === 'comment'}
                    onChange={(e) => setCommentDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void onSubmitComment()
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn-secondary shrink-0 text-xs"
                    disabled={busy === 'comment' || !commentDraft.trim()}
                    onClick={() => void onSubmitComment()}
                  >
                    {busy === 'comment' ? <Loader2 className="h-4 w-4 animate-spin" /> : '发送'}
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-2 border-t border-border p-4">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy === 'like'}
                  onClick={() => void onLike(active)}
                >
                  {busy === 'like' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Heart
                      className={`h-4 w-4 ${active.liked_by_me ? 'fill-primary text-primary' : ''}`}
                    />
                  )}
                  {active.liked_by_me ? '已赞' : '点赞'}
                  {(active.like_count || 0) > 0 ? ` ${active.like_count}` : ''}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy === 'favorite'}
                  onClick={() => void onFavorite(active)}
                >
                  {busy === 'favorite' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Bookmark
                      className={`h-4 w-4 ${
                        active.favorited_by_me ? 'fill-primary text-primary' : ''
                      }`}
                    />
                  )}
                  {active.favorited_by_me ? '已藏' : '收藏'}
                  {(active.favorite_count || 0) > 0 ? ` ${active.favorite_count}` : ''}
                </button>
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
        <ImageLightbox src={mediaSrc} onClose={() => setFullscreen(false)} />
      ) : null}
    </div>
  )
}
