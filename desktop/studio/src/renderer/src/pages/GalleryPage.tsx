import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
  Copy,
  Expand,
  ExternalLink,
  FolderOpen,
  GalleryHorizontalEnd,
  Heart,
  Loader2,
  Share2,
  Trash2,
  X
} from 'lucide-react'
import type { GalleryItem } from '../../../shared/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { StableVideo } from '../components/StableVideo'
import { WorkDetailMeta } from '../components/WorkDetailMeta'
import { formatDateTime } from '../lib/format'
import { captureVideoPoster } from '../lib/videoPoster'
import { useAppStore } from '../stores/appStore'

type MediaInfo = { url: string; kind: 'image' | 'video'; mime: string }

export function GalleryPage() {
  const qc = useQueryClient()
  const applyReuse = useAppStore((s) => s.applyReuse)
  const showToast = useAppStore((s) => s.showToast)
  const activeProfileId = useAppStore((s) => s.activeProfileId)
  const [selected, setSelected] = useState<GalleryItem | null>(null)
  const [preview, setPreview] = useState<MediaInfo | null>(null)
  const [imageFullscreen, setImageFullscreen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [shareBusy, setShareBusy] = useState(false)

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['gallery'],
    queryFn: () => window.studio.listGallery() as Promise<GalleryItem[]>,
    refetchOnWindowFocus: true
  })

  const [previewMissing, setPreviewMissing] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)

  async function openDetail(item: GalleryItem) {
    setSelected(item)
    setImageFullscreen(false)
    setPreview(null)
    setPreviewMissing(false)
    setPreviewLoading(true)
    try {
      const info = (await window.studio.getGalleryMediaUrl(item.id)) as MediaInfo | null
      setPreview(info)
      setPreviewMissing(!info)
    } finally {
      setPreviewLoading(false)
    }
  }

  function closeDetail() {
    setSelected(null)
    setPreview(null)
    setPreviewMissing(false)
    setPreviewLoading(false)
    setImageFullscreen(false)
  }

  function openPreviewFullscreen() {
    if (!preview || preview.kind === 'video') return
    setImageFullscreen(true)
  }

  async function openWithSystemPlayer() {
    if (!selected) return
    const res = (await window.studio.openGalleryFile(selected.id)) as {
      ok: boolean
      message?: string
    }
    if (!res?.ok) showToast('error', res?.message || '无法打开系统播放器')
  }

  useEffect(() => {
    if (!imageFullscreen && !selected) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (imageFullscreen) setImageFullscreen(false)
        else closeDetail()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [imageFullscreen, selected])

  const previewIsVideo = preview?.kind === 'video'

  return (
    <div className="relative h-full overflow-y-auto p-5">
      <div className="mb-5">
        <h1 className="page-title flex items-center gap-2">
          <GalleryHorizontalEnd className="h-5 w-5 text-primary" />
          作品画廊
        </h1>
      </div>

      {isLoading ? (
        <div className="card flex h-64 items-center justify-center text-sm text-muted">加载中…</div>
      ) : items.length === 0 ? (
        <div className="card flex h-64 items-center justify-center text-sm text-muted">暂无作品</div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => (
            <button
              key={item.id}
              className="card group overflow-hidden text-left transition hover:border-primary/40"
              onClick={() => void openDetail(item)}
            >
              <GalleryThumb id={item.id} />
              <div className="space-y-1 p-3">
                <p className="line-clamp-2 text-xs text-text">{item.prompt}</p>
                <div className="flex items-center justify-between text-[11px] text-muted">
                  <span>{formatDateTime(item.createdAt)}</span>
                  {item.favorite && <Heart className="h-3 w-3 fill-primary text-primary" />}
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
            aria-label="作品详情"
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h3 className="font-semibold">作品详情</h3>
              <button className="btn-ghost !p-1" onClick={closeDetail}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <div className="relative mb-4 overflow-hidden rounded-xl border border-border bg-bg">
                {preview ? (
                  previewIsVideo ? (
                    <StableVideo
                      src={preview.url}
                      className="max-h-[360px] w-full object-contain"
                      onOpenExternal={() => void openWithSystemPlayer()}
                    />
                  ) : (
                    <button
                      type="button"
                      className="group relative block w-full"
                      title="点击全屏查看"
                      onClick={openPreviewFullscreen}
                    >
                      <img
                        src={preview.url}
                        alt=""
                        className="max-h-[360px] w-full object-contain"
                      />
                      <span className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded-lg bg-black/60 px-2 py-1 text-[11px] text-white opacity-80 group-hover:opacity-100">
                        <Expand className="h-3.5 w-3.5" />
                        全屏
                      </span>
                    </button>
                  )
                ) : previewLoading ? (
                  <div className="flex h-48 items-center justify-center text-sm text-muted">
                    加载预览…
                  </div>
                ) : previewMissing ? (
                  <LocalMediaMissingNotice className="min-h-48 px-6 py-8" />
                ) : (
                  <div className="flex h-48 items-center justify-center text-sm text-muted">
                    加载预览…
                  </div>
                )}
              </div>
              <WorkDetailMeta
                prompt={selected.prompt}
                negativePrompt={selected.negativePrompt}
                width={selected.width}
                height={selected.height}
                steps={selected.steps}
                seed={selected.seed}
                mode={selected.mode}
                elapsedMs={selected.elapsedMs}
                refCount={selected.refPaths?.length}
                taskId={selected.taskId}
                footer={
                  selected.showcaseId ? (
                    <p className="text-[11px] text-muted">
                      已分享展馆 · {selected.showcaseId.slice(0, 8)}…
                    </p>
                  ) : null
                }
              />
            </div>
            <div className="space-y-2 border-t border-border p-4">
              {previewIsVideo && (
                <button className="btn-primary w-full" onClick={() => void openWithSystemPlayer()}>
                  <ExternalLink className="h-4 w-4" />
                  用系统播放器打开
                </button>
              )}

              {selected.showcaseId ? (
                <button
                  className="btn-danger w-full"
                  disabled={shareBusy || !activeProfileId}
                  onClick={async () => {
                    if (!activeProfileId || !selected.showcaseId) return
                    setShareBusy(true)
                    try {
                      const res = (await window.studio.unlistShowcase({
                        profileId: activeProfileId,
                        showcaseId: selected.showcaseId,
                        galleryId: selected.id
                      })) as { galleryItem?: GalleryItem | null; alreadyGone?: boolean }
                      if (res.galleryItem) setSelected(res.galleryItem)
                      else setSelected({ ...selected, showcaseId: null })
                      void qc.invalidateQueries({ queryKey: ['gallery'] })
                      void qc.invalidateQueries({ queryKey: ['showcase'] })
                      showToast(
                        'success',
                        res.alreadyGone ? '展馆中已无此作品，已清除本地标记' : '已从作品展馆下架'
                      )
                    } catch (err) {
                      showToast('error', err instanceof Error ? err.message : '下架失败')
                    } finally {
                      setShareBusy(false)
                    }
                  }}
                >
                  {shareBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Share2 className="h-4 w-4" />
                  )}
                  从展馆下架
                </button>
              ) : (
                <button
                  className="btn-secondary w-full"
                  disabled={shareBusy || !activeProfileId}
                  onClick={async () => {
                    if (!activeProfileId) return
                    setShareBusy(true)
                    try {
                      const res = (await window.studio.shareGalleryToShowcase({
                        profileId: activeProfileId,
                        galleryId: selected.id
                      })) as { galleryItem?: GalleryItem | null }
                      if (res.galleryItem) setSelected(res.galleryItem)
                      void qc.invalidateQueries({ queryKey: ['gallery'] })
                      void qc.invalidateQueries({ queryKey: ['showcase'] })
                      showToast('success', '已分享至作品展馆')
                    } catch (err) {
                      showToast('error', err instanceof Error ? err.message : '分享失败')
                    } finally {
                      setShareBusy(false)
                    }
                  }}
                >
                  {shareBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Share2 className="h-4 w-4" />
                  )}
                  分享至作品展馆
                </button>
              )}

              <div className={`grid gap-2 ${previewIsVideo ? 'grid-cols-3' : 'grid-cols-2'}`}>
                {!previewIsVideo && (
                  <button
                    className="btn-secondary"
                    onClick={openPreviewFullscreen}
                    disabled={!preview}
                  >
                    <Expand className="h-4 w-4" />
                    全屏
                  </button>
                )}
                <button
                  className="btn-secondary"
                  onClick={async () => {
                    await window.studio.toggleFavorite(selected.id, !selected.favorite)
                    setSelected({ ...selected, favorite: !selected.favorite })
                    void qc.invalidateQueries({ queryKey: ['gallery'] })
                  }}
                >
                  <Heart
                    className={`h-4 w-4 ${selected.favorite ? 'fill-primary text-primary' : ''}`}
                  />
                  {selected.favorite ? '已藏' : '收藏'}
                </button>
                <button
                  className="btn-secondary"
                  onClick={async () => {
                    await navigator.clipboard.writeText(selected.prompt)
                    showToast('success', '已复制提示词')
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
                      negativePrompt: selected.negativePrompt,
                      width: selected.width,
                      height: selected.height,
                      steps: selected.steps,
                      seed: selected.seed,
                      mode: selected.mode
                    })
                    showToast('info', '已填入创作参数')
                  }}
                >
                  复用
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  className="btn-secondary"
                  onClick={async () => {
                    await window.studio.openInFolder(selected.id)
                  }}
                >
                  <FolderOpen className="h-4 w-4" />
                  文件夹
                </button>
                <button
                  className="btn-secondary"
                  onClick={async () => {
                    const res = await window.studio.exportImage(selected.id)
                    if (res?.canceled) return
                    showToast('success', '已导出')
                  }}
                >
                  导出…
                </button>
              </div>

              <button className="btn-danger w-full" onClick={() => setDeleteId(selected.id)}>
                <Trash2 className="h-4 w-4" />
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {imageFullscreen && preview && preview.kind === 'image' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4"
          onClick={() => setImageFullscreen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="全屏预览"
        >
          <button
            type="button"
            className="absolute right-4 top-4 z-10 rounded-xl border border-white/20 bg-black/50 p-2 text-white hover:bg-black/70"
            title="关闭全屏（Esc）"
            onClick={() => setImageFullscreen(false)}
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={preview.url}
            alt=""
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteId)}
        title="删除作品？"
        message="将删除本地图片文件与元数据，此操作不可恢复。"
        confirmText="删除"
        danger
        onCancel={() => setDeleteId(null)}
        onConfirm={async () => {
          if (!deleteId) return
          await window.studio.deleteGalleryItem(deleteId)
          if (selected?.id === deleteId) {
            closeDetail()
          }
          setDeleteId(null)
          void qc.invalidateQueries({ queryKey: ['gallery'] })
          showToast('success', '已删除')
        }}
      />
    </div>
  )
}

function LocalMediaMissingNotice({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 text-center ${className}`}
    >
      <p className="text-sm font-medium text-text">本地图片已被删除，无法查看</p>
      <p className="text-xs text-muted">请尝试重新生成</p>
      <p className="max-w-[240px] text-[11px] leading-relaxed text-muted/80">
        服务器不会以任何形式保存您的作品（作品展馆除外）
      </p>
    </div>
  )
}

function GalleryThumb({ id }: { id: string }) {
  const { data, isFetched, isLoading } = useQuery({
    queryKey: ['gallery-thumb', id],
    queryFn: () => window.studio.getGalleryMediaUrl(id) as Promise<MediaInfo | null>
  })
  const {
    data: poster,
    isLoading: posterLoading,
    isError: posterError
  } = useQuery({
    queryKey: ['gallery-video-poster', id, data?.url],
    enabled: Boolean(data?.kind === 'video' && data.url),
    staleTime: Infinity,
    retry: 1,
    queryFn: () => captureVideoPoster(data!.url)
  })

  const showImg = data?.kind === 'image' ? data.url : poster

  return (
    <div className="aspect-square bg-bg">
      {showImg ? (
        <div className="relative h-full w-full">
          <img
            src={showImg}
            alt=""
            className="h-full w-full object-cover transition group-hover:scale-[1.02]"
          />
          {data?.kind === 'video' && (
            <span className="absolute bottom-1.5 left-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
              视频
            </span>
          )}
        </div>
      ) : data?.kind === 'video' && posterError ? (
        <div className="relative flex h-full w-full items-center justify-center bg-[#1a1c24] text-xs text-muted">
          视频
          <span className="absolute bottom-1.5 left-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
            视频
          </span>
        </div>
      ) : isLoading || !isFetched || (data?.kind === 'video' && posterLoading) ? (
        <div className="flex h-full items-center justify-center text-xs text-muted">…</div>
      ) : (
        <LocalMediaMissingNotice className="h-full px-3 py-4" />
      )}
    </div>
  )
}
