import { useEffect, useState } from 'react'
import {
  deleteGallery,
  findByCloudId,
  listGallery,
  newGalleryId,
  putGallery,
  toggleFavorite,
  type GalleryRecord
} from '@/lib/gallery-db'
import { fetchAuthedBlob, listCloudGallery, shareToShowcase } from '@/lib/api'
import type { GenerateMode } from '@/lib/types'
import { useSession } from '@/store/session'
import { useToast } from '@/store/toast'

export function GalleryPage() {
  const apiKey = useSession((s) => s.user!.apiKey)
  const push = useToast((s) => s.push)
  const [items, setItems] = useState<Array<GalleryRecord & { url: string }>>([])
  const [active, setActive] = useState<(GalleryRecord & { url: string }) | null>(null)

  async function reload() {
    const rows = await listGallery()
    setItems((prev) => {
      prev.forEach((i) => URL.revokeObjectURL(i.url))
      return rows.map((r) => ({ ...r, url: URL.createObjectURL(r.blob) }))
    })
  }

  async function syncCloud() {
    try {
      const { items: cloud } = await listCloudGallery({ apiKey, limit: 100 })
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
      }
      await reload()
    } catch {
      /* offline / API down — local gallery still works */
    }
  }

  useEffect(() => {
    void reload().then(() => syncCloud())
    return () => {
      setItems((prev) => {
        prev.forEach((i) => URL.revokeObjectURL(i.url))
        return []
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActive(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  async function onShare(item: GalleryRecord & { url: string }) {
    try {
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
      push('已分享到展馆', 'success')
      item.showcaseId = shared.id
    } catch (err) {
      push(err instanceof Error ? err.message : '分享失败', 'error')
    }
  }

  function download(item: GalleryRecord & { url: string }) {
    const a = document.createElement('a')
    a.href = item.url
    a.download = `${item.id}.${item.mimeType.includes('video') ? 'mp4' : 'png'}`
    a.click()
  }

  return (
    <div className="page space-y-4">
      <div className="page-header mb-0">
        <h1 className="page-title">作品画廊</h1>
        <span className="status-chip">{items.length} 件</span>
      </div>

      {!items.length ? (
        <div className="empty-state min-h-[16rem]">
          <p className="text-sm text-muted">暂无作品</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="card group overflow-hidden text-left transition hover:border-white/30"
              onClick={() => setActive(item)}
            >
              <div className="media-thumb">
                {item.mimeType.startsWith('video/') ? (
                  <video src={item.url} muted />
                ) : (
                  <img src={item.url} alt="" className="transition duration-200 group-hover:scale-[1.02]" />
                )}
              </div>
              <div className="space-y-1.5 p-2.5">
                <p className="line-clamp-2 text-xs leading-relaxed text-text">{item.prompt}</p>
                <p className="text-[10px] text-muted">
                  {item.favorite ? '★ ' : ''}
                  {item.mode}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {active ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-[2px] sm:p-4"
          onClick={() => setActive(null)}
        >
          <div
            className="card grid h-[85vh] w-[85vw] max-h-[85vh] max-w-[85vw] overflow-hidden lg:grid-cols-[minmax(0,1.35fr)_minmax(15rem,0.65fr)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex min-h-0 cursor-pointer items-center justify-center bg-bg/40 p-3"
              title="点击关闭"
              onClick={() => setActive(null)}
            >
              {active.mimeType.startsWith('video/') ? (
                <video
                  src={active.url}
                  controls
                  className="max-h-full max-w-full object-contain"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <img src={active.url} alt="" className="max-h-full max-w-full object-contain" />
              )}
            </div>
            <div className="flex min-h-0 flex-col gap-3 overflow-auto border-t border-border p-4 lg:border-l lg:border-t-0">
              <p className="text-sm leading-relaxed text-text">{active.prompt}</p>
              <p className="text-xs text-muted">
                {active.width}×{active.height} · steps {active.steps}
                {active.seed != null ? ` · seed ${active.seed}` : ''}
              </p>
              <div className="mt-auto flex flex-wrap gap-2 pt-2">
                <button type="button" className="btn-secondary" onClick={() => download(active)}>
                  下载
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={async () => {
                    await toggleFavorite(active.id)
                    await reload()
                    push('已更新收藏', 'success')
                  }}
                >
                  收藏
                </button>
                <button type="button" className="btn-secondary" onClick={() => onShare(active)}>
                  分享到展馆
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={async () => {
                    await deleteGallery(active.id)
                    setActive(null)
                    await reload()
                  }}
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
