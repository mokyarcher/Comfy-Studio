import { useState } from 'react'
import { Cable, Check, KeyRound, Loader2, LogOut } from 'lucide-react'
import { useAppStore } from '../stores/appStore'

export function ConnectionPage() {
  const profiles = useAppStore((s) => s.profiles)
  const activeProfileId = useAppStore((s) => s.activeProfileId)
  const checkConnection = useAppStore((s) => s.checkConnection)
  const logout = useAppStore((s) => s.logout)
  const showToast = useAppStore((s) => s.showToast)
  const [testing, setTesting] = useState(false)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPassword2, setNewPassword2] = useState('')
  const [changing, setChanging] = useState(false)

  const active =
    profiles.find((p) => p.id === activeProfileId) ?? profiles.find((p) => p.isDefault) ?? profiles[0]

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mb-5">
        <h1 className="page-title flex items-center gap-2">
          <Cable className="h-5 w-5 text-primary" />
          账号管理
        </h1>
      </div>

      {!active ? (
        <div className="card flex h-40 items-center justify-center text-sm text-muted">未登录</div>
      ) : (
        <div className="space-y-4">
          <div className="card space-y-3 p-5">
            <div>
              <div className="text-xs text-muted">当前用户</div>
              <div className="mt-1 text-lg font-semibold">{active.username || active.name}</div>
            </div>
            <div>
              <div className="text-xs text-muted">服务器</div>
              <div className="mt-1 font-mono text-sm text-accent">{active.baseUrl}</div>
            </div>
            <div>
              <div className="text-xs text-muted">API Key</div>
              <div className="mt-1 font-mono text-xs text-muted">{active.apiKeyMasked || '—'}</div>
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                className="btn-secondary"
                disabled={testing}
                onClick={async () => {
                  setTesting(true)
                  try {
                    await checkConnection()
                    showToast('success', '已重新检测连接')
                  } finally {
                    setTesting(false)
                  }
                }}
              >
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                测试连接
              </button>
              <button
                className="btn-danger"
                onClick={async () => {
                  await logout()
                  showToast('info', '已退出登录')
                }}
              >
                <LogOut className="h-4 w-4" />
                退出登录
              </button>
            </div>
          </div>

          <section className="card space-y-3 p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="h-4 w-4 text-primary" />
              修改密码
            </h2>
            <div>
              <label className="label">原密码</label>
              <input
                type="password"
                className="input"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div>
              <label className="label">新密码</label>
              <input
                type="password"
                className="input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="label">确认新密码</label>
              <input
                type="password"
                className="input"
                value={newPassword2}
                onChange={(e) => setNewPassword2(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <button
              className="btn-primary"
              disabled={changing}
              onClick={async () => {
                if (newPassword.length < 6) {
                  showToast('error', '新密码至少 6 位')
                  return
                }
                if (newPassword !== newPassword2) {
                  showToast('error', '两次输入的新密码不一致')
                  return
                }
                setChanging(true)
                try {
                  const res = await window.studio.changePassword({
                    oldPassword,
                    newPassword
                  })
                  if (!res.ok) {
                    showToast('error', res.message)
                    return
                  }
                  setOldPassword('')
                  setNewPassword('')
                  setNewPassword2('')
                  showToast('success', res.message)
                } finally {
                  setChanging(false)
                }
              }}
            >
              {changing ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              保存新密码
            </button>
          </section>
        </div>
      )}
    </div>
  )
}
