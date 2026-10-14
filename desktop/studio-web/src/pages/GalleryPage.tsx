import { useEffect, useState } from 'react'
import { deleteGallery, listGallery, toggleFavorite, type GalleryRecord } from '@/lib/gallery-db'
import { shareToShowcase } from '@/lib/api'
import { useSession } from '@/store/session'
import { useToast } from '@/store/toast'

export function GalleryPage() {
  const apiKey = useSession((s) => s.user!.apiKey)
  const push = useToast((s) => s.push)
  const [items, setItems] = useState<Array<GalleryRecord & { url: string }>>([])
  const [active, setActive] = useState<(GalleryRecord & { url: string }) | null>(null)

  async function reload() {
    const rows = await listGallery()
    setItems(rows.map((r) => ({ ...r, url: URL.createObjectURL(r.blob) })))
  }

  useEffect(() => {
    reload()
    return () => {
      items.forEach((i) => URL.revokeObjectURL(i.url))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-lg font-medium text-text">作品画廊</h1>
      <p className="text-sm text-muted">保存在本机浏览器 IndexedDB，换设备不会同步。</p>
      {!items.length ? (
        <p className="text-sm text-muted">暂无作品</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="card overflow-hidden text-left"
              onClick={() => setActive(item)}
            >
              {item.mimeType.startsWith('video/') ? (
                <video src={item.url} className="aspect-square w-full object-cover" muted />
              ) : (
                <img src={item.url} alt="" className="aspect-square w-full object-cover" />
              )}
              <div className="p-2">
                <p className="truncate text-xs text-text">{item.prompt}</p>
                <p className="text-[10px] text-muted">{item.favorite ? '★ ' : ''}{item.mode}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {active ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setActive(null)}>
          <div className="card max-h-[90vh] w-full max-w-3xl overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
            {active.mimeType.startsWith('video/') ? (
              <video src={active.url} controls className="max-h-[60vh] w-full object-contain" />
            ) : (
              <img src={active.url} alt="" className="max-h-[60vh] w-full object-contain" />
            )}
            <p className="mt-3 text-sm text-text">{active.prompt}</p>
            <p className="mt-1 text-xs text-muted">
              {active.width}×{active.height} · steps {active.steps}
              {active.seed != null ? ` · seed ${active.seed}` : ''}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
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
      ) : null}
    </div>
  )
}
