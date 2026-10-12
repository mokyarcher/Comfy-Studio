import { useEffect, useState } from 'react'
import { Eye, EyeOff, KeyRound, RefreshCw } from 'lucide-react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useAppStore } from '../stores/appStore'

export function ApiKeyPage() {
  const runAction = useAppStore((s) => s.runAction)
  const showToast = useAppStore((s) => s.showToast)
  const [masked, setMasked] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [draft, setDraft] = useState('')
  const [revealed, setRevealed] = useState('')
  const [show, setShow] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const reload = async () => {
    const info = await window.gateway.getApiKeyInfo()
    setMasked(info.masked)
    setHasKey(info.hasKey)
  }

  useEffect(() => {
    void reload()
  }, [])

  const apply = async (restart: boolean) => {
    setConfirmOpen(false)
    const result = await runAction(() => window.gateway.updateApiKey(draft, restart))
    if (result.ok) {
      setDraft('')
      setRevealed('')
      setShow(false)
      await reload()
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="page-title">访问密钥</h1>
        <p className="page-desc">
          这是<strong>管理员 Key</strong>（写入项目 .env 的 API_KEY），用于 Gateway 管理与审核用户。普通用户请在
          Studio 注册/登录，不要共用此 Key。
        </p>
      </div>

      <section className="card space-y-4 p-5">
        <div className="flex items-center gap-2 text-sm text-muted">
          <KeyRound className="h-4 w-4 text-primary" />
          当前密钥（掩码）
        </div>
        <div className="flex gap-2">
          <input
            className="input font-mono"
            readOnly
            value={show && revealed ? revealed : masked || '（未检测到 API_KEY）'}
          />
          <button
            className="btn-secondary shrink-0"
            onClick={async () => {
              if (show) {
                setShow(false)
                return
              }
              const { key } = await window.gateway.revealApiKey()
              setRevealed(key)
              setShow(true)
            }}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
          <button
            className="btn-ghost shrink-0"
            disabled={!hasKey && !revealed}
            onClick={async () => {
              const key = revealed || (await window.gateway.revealApiKey()).key
              if (!key) {
                showToast('error', '无密钥可复制')
                return
              }
              await navigator.clipboard.writeText(key)
              showToast('success', '已复制密钥')
            }}
          >
            复制
          </button>
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-medium">更新密钥</h2>
        <input
          className="input font-mono"
          placeholder="输入新密钥或点击生成"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-secondary"
            onClick={async () => {
              const { key } = await window.gateway.generateApiKey()
              setDraft(key)
              showToast('info', '已生成随机密钥，请确认后写入')
            }}
          >
            <RefreshCw className="h-4 w-4" />
            生成随机密钥
          </button>
          <button
            className="btn-primary"
            disabled={draft.trim().length < 8}
            onClick={() => setConfirmOpen(true)}
          >
            写入 .env 并重启 API
          </button>
          <button
            className="btn-ghost"
            disabled={draft.trim().length < 8}
            onClick={() => void apply(false)}
          >
            仅写入不重启
          </button>
        </div>
        <p className="text-xs text-muted">
          更新后，已配置旧密钥的客户端将收到 401。请同步更新 Comfy Studio 连接配置。
        </p>
      </section>

      <ConfirmDialog
        open={confirmOpen}
        title="确认更新 API Key？"
        message="将覆盖项目 .env 中的 API_KEY，并尝试停止后重新启动由本应用管理的 API 进程。是否继续？"
        confirmText="更新并重启"
        danger
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void apply(true)}
      />
    </div>
  )
}
