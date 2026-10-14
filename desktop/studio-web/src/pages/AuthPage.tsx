import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { authLogin, authRegister, testConnection } from '@/lib/api'
import { useSession } from '@/store/session'
import { ToastHost } from '@/components/ToastHost'
import { useToast } from '@/store/toast'

export function AuthPage() {
  const navigate = useNavigate()
  const user = useSession((s) => s.user)
  const hydrated = useSession((s) => s.hydrated)
  const login = useSession((s) => s.login)
  const remember = useSession((s) => s.remember)
  const setRemember = useSession((s) => s.setRemember)
  const push = useToast((s) => s.push)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [healthMsg, setHealthMsg] = useState('')

  if (hydrated && user) {
    return <Navigate to="/create" replace />
  }

  async function onTest() {
    const r = await testConnection()
    setHealthMsg(r.ok ? r.message : r.message)
    push(r.ok ? `连接正常 · ${r.latencyMs} ms` : r.message, r.ok ? 'success' : 'error')
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      if (mode === 'register') {
        const r = await authRegister({ username, password, displayName })
        push(r.message, r.ok ? 'success' : 'error')
        if (r.ok) setMode('login')
        return
      }
      const r = await authLogin({ username, password })
      if (!r.ok || !r.apiKey) {
        push(r.message, 'error')
        return
      }
      login(
        {
          apiKey: r.apiKey,
          username: r.username || username,
          name: r.name,
          userId: r.userId
        },
        remember
      )
      push('登录成功', 'success')
      navigate('/create', { replace: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-bg p-6">
      <div className="card w-full max-w-md p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <Sparkles className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-xl font-semibold text-text">
              Comfy <span className="text-primary">Studio</span> Web
            </h1>
            <p className="text-sm text-muted">跨系统远程创作工作空间</p>
          </div>
        </div>

        <div className="mb-4 flex rounded-lg border border-border bg-bg p-0.5">
          <button
            type="button"
            className={`flex-1 rounded-md px-3 py-1.5 text-sm ${mode === 'login' ? 'bg-primary/20 text-primary' : 'text-muted'}`}
            onClick={() => setMode('login')}
          >
            登录
          </button>
          <button
            type="button"
            className={`flex-1 rounded-md px-3 py-1.5 text-sm ${mode === 'register' ? 'bg-primary/20 text-primary' : 'text-muted'}`}
            onClick={() => setMode('register')}
          >
            注册
          </button>
        </div>

        <form className="space-y-3" onSubmit={onSubmit}>
          <div>
            <label className="label">账号</label>
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" />
          </div>
          {mode === 'register' ? (
            <div>
              <label className="label">显示名</label>
              <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="可选" />
            </div>
          ) : null}
          <div>
            <label className="label">密码</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>
          {mode === 'login' ? (
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              记住账号（写入本机，XSS 风险更高）
            </label>
          ) : null}
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? '处理中…' : mode === 'login' ? '登录' : '提交注册'}
          </button>
        </form>

        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" className="btn-ghost text-xs" onClick={onTest}>
            测试连接
          </button>
          {healthMsg ? <span className="truncate text-xs text-muted">{healthMsg}</span> : null}
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-muted">
          API Key 仅保存在浏览器会话（或可选本地存储），请勿在公用电脑勾选「记住账号」。上游润色密钥只留在服务端。
        </p>
      </div>
      <ToastHost />
    </div>
  )
}
