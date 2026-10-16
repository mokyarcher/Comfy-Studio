import { useEffect, useState } from 'react'
import { FolderOpen, RefreshCw } from 'lucide-react'
import { useAppStore } from '../stores/appStore'

export function WorkflowPage() {
  const status = useAppStore((s) => s.status)
  const saveConfig = useAppStore((s) => s.saveConfig)
  const runAction = useAppStore((s) => s.runAction)
  const showToast = useAppStore((s) => s.showToast)
  const [info, setInfo] = useState<{
    path: string
    exists: boolean
    mtime?: string
    size?: number
  } | null>(null)
  const [comfyUrl, setComfyUrl] = useState('')

  const reload = async () => {
    const w = await window.gateway.workflowInfo()
    setInfo(w)
  }

  useEffect(() => {
    void reload()
    if (status?.config.comfyUrl) setComfyUrl(status.config.comfyUrl)
  }, [status?.config.comfyUrl, status?.resolvedWorkflowPath])

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="page-title">工作流与 ComfyUI</h1>
        <p className="page-desc">启停 ComfyUI、探测连通性，并查看 API 工作流文件</p>
      </div>

      <section className="card space-y-4 p-5">
        <h2 className="font-medium">ComfyUI</h2>
        <input className="input" value={comfyUrl} onChange={(e) => setComfyUrl(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-secondary"
            onClick={() => void saveConfig({ comfyUrl })}
          >
            保存地址
          </button>
          <button
            className="btn-primary"
            onClick={() => void runAction(() => window.gateway.startComfy())}
          >
            启动
          </button>
          <button
            className="btn-secondary"
            onClick={() => void runAction(() => window.gateway.stopComfy())}
          >
            停止
          </button>
          <button
            className="btn-danger"
            onClick={() => void runAction(() => window.gateway.forceStopComfy())}
          >
            强制停止
          </button>
          <button
            className="btn-accent"
            onClick={() =>
              void runAction(() =>
                window.gateway.testComfy().then((r) => ({ ok: r.ok, message: r.message }))
              )
            }
          >
            <RefreshCw className="h-4 w-4" />
            检测
          </button>
        </div>
        {status?.comfy && (
          <p className="text-sm text-muted">
            最近检测：{status.comfy.ok ? '在线' : '不可达'} · {status.comfy.message}
            {status.comfy.latencyMs != null ? ` · ${status.comfy.latencyMs} ms` : ''}
          </p>
        )}
        <p className="text-xs text-muted">
          目录与启动命令在「设置」里配置。对接 API 只需 8188 服务起来，不必再开浏览器工作流界面。
        </p>
      </section>

      <section className="card space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">工作流文件</h2>
          <button className="btn-ghost" onClick={() => void reload()}>
            重新检查
          </button>
        </div>
        <div className="rounded-xl border border-border bg-bg-deep p-3 font-mono text-xs text-muted">
          <div>路径：{info?.path || status?.resolvedWorkflowPath || '未找到'}</div>
          <div className="mt-1">
            存在：{info?.exists ? '是' : '否'}
            {info?.mtime ? ` · 修改时间 ${new Date(info.mtime).toLocaleString()}` : ''}
            {info?.size != null ? ` · ${info.size} bytes` : ''}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-secondary"
            onClick={async () => {
              const p = await window.gateway.pickFile([
                { name: 'JSON', extensions: ['json'] },
                { name: 'All', extensions: ['*'] }
              ])
              if (p) {
                await saveConfig({ workflowPath: p })
                await reload()
              }
            }}
          >
            选择工作流 JSON
          </button>
          <button
            className="btn-primary"
            disabled={!info?.path}
            onClick={async () => {
              if (!info?.path) return
              const folder = info.path.replace(/[\\/][^\\/]+$/, '')
              const res = await window.gateway.openPath(folder)
              showToast(res.ok ? 'success' : 'error', res.message)
            }}
          >
            <FolderOpen className="h-4 w-4" />
            打开所在目录
          </button>
        </div>
        <p className="text-xs text-muted">
          Gateway 不会改写工作流 JSON；仅展示路径与文件状态。
        </p>
      </section>
    </div>
  )
}
