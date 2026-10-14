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

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium text-text">作品展馆</h1>
        <button type="button" className="btn-secondary text-xs" onClick={reload}>
          刷新
        </button>
      </div>
      {loading ? <p className="text-sm text-muted">加载中…</p> : null}
      {!loading && !items.length ? <p className="text-sm text-muted">暂无展馆作品</p> : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {items.map((item) => (
          <div key={item.id} className="card overflow-hidden">
            {item.thumb ? (
              <img src={item.thumb} alt="" className="aspect-square w-full object-cover" />
            ) : (
              <div className="flex aspect-square items-center justify-center bg-bg text-xs text-muted">无预览</div>
            )}
            <div className="space-y-1 p-2">
              <p className="line-clamp-2 text-xs text-text">{item.prompt}</p>
              <p className="text-[10px] text-muted">
                {item.author_name} · {item.mode}
              </p>
              {item.mine ? (
                <button
                  type="button"
                  className="btn-ghost px-0 text-xs text-danger"
                  onClick={async () => {
                    try {
                      await unlistShowcase({ apiKey, itemId: item.id })
                      push('已下架', 'success')
                      reload()
                    } catch (err) {
                      push(err instanceof Error ? err.message : '下架失败', 'error')
                    }
                  }}
                >
                  下架
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
