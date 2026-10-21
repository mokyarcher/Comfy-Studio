import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
  Bookmark,
  Copy,
  Download,
  Expand,
  Heart,
  Landmark,
  Loader2,
  MessageCircle,
  RefreshCw,
  X
} from 'lucide-react'
import type {
  ShowcaseComment,
  ShowcaseEngagement,
  ShowcaseItem
} from '../../../shared/types'
import { toUserErrorMessage } from '../../../shared/errors'
import {
  MediaGridColumnsPicker,
  mediaGridClass,
  mediaGridStyle,
  useMediaGridColumns
} from '../components/MediaGridColumns'
import { WorkDetailMeta } from '../components/WorkDetailMeta'
import { formatDateTime } from '../lib/format'
import { useAppStore } from '../stores/appStore'

type BusyAction = 'download' | 'unlist' | 'like' | 'favorite' | 'comment' | null

function withEngagementDefaults(item: ShowcaseItem): ShowcaseItem {
  return {
    ...item,
    like_count: item.like_count ?? 0,
    favorite_count: item.favorite_count ?? 0,
    comment_count: item.comment_count ?? 0,
    liked_by_me: item.liked_by_me ?? false,
    favorited_by_me: item.favorited_by_me ?? false
  }
}

function applyEngagement(item: ShowcaseItem, eng: ShowcaseEngagement): ShowcaseItem {
  return {
    ...item,
    like_count: eng.like_count,
    favorite_count: eng.favorite_count,
    comment_count: eng.comment_count,
    liked_by_me: eng.liked_by_me,
    favorited_by_me: eng.favorited_by_me
  }
}

export function ShowcasePage() {
  const activeProfileId = useAppStore((s) => s.activeProfileId)
  const applyReuse = useAppStore((s) => s.applyReuse)
  const showToast = useAppStore((s) => s.showToast)
  const qc = useQueryClient()
  const [selected, setSelected] = useState<ShowcaseItem | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [busy, setBusy] = useState<BusyAction>(null)
  const [comments, setComments] = useState<ShowcaseComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['showcase', activeProfileId],
    enabled: Boolean(activeProfileId),
    queryFn: async () => {
      const res = (await window.studio.listShowcase({
        profileId: activeProfileId,
        limit: 80
      })) as { items: ShowcaseItem[]; count: number }
      return res.items.map(withEngagementDefaults)
    }
  })

  const items = data ?? []
  const gridCols = useMediaGridColumns()

  function patchItemInList(id: string, patch: Partial<ShowcaseItem>) {
    qc.setQueryData<ShowcaseItem[]>(['showcase', activeProfileId], (prev) =>
      (prev ?? []).map((it) => (it.id === id ? { ...it, ...patch } : it))
    )
    setSelected((cur) => (cur && cur.id === id ? { ...cur, ...patch } : cur))
  }

  async function loadComments(itemId: string) {
    if (!activeProfileId) return
    setCommentsLoading(true)
    try {
      const res = (await window.studio.listShowcaseComments({
        profileId: activeProfileId,
        showcaseId: itemId,
        limit: 100
      })) as { items: ShowcaseComment[]; count: number }
      setComments(res.items)
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '评论加载失败')
      setComments([])
    } finally {
      setCommentsLoading(false)
    }
  }

  async function openDetail(item: ShowcaseItem) {
    const normalized = withEngagementDefaults(item)
    setSelected(normalized)
    setPreviewUrl(null)
    setFullscreen(false)
    setCommentDraft('')
    setComments([])
    if (!activeProfileId) return
    void loadComments(normalized.id)
    try {
      const url = (await window.studio.fetchShowcaseAsset({
        profileId: activeProfileId,
        path: normalized.image_url
      })) as string
      setPreviewUrl(url)
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '预览加载失败')
    }
  }

  function closeDetail() {
    setSelected(null)
    setPreviewUrl(null)
    setFullscreen(false)
    setComments([])
    setCommentDraft('')
    setBusy(null)
  }

  async function onLike(item: ShowcaseItem) {
    if (!activeProfileId || busy) return
    setBusy('like')
    try {
      const eng = (await window.studio.toggleShowcaseLike({
        profileId: activeProfileId,
        showcaseId: item.id
      })) as ShowcaseEngagement
      const next = applyEngagement(item, eng)
      patchItemInList(item.id, next)
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '点赞失败')
    } finally {
      setBusy(null)
    }
  }

  async function onFavorite(item: ShowcaseItem) {
    if (!activeProfileId || busy) return
    setBusy('favorite')
    try {
      const eng = (await window.studio.toggleShowcaseFavorite({
        profileId: activeProfileId,
        showcaseId: item.id
      })) as ShowcaseEngagement
      const next = applyEngagement(item, eng)
      patchItemInList(item.id, next)
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '收藏失败')
    } finally {
      setBusy(null)
    }
  }

  async function onSubmitComment() {
    if (!activeProfileId || !selected || busy) return
    const body = commentDraft.trim()
    if (!body) {
      showToast('error', '请输入评论')
      return
    }
    setBusy('comment')
    try {
      const c = (await window.studio.addShowcaseComment({
        profileId: activeProfileId,
        showcaseId: selected.id,
        body
      })) as ShowcaseComment
      setComments((prev) => [...prev, c])
      setCommentDraft('')
      patchItemInList(selected.id, {
        comment_count: (selected.comment_count || 0) + 1
      })
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '评论失败')
    } finally {
      setBusy(null)
    }
  }

  async function onDeleteComment(c: ShowcaseComment) {
    if (!activeProfileId || !selected || busy) return
    setBusy('comment')
    try {
      await window.studio.deleteShowcaseComment({
        profileId: activeProfileId,
        showcaseId: selected.id,
        commentId: c.id
      })
      setComments((prev) => prev.filter((x) => x.id !== c.id))
      patchItemInList(selected.id, {
        comment_count: Math.max(0, (selected.comment_count || 1) - 1)
      })
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '删除失败')
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    if (!selected && !fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (fullscreen) setFullscreen(false)
      else closeDetail()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, fullscreen])

  if (!activeProfileId) {
    return (
      <div className="flex h-full items-center justify-center p-5">
        <div className="card max-w-md p-6 text-center text-sm text-muted">请先登录</div>
      </div>
    )
  }

  return (
    <div className="relative h-full overflow-y-auto p-5">
      <div className="mb-5 flex items-center justify-between gap-4">
        <h1 className="page-title flex items-center gap-2">
          <Landmark className="h-5 w-5 text-primary" />
          作品展馆
        </h1>
        <div className="flex items-center gap-3">
          <MediaGridColumnsPicker />
          <button
            className="btn-secondary shrink-0"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            刷新
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="card flex h-64 items-center justify-center text-sm text-muted">加载中…</div>
      ) : isError ? (
        <div className="card flex h-64 flex-col items-center justify-center gap-3 text-sm text-muted">
          <p>{toUserErrorMessage(error)}</p>
          <button className="btn-secondary" onClick={() => void refetch()}>
            重试
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="card flex h-64 items-center justify-center text-sm text-muted">暂无分享</div>
      ) : (
        <div className={mediaGridClass(gridCols)} style={mediaGridStyle(gridCols)}>
          {items.map((item) => (
            <button
              key={item.id}
              className="card group overflow-hidden text-left transition hover:border-primary/40"
              onClick={() => void openDetail(item)}
            >
              <ShowcaseThumb
                profileId={activeProfileId}
                path={item.thumb_url || item.image_url}
              />
              <div className="space-y-1 p-3">
                <p className="line-clamp-2 text-xs text-text">{item.prompt}</p>
                <div className="flex items-center justify-between text-[11px] text-muted">
                  <span className="truncate">{item.author_name || item.author_username}</span>
                  <span>
                    {item.mode === 'image_edit'
                      ? '图生图'
                      : item.mode === 'image_to_video'
                        ? '图生视频'
                        : '文生图'}
                  </span>
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
      )}

      {selected && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-black/70"
          onClick={closeDetail}
          role="presentation"
        >
          <div
            className="flex h-full w-full max-w-lg flex-col border-l border-border bg-panel shadow-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="展馆作品"
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h3 className="font-semibold">展馆作品</h3>
              <button className="btn-ghost !p-1" onClick={closeDetail} disabled={Boolean(busy)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <div className="relative overflow-hidden rounded-lg border border-border bg-bg">
                {previewUrl ? (
                  <button
                    type="button"
                    className="group relative block w-full"
                    title="点击全屏查看"
                    onClick={() => setFullscreen(true)}
                  >
                    <img
                      src={previewUrl}
                      alt=""
                      className="max-h-[360px] w-full object-contain"
                    />
                    <span className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/65 px-2 py-1 text-[11px] text-white opacity-80 group-hover:opacity-100">
                      <Expand className="h-3.5 w-3.5" />
                      全屏
                    </span>
                  </button>
                ) : (
                  <div className="flex h-48 items-center justify-center text-sm text-muted">
                    加载中…
                  </div>
                )}
              </div>
              <WorkDetailMeta
                eyebrow={
                  <>
                    {selected.author_name || selected.author_username}
                    {' · '}
                    {formatDateTime(selected.created_at)}
                    {selected.mine ? ' · 我的分享' : ''}
                  </>
                }
                prompt={selected.prompt}
                negativePrompt={selected.negative_prompt}
                width={selected.width}
                height={selected.height}
                steps={selected.steps}
                seed={selected.seed}
                mode={selected.mode}
                elapsedMs={selected.elapsed_ms}
                refCount={selected.ref_count}
              />
              {selected.ref_count > 0 && selected.ref_urls?.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted">引用图</p>
                  <div className="flex flex-wrap gap-2">
                    {selected.ref_urls.map((path, i) => (
                      <ShowcaseRefChip
                        key={path}
                        profileId={activeProfileId}
                        path={path}
                        label={`参考 ${i + 1}`}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted">
                  <MessageCircle className="h-3.5 w-3.5" />
                  评论 {selected.comment_count || 0}
                </div>
                {commentsLoading ? <p className="text-xs text-muted">加载评论…</p> : null}
                {!commentsLoading && !comments.length ? (
                  <p className="text-xs text-muted">暂无评论</p>
                ) : null}
                <ul className="space-y-2">
                  {comments.map((c) => (
                    <li
                      key={c.id}
                      className="rounded-xl border border-border bg-bg/60 px-3 py-2"
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
                  className="btn-secondary"
                  disabled={busy === 'like'}
                  onClick={() => void onLike(selected)}
                >
                  {busy === 'like' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Heart
                      className={`h-4 w-4 ${selected.liked_by_me ? 'fill-primary text-primary' : ''}`}
                    />
                  )}
                  {selected.liked_by_me ? '已赞' : '点赞'}
                  {(selected.like_count || 0) > 0 ? ` ${selected.like_count}` : ''}
                </button>
                <button
                  className="btn-secondary"
                  disabled={busy === 'favorite'}
                  onClick={() => void onFavorite(selected)}
                >
                  {busy === 'favorite' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Bookmark
                      className={`h-4 w-4 ${
                        selected.favorited_by_me ? 'fill-primary text-primary' : ''
                      }`}
                    />
                  )}
                  {selected.favorited_by_me ? '已藏' : '收藏'}
                  {(selected.favorite_count || 0) > 0 ? ` ${selected.favorite_count}` : ''}
                </button>
                <button
                  className="btn-secondary"
                  disabled={!previewUrl}
                  onClick={() => setFullscreen(true)}
                >
                  <Expand className="h-4 w-4" />
                  全屏
                </button>
                <button
                  className="btn-secondary"
                  onClick={async () => {
                    await navigator.clipboard.writeText(selected.prompt)
                    showToast('success', '已复制')
                  }}
                >
                  <Copy className="h-4 w-4" />
                  复制
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    applyReuse({
                      prompt: selected.prompt,
                      negativePrompt: selected.negative_prompt || undefined,
                      width: selected.width,
                      height: selected.height,
                      steps: selected.steps,
                      seed: selected.seed,
                      mode:
                        selected.mode === 'image_edit'
                          ? 'image_edit'
                          : selected.mode === 'image_to_video'
                            ? 'image_to_video'
                            : 'txt2img'
                    })
                    showToast('info', '已回填到创作页')
                  }}
                >
                  复用参数
                </button>
                <button
                  className="btn-secondary"
                  disabled={busy === 'download' || !previewUrl}
                  onClick={async () => {
                    setBusy('download')
                    try {
                      const res = (await window.studio.downloadShowcaseImage({
                        profileId: activeProfileId,
                        path: selected.image_url,
                        showcaseId: selected.id,
                        suggestedName: `showcase-${selected.id.slice(0, 8)}.png`
                      })) as { ok: boolean; canceled?: boolean }
                      if (res.ok) showToast('success', '已下载效果图')
                    } catch (err) {
                      showToast('error', err instanceof Error ? err.message : '下载失败')
                    } finally {
                      setBusy(null)
                    }
                  }}
                >
                  <Download className="h-4 w-4" />
                  下载效果图
                </button>
              </div>
              {selected.mine && (
                <button
                  className="btn-danger w-full"
                  disabled={busy === 'unlist'}
                  onClick={async () => {
                    setBusy('unlist')
                    try {
                      const res = (await window.studio.unlistShowcase({
                        profileId: activeProfileId,
                        showcaseId: selected.id
                      })) as { alreadyGone?: boolean }
                      showToast(
                        'success',
                        res.alreadyGone ? '展馆中已无此作品，已清除本地标记' : '已从展馆下架'
                      )
                      closeDetail()
                      void refetch()
                    } catch (err) {
                      showToast('error', err instanceof Error ? err.message : '下架失败')
                    } finally {
                      setBusy(null)
                    }
                  }}
                >
                  下架我的分享
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {fullscreen && previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4"
          onClick={() => setFullscreen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="全屏预览"
        >
          <button
            type="button"
            className="absolute right-4 top-4 z-10 rounded-lg border border-white/20 bg-black/50 p-2 text-white hover:bg-black/70"
            title="关闭全屏（Esc）"
            onClick={() => setFullscreen(false)}
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={previewUrl}
            alt=""
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}

function ShowcaseThumb({ profileId, path }: { profileId: string; path: string }) {
  const { data } = useQuery({
    queryKey: ['showcase-thumb', profileId, path],
    queryFn: () =>
      window.studio.fetchShowcaseAsset({ profileId, path }) as Promise<string>
  })
  return (
    <div className="relative aspect-square w-full overflow-hidden bg-bg">
      {data ? (
        <img
          src={data}
          alt=""
          className="absolute inset-0 h-full w-full object-cover transition group-hover:scale-[1.02]"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted">…</div>
      )}
    </div>
  )
}

function ShowcaseRefChip({
  profileId,
  path,
  label
}: {
  profileId: string
  path: string
  label: string
}) {
  const { data } = useQuery({
    queryKey: ['showcase-ref', profileId, path],
    queryFn: () =>
      window.studio.fetchShowcaseAsset({ profileId, path }) as Promise<string>
  })
  if (!data) {
    return (
      <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-border bg-bg text-[10px] text-muted">
        {label}
      </div>
    )
  }
  return (
    <img
      src={data}
      alt={label}
      title={label}
      className="h-16 w-16 rounded-lg border border-border object-cover"
    />
  )
}
