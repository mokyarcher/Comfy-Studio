import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Copy, Download, Expand, Landmark, Loader2, RefreshCw, X } from 'lucide-react'
import type { ShowcaseItem } from '../../../shared/types'
import { toUserErrorMessage } from '../../../shared/errors'
import { formatDateTime } from '../lib/format'
import { useAppStore } from '../stores/appStore'

export function ShowcasePage() {
  const activeProfileId = useAppStore((s) => s.activeProfileId)
  const applyReuse = useAppStore((s) => s.applyReuse)
  const showToast = useAppStore((s) => s.showToast)
  const [selected, setSelected] = useState<ShowcaseItem | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [busy, setBusy] = useState(false)

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['showcase', activeProfileId],
    enabled: Boolean(activeProfileId),
    queryFn: async () => {
      const res = (await window.studio.listShowcase({
        profileId: activeProfileId,
        limit: 80
      })) as { items: ShowcaseItem[]; count: number }
      return res.items
    }
  })

  const items = data ?? []

  async function openDetail(item: ShowcaseItem) {
    setSelected(item)
    setPreviewUrl(null)
    setFullscreen(false)
    if (!activeProfileId) return
    try {
      const url = (await window.studio.fetchShowcaseAsset({
        profileId: activeProfileId,
        path: item.image_url // full image — cached locally after first open
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
        <button
          className="btn-secondary shrink-0"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          刷新
        </button>
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
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
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
              <button className="btn-ghost !p-1" onClick={closeDetail}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <div className="relative mb-4 overflow-hidden rounded-lg border border-border bg-bg">
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
              <p className="text-xs text-muted">
                {selected.author_name || selected.author_username}
                {' · '}
                {formatDateTime(selected.created_at)}
                {' · '}
                {selected.mode === 'image_edit'
                  ? '图生图'
                  : selected.mode === 'image_to_video'
                    ? '图生视频'
                    : '文生图'}
                {selected.mine ? ' · 我的分享' : ''}
              </p>
              <p className="mt-3 text-sm leading-relaxed">{selected.prompt}</p>
              {selected.negative_prompt && (
                <p className="mt-2 text-xs text-muted">负向：{selected.negative_prompt}</p>
              )}
              <p className="mt-3 font-mono text-xs text-muted">
                {selected.width}×{selected.height} · steps {selected.steps}
                {selected.seed != null ? ` · seed ${selected.seed}` : ''}
                {selected.ref_count > 0 ? ` · 参考图 ${selected.ref_count}` : ''}
              </p>
              {selected.ref_count > 0 && selected.ref_urls?.length > 0 && (
                <div className="mt-4 space-y-2">
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
            </div>
            <div className="grid grid-cols-2 gap-2 border-t border-border p-4">
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
                disabled={busy || !previewUrl}
                onClick={async () => {
                  setBusy(true)
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
                    setBusy(false)
                  }
                }}
              >
                <Download className="h-4 w-4" />
                下载效果图
              </button>
              {selected.mine && (
                <button
                  className="btn-danger col-span-2"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    try {
                      await window.studio.unlistShowcase({
                        profileId: activeProfileId,
                        showcaseId: selected.id
                      })
                      showToast('success', '已从展馆下架')
                      closeDetail()
                      void refetch()
                    } catch (err) {
                      showToast('error', err instanceof Error ? err.message : '下架失败')
                    } finally {
                      setBusy(false)
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
    <div className="aspect-square bg-bg">
      {data ? (
        <img
          src={data}
          alt=""
          className="h-full w-full object-cover transition group-hover:scale-[1.02]"
        />
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-muted">…</div>
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
