import { useCallback, useEffect, useState } from 'react'
import { Landmark, Loader2, RefreshCw, X } from 'lucide-react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useAppStore } from '../stores/appStore'

interface ShowcaseItem {
  id: string
  author_name: string
  author_username: string
  status: string
  prompt: string
  negative_prompt?: string | null
  mode: string
  width: number
  height: number
  steps: number
  seed?: number | null
  ref_count: number
  created_at: string
  image_url: string
  thumb_url?: string
  ref_urls: string[]
}

export function ShowcasePage() {
  const showToast = useAppStore((s) => s.showToast)
  const [items, setItems] = useState<ShowcaseItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ShowcaseItem | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [unlistId, setUnlistId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.gateway.listShowcase(80)
      if (!res.ok) {
        setError(res.message)
        setItems([])
      } else {
        setItems(res.items ?? [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function openDetail(item: ShowcaseItem) {
    setSelected(item)
    setPreviewUrl(null)
    const res = await window.gateway.fetchShowcaseAsset(item.image_url)
    if (res.ok && res.dataUrl) setPreviewUrl(res.dataUrl)
    else showToast('error', res.message || '原图加载失败')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Landmark className="h-5 w-5 text-primary" />
            作品展馆
          </h1>
          <p className="page-desc">
            查看当前公开作品；发现违规内容可强制下架（管理员操作，不限作者）。
          </p>
        </div>
        <button className="btn-secondary shrink-0" disabled={loading} onClick={() => void refresh()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          刷新
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="card flex h-56 items-center justify-center text-sm text-muted">加载中…</div>
      ) : items.length === 0 ? (
        <div className="card flex h-56 items-center justify-center text-sm text-muted">
          展馆暂无公开作品
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="card group overflow-hidden text-left transition hover:border-primary/40"
              onClick={() => void openDetail(item)}
            >
              <Thumb path={item.thumb_url || item.image_url} />
              <div className="space-y-1 p-3">
                <p className="line-clamp-2 text-xs text-text">{item.prompt}</p>
                <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
                  <span className="truncate">{item.author_name || item.author_username}</span>
                  <span>{item.mode === 'image_edit' ? '图生图' : '文生图'}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="overlay-scrim fixed inset-0 z-40 flex justify-end">
          <div className="flex h-full w-full max-w-lg flex-col border-l border-border bg-panel shadow-panel">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h3 className="font-semibold">展馆审核</h3>
              <button
                className="btn-ghost !p-1"
                onClick={() => {
                  setSelected(null)
                  setPreviewUrl(null)
                }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <div className="mb-4 overflow-hidden rounded-xl border border-border bg-bg">
                {previewUrl ? (
                  <img src={previewUrl} alt="" className="max-h-[360px] w-full object-contain" />
                ) : (
                  <div className="flex h-48 items-center justify-center text-sm text-muted">
                    加载原图…
                  </div>
                )}
              </div>
              <p className="text-xs text-muted">
                作者：{selected.author_name || selected.author_username}
                {' · '}
                @{selected.author_username}
                {' · '}
                {selected.mode === 'image_edit' ? '图生图' : '文生图'}
              </p>
              <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap">{selected.prompt}</p>
              {selected.negative_prompt && (
                <p className="mt-2 text-xs text-muted">负向：{selected.negative_prompt}</p>
              )}
              <p className="mt-3 font-mono text-xs text-muted">
                {selected.width}×{selected.height} · steps {selected.steps}
                {selected.seed != null ? ` · seed ${selected.seed}` : ''}
                {selected.ref_count > 0 ? ` · 参考图 ${selected.ref_count}` : ''}
                <br />
                id {selected.id}
              </p>
            </div>
            <div className="border-t border-border p-4">
              <button
                className="btn-danger w-full"
                disabled={busy}
                onClick={() => setUnlistId(selected.id)}
              >
                强制下架（违规处理）
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(unlistId)}
        title="强制下架该作品？"
        message="下架后所有用户在展馆中将看不到此作品。作者本地画廊不受影响。"
        confirmText="确认下架"
        danger
        onCancel={() => setUnlistId(null)}
        onConfirm={async () => {
          if (!unlistId) return
          setBusy(true)
          try {
            const res = await window.gateway.adminUnlistShowcase(unlistId)
            if (!res.ok) {
              showToast('error', res.message)
              return
            }
            showToast('success', '已强制下架')
            setSelected(null)
            setPreviewUrl(null)
            setUnlistId(null)
            void refresh()
          } finally {
            setBusy(false)
          }
        }}
      />
    </div>
  )
}

function Thumb({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void window.gateway.fetchShowcaseAsset(path).then((res) => {
      if (!cancelled && res.ok && res.dataUrl) setUrl(res.dataUrl)
    })
    return () => {
      cancelled = true
    }
  }, [path])
  return (
    <div className="aspect-square bg-bg">
      {url ? (
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover transition group-hover:scale-[1.02]"
        />
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-muted">…</div>
      )}
    </div>
  )
}
