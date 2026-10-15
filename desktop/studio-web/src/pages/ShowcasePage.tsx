import { useEffect, useState } from 'react'
import { fetchAuthedBlob, listShowcase, unlistShowcase } from '@/lib/api'
import type { ShowcaseItem } from '@/lib/types'
import { useSession } from '@/store/session'
import { useToast } from '@/store/toast'

type Row = ShowcaseItem & { thumb?: string }

export function ShowcasePage() {
  const apiKey = useSession((s) => s.user!.apiKey)
  const push = useToast((s) => s.push)
  const [items, setItems] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState<Row | null>(null)
  const [activeUrl, setActiveUrl] = useState<string | null>(null)
  const [loadingFull, setLoadingFull] = useState(false)

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
    } catch (err) {
      push(err instanceof Error ? err.message : '加载失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey])

  useEffect(() => {
    return () => {
      if (activeUrl && activeUrl !== active?.thumb) URL.revokeObjectURL(activeUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUrl])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePreview()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close when active opens
  }, [active])

  async function openItem(item: Row) {
    setActive(item)
    setActiveUrl(item.thumb || null)
    setLoadingFull(true)
    try {
      const blob = await fetchAuthedBlob({ apiKey, path: item.image_url })
      const url = URL.createObjectURL(blob)
      setActiveUrl((prev) => {
        if (prev && prev !== item.thumb) URL.revokeObjectURL(prev)
        return url
      })
    } catch (err) {
      push(err instanceof Error ? err.message : '加载原图失败', 'error')
    } finally {
      setLoadingFull(false)
    }
  }

  function closePreview() {
    setActive(null)
    setActiveUrl((prev) => {
      const thumb = active?.thumb
      if (prev && prev !== thumb) URL.revokeObjectURL(prev)
      return null
    })
  }

  return (
    <div className="page space-y-4">
      <div className="page-header mb-0">
        <div>
          <h1 className="page-title">作品展馆</h1>
          <p className="page-sub">来自本机服务端的共享作品。</p>
        </div>
        <button type="button" className="btn-secondary text-xs" onClick={reload}>
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
            className="card overflow-hidden text-left transition hover:border-white/30"
            onClick={() => void openItem(item)}
          >
            <div className="media-thumb">
              {item.thumb ? (
                <img src={item.thumb} alt="" />
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
                  {item.author_name} · {item.mode}
                </span>
                {item.mine ? (
                  <span
                    role="button"
                    tabIndex={0}
                    className="shrink-0 text-xs text-danger"
                    onClick={async (e) => {
                      e.stopPropagation()
                      try {
                        await unlistShowcase({ apiKey, itemId: item.id })
                        push('已下架', 'success')
                        reload()
                      } catch (err) {
                        push(err instanceof Error ? err.message : '下架失败', 'error')
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') e.currentTarget.click()
                    }}
                  >
                    下架
                  </span>
                ) : null}
              </div>
            </div>
          </button>
        ))}
      </div>

      {active ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-[2px] sm:p-4"
          onClick={closePreview}
        >
          <div
            className="card grid h-[85vh] w-[85vw] max-h-[85vh] max-w-[85vw] overflow-hidden lg:grid-cols-[minmax(0,1.35fr)_minmax(15rem,0.65fr)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex min-h-0 cursor-pointer items-center justify-center bg-bg/40 p-3"
              title="点击关闭"
              onClick={closePreview}
            >
              {activeUrl ? (
                <img src={activeUrl} alt="" className="max-h-full max-w-full object-contain" />
              ) : (
                <p className="text-sm text-muted">{loadingFull ? '加载原图…' : '无预览'}</p>
              )}
            </div>
            <div className="flex min-h-0 flex-col gap-3 overflow-auto border-t border-border p-4 lg:border-l lg:border-t-0">
              <p className="text-sm leading-relaxed text-text">{active.prompt}</p>
              <p className="text-xs text-muted">
                {active.author_name} · {active.mode}
                {active.width && active.height ? ` · ${active.width}×${active.height}` : ''}
                {active.steps != null ? ` · steps ${active.steps}` : ''}
                {active.seed != null ? ` · seed ${active.seed}` : ''}
              </p>
              {loadingFull ? <p className="text-[11px] text-muted">正在加载原图…</p> : null}
              <p className="text-[11px] text-muted">点击左侧图片或按 Esc 关闭</p>
              {active.mine ? (
                <div className="mt-auto flex flex-wrap gap-2 pt-2">
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={async () => {
                      try {
                        await unlistShowcase({ apiKey, itemId: active.id })
                        push('已下架', 'success')
                        closePreview()
                        reload()
                      } catch (err) {
                        push(err instanceof Error ? err.message : '下架失败', 'error')
                      }
                    }}
                  >
                    下架
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
