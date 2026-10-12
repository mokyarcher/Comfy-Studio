import { useEffect, useMemo, useState } from 'react'
import { Copy, ExternalLink } from 'lucide-react'
import { useAppStore } from '../stores/appStore'

export function PublicPage() {
  const status = useAppStore((s) => s.status)
  const saveConfig = useAppStore((s) => s.saveConfig)
  const runAction = useAppStore((s) => s.runAction)
  const showToast = useAppStore((s) => s.showToast)
  const [url, setUrl] = useState('')

  useEffect(() => {
    if (status?.config.publicBaseUrl) setUrl(status.config.publicBaseUrl)
  }, [status?.config.publicBaseUrl])

  const base = (url || status?.config.publicBaseUrl || '').replace(/\/+$/, '')
  const curl = useMemo(() => {
    return `curl -X POST "${base}/v1/images/generate" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: <YOUR_API_KEY>" \\
  -d "{\\"prompt\\":\\"a red fox in snow\\",\\"width\\":1024,\\"height\\":1024,\\"steps\\":25}"`
  }, [base])

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast('success', `已复制${label}`)
    } catch {
      showToast('error', '复制失败')
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="page-title">公网入口</h1>
        <p className="page-desc">配置并测试经 FRP / Nginx 暴露的公网 API Base URL</p>
      </div>

      <section className="card space-y-4 p-5">
        <div>
          <label className="label">公网 Base URL（勿带末尾斜杠）</label>
          <input
            className="input"
            value={url}
            placeholder="http://111.229.166.216:8080/qwen-image"
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => void saveConfig({ publicBaseUrl: url })}>
            保存
          </button>
          <button
            className="btn-accent"
            onClick={() =>
              void runAction(() =>
                window.gateway.testPublicApi().then((r) => ({ ok: r.ok, message: r.message }))
              )
            }
          >
            测试连通性
          </button>
          <button className="btn-ghost" onClick={() => void copy(base, '地址')}>
            <Copy className="h-4 w-4" />
            复制地址
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              if (!base) return
              window.open(`${base}/health/ready`, '_blank')
            }}
          >
            <ExternalLink className="h-4 w-4" />
            打开健康检查
          </button>
        </div>
        {status?.publicApi && (
          <p className="text-sm text-muted">
            最近结果：{status.publicApi.ok ? '可用' : '失败'} · {status.publicApi.message}
            {status.publicApi.checkedAt
              ? ` · ${new Date(status.publicApi.checkedAt).toLocaleString()}`
              : ''}
          </p>
        )}
      </section>

      <section className="card space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">调用示例（密钥已脱敏）</h2>
          <button className="btn-secondary" onClick={() => void copy(curl, ' curl')}>
            <Copy className="h-4 w-4" />
            复制 curl
          </button>
        </div>
        <pre className="overflow-auto rounded-xl border border-border bg-bg-deep p-3 font-mono text-xs leading-relaxed text-accent/90">
          {curl}
        </pre>
        <p className="text-xs text-muted">
          健康检查：GET {base}/health/ready（无需 Key）。生图接口需要 Header X-API-Key。
        </p>
      </section>
    </div>
  )
}
