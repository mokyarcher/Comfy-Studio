import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
  Copy,
  Expand,
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
import { formatDateTime } from '../lib/format'
import { useAppStore } from '../stores/appStore'

export function GalleryPage() {
  const qc = useQueryClient()
  const applyReuse = useAppStore((s) => s.applyReuse)
  const showToast = useAppStore((s) => s.showToast)
  const activeProfileId = useAppStore((s) => s.activeProfileId)
  const [selected, setSelected] = useState<GalleryItem | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [shareBusy, setShareBusy] = useState(false)

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['gallery'],
    queryFn: () => window.studio.listGallery() as Promise<GalleryItem[]>
  })

  async function openDetail(item: GalleryItem) {
    setSelected(item)
    setFullscreen(false)
    const url = await window.studio.readGalleryDataUrl(item.id)
    setPreviewUrl(url)
  }

  function closeDetail() {
    setSelected(null)
    setPreviewUrl(null)
    setFullscreen(false)
  }

  useEffect(() => {
    if (!fullscreen && !selected) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (fullscreen) setFullscreen(false)
        else closeDetail()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen, selected])

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
                {previewUrl ? (
                  <button
                    type="button"
                    className="group relative block w-full"
                    title="点击全屏查看"
                    onClick={() => setFullscreen(true)}
                  >
                    {previewUrl.startsWith('data:video/') ? (
                      <video
                        src={previewUrl}
                        controls
                        playsInline
                        className="max-h-[360px] w-full object-contain"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <img
                        src={previewUrl}
                        alt=""
                        className="max-h-[360px] w-full object-contain"
                      />
                    )}
                    <span className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded-lg bg-black/60 px-2 py-1 text-[11px] text-white opacity-80 group-hover:opacity-100">
                      <Expand className="h-3.5 w-3.5" />
                      全屏
                    </span>
                  </button>
                ) : (
                  <div className="flex h-48 items-center justify-center text-sm text-muted">
                    加载预览…
                  </div>
                )}
              </div>
              <p className="text-sm leading-relaxed">{selected.prompt}</p>
              {selected.negativePrompt && (
                <p className="mt-2 text-xs text-muted">负向：{selected.negativePrompt}</p>
              )}
              <p className="mt-3 font-mono text-xs text-muted">
                {selected.width}×{selected.height} · steps {selected.steps}
                {selected.seed != null ? ` · seed ${selected.seed}` : ''}
                {' · '}
                {selected.mode === 'image_edit'
                  ? '图生图'
                  : selected.mode === 'image_to_video'
                    ? '图生视频'
                    : '文生图'}
                {selected.refPaths?.length ? ` · 参考图 ${selected.refPaths.length}` : ''}
                <br />
                task {selected.taskId}
                {selected.showcaseId ? (
                  <>
                    <br />
                    已分享展馆 · {selected.showcaseId.slice(0, 8)}…
                  </>
                ) : null}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 border-t border-border p-4">
              {selected.showcaseId ? (
                <button
                  className="btn-danger col-span-2"
                  disabled={shareBusy || !activeProfileId}
                  onClick={async () => {
                    if (!activeProfileId || !selected.showcaseId) return
                    setShareBusy(true)
                    try {
                      const res = (await window.studio.unlistShowcase({
                        profileId: activeProfileId,
                        showcaseId: selected.showcaseId,
                        galleryId: selected.id
                      })) as { galleryItem?: GalleryItem | null }
                      if (res.galleryItem) setSelected(res.galleryItem)
                      else setSelected({ ...selected, showcaseId: null })
                      void qc.invalidateQueries({ queryKey: ['gallery'] })
                      void qc.invalidateQueries({ queryKey: ['showcase'] })
                      showToast('success', '已从作品展馆下架')
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
                  {shareBusy ? '下架中…' : '从展馆下架'}
                </button>
              ) : (
                <button
                  className="btn-primary col-span-2"
                  disabled={shareBusy || !activeProfileId}
                  onClick={async () => {
                    if (!activeProfileId) {
                      showToast('error', '请先配置 API 连接')
                      return
                    }
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
                  {shareBusy ? '分享中…' : '分享至作品展馆'}
                </button>
              )}
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
                  await window.studio.toggleFavorite(selected.id, !selected.favorite)
                  setSelected({ ...selected, favorite: !selected.favorite })
                  void qc.invalidateQueries({ queryKey: ['gallery'] })
                }}
              >
                <Heart className={`h-4 w-4 ${selected.favorite ? 'fill-primary text-primary' : ''}`} />
                {selected.favorite ? '取消收藏' : '收藏'}
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
                    negativePrompt: selected.negativePrompt,
                    width: selected.width,
                    height: selected.height,
                    steps: selected.steps,
                    seed: selected.seed,
                    mode: selected.mode
                  })
                  showToast('info', '已回填到创作页')
                }}
              >
                复用参数
              </button>
              <button
                className="btn-secondary"
                onClick={async () => {
                  await window.studio.openInFolder(selected.id)
                }}
              >
                <FolderOpen className="h-4 w-4" />
                打开文件夹
              </button>
              <button
                className="btn-secondary"
                onClick={async () => {
                  const res = await window.studio.exportImage(selected.id)
                  if (res.ok) showToast('success', '已导出')
                }}
              >
                导出…
              </button>
              <button className="btn-danger col-span-2" onClick={() => setDeleteId(selected.id)}>
                <Trash2 className="h-4 w-4" />
                删除
              </button>
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
            className="absolute right-4 top-4 z-10 rounded-xl border border-white/20 bg-black/50 p-2 text-white hover:bg-black/70"
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

function GalleryThumb({ id }: { id: string }) {
  const { data } = useQuery({
    queryKey: ['gallery-thumb', id],
    queryFn: () => window.studio.readGalleryDataUrl(id) as Promise<string | null>
  })
  return (
    <div className="aspect-square bg-bg">
      {data ? (
        data.startsWith('data:video/') ? (
          <video
            src={data}
            muted
            playsInline
            className="h-full w-full object-cover transition group-hover:scale-[1.02]"
          />
        ) : (
          <img
            src={data}
            alt=""
            className="h-full w-full object-cover transition group-hover:scale-[1.02]"
          />
        )
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-muted">…</div>
      )}
    </div>
  )
}
