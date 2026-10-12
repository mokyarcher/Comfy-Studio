import { useState, type FormEvent } from 'react'
import { Loader2, LogIn, UserPlus } from 'lucide-react'
import { useAppStore } from '../stores/appStore'

type Mode = 'login' | 'register'

const LAST_URL_KEY = 'comfy-studio-last-base-url'
const DEFAULT_BASE_URL = 'https://qwen-image-2-1.sharex.team'

/** Drop known-wrong / obsolete saved URLs so a rebuilt default can take effect. */
function readSavedBaseUrl(): string {
  try {
    const saved = (localStorage.getItem(LAST_URL_KEY) || '').trim().replace(/\/+$/, '')
    if (!saved) return DEFAULT_BASE_URL
    const bad = [
      'https://sharex.team/qwen-image',
      'http://sharex.team/qwen-image',
      'https://sharex.team',
      'http://sharex.team'
    ]
    if (bad.includes(saved) || /^https?:\/\/sharex\.team\/qwen-image/i.test(saved)) {
      localStorage.setItem(LAST_URL_KEY, DEFAULT_BASE_URL)
      return DEFAULT_BASE_URL
    }
    return saved
  } catch {
    return DEFAULT_BASE_URL
  }
}

export function AuthPage() {
  const loadBootstrap = useAppStore((s) => s.loadBootstrap)
  const showToast = useAppStore((s) => s.showToast)

  const [mode, setMode] = useState<Mode>('login')
  const [baseUrl, setBaseUrl] = useState(() => readSavedBaseUrl())
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [privacyAgreed, setPrivacyAgreed] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const url = baseUrl.trim().replace(/\/+$/, '')
    if (!url) {
      setError('请填写服务器地址')
      return
    }
    if (!username.trim() || !password) {
      setError('请填写用户名和密码')
      return
    }
    if (mode === 'register' && !privacyAgreed) {
      setError('请先阅读并同意隐私须知')
      return
    }
    setBusy(true)
    try {
      localStorage.setItem(LAST_URL_KEY, url)
      if (mode === 'register') {
        const res = await window.studio.authRegister({
          baseUrl: url,
          username: username.trim(),
          password,
          displayName: displayName.trim() || username.trim()
        })
        if (!res.ok) {
          setError(res.message)
          return
        }
        showToast('success', res.message)
        setMode('login')
        setPassword('')
        return
      }
      const res = await window.studio.authLogin({
        baseUrl: url,
        username: username.trim(),
        password
      })
      if (!res.ok) {
        setError(res.message)
        return
      }
      showToast('success', '登录成功')
      await loadBootstrap()
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-bg p-6">
      <form className="card w-full max-w-md p-6" onSubmit={(e) => void onSubmit(e)}>
        <h1 className="text-xl font-semibold tracking-tight">Comfy Studio</h1>
        <p className="mt-1 text-sm text-muted">{mode === 'login' ? '登录' : '注册（需管理员审核）'}</p>

        <div className="mt-5 space-y-3">
          <div>
            <label className="label">服务器地址</label>
            <input
              className="input font-mono text-xs"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://qwen-image-2-1.sharex.team"
              autoComplete="url"
            />
          </div>
          <div>
            <label className="label">用户名</label>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>
          {mode === 'register' && (
            <div>
              <label className="label">显示名称（可选）</label>
              <input
                className="input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
          )}
          <div>
            <label className="label">密码</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>
        </div>

        {mode === 'register' && (
          <div className="mt-4 space-y-2 rounded-xl border border-border bg-panel-elevated px-3 py-3">
            <p className="text-xs font-medium text-text">隐私须知</p>
            <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-muted">
              <li>参考图与提示词仅用于本次创作。</li>
              <li>任务完成后服务端清除相关数据；成品保留在本机画廊。</li>
            </ul>
            <label className="flex cursor-pointer items-start gap-2 pt-1 text-[11px] text-text">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={privacyAgreed}
                onChange={(e) => setPrivacyAgreed(e.target.checked)}
              />
              <span>已阅读并同意</span>
            </label>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        <button
          type="submit"
          className="btn-primary mt-5 w-full !py-2.5"
          disabled={busy || (mode === 'register' && !privacyAgreed)}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : mode === 'login' ? (
            <LogIn className="h-4 w-4" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
          {mode === 'login' ? '登录' : '注册'}
        </button>

        <button
          type="button"
          className="btn-ghost mt-3 w-full text-xs"
          disabled={busy}
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login')
            setError(null)
            setPrivacyAgreed(false)
          }}
        >
          {mode === 'login' ? '没有账号？去注册' : '已有账号？去登录'}
        </button>
        {mode === 'login' && (
          <p className="mt-3 text-center text-[11px] text-muted">忘记密码请联系管理员</p>
        )}
      </form>
    </div>
  )
}
