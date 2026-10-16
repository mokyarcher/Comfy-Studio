import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { GlassCard } from '@/components/GlassCard'
import { GlassSwitch } from '@/components/GlassSwitch'
import { SlidingSeg } from '@/components/SlidingSeg'
import { ToastHost } from '@/components/ToastHost'
import { WorkspaceBackground } from '@/components/WorkspaceBackground'
import { authLogin, authRegister, testConnection } from '@/lib/api'
import { preloadBackground } from '@/lib/backgrounds'
import { useSession } from '@/store/session'
import { useSettings } from '@/store/settings'
import { useToast } from '@/store/toast'

export function AuthPage() {
  const navigate = useNavigate()
  const user = useSession((s) => s.user)
  const hydrated = useSession((s) => s.hydrated)
  const login = useSession((s) => s.login)
  const remember = useSession((s) => s.remember)
  const setRemember = useSession((s) => s.setRemember)
  const backgroundId = useSettings((s) => s.backgroundId)
  const push = useToast((s) => s.push)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [healthMsg, setHealthMsg] = useState('')

  // Login screen: only warm the currently selected full-res background.
  useEffect(() => {
    void preloadBackground(backgroundId)
  }, [backgroundId])

  if (hydrated && user) {
    return <Navigate to="/home" replace />
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
      void preloadBackground(backgroundId)
      push('登录成功', 'success')
      navigate('/home', { replace: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="workspace-shell auth-shell relative h-dvh w-full overflow-hidden">
      <WorkspaceBackground backgroundId={backgroundId} />
      <GlassCard
        // fixed + elasticity 0: library translate(-50%) centers on viewport; mouse follow was yanking it to a corner
        mouseContainer={null}
        elasticity={0}
        cornerRadius={18}
        className="max-w-md"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          zIndex: 10,
          width: 'min(calc(100vw - 3rem), 28rem)',
          maxWidth: '28rem'
        }}
        padding="1.5rem"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-text">
              Comfy <span className="text-primary">Studio</span> Web
            </h1>
            <p className="text-sm text-muted">跨系统远程创作工作空间</p>
          </div>
        </div>

        <SlidingSeg
          className="mb-4 w-full"
          aria-label="登录或注册"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'login', label: '登录' },
            { value: 'register', label: '注册' }
          ]}
        />

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
            <GlassSwitch
              label="记住账号"
              description="公用电脑请勿开启；凭证会写到本机长期保存。"
              checked={remember}
              onChange={setRemember}
            />
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
          默认只保存在浏览器会话；勾选「记住账号」才会写入本机。上游润色密钥只留在服务端。
        </p>
      </GlassCard>
      <ToastHost />
    </div>
  )
}
