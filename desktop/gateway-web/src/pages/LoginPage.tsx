import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminLogin } from '@/lib/api'

export function LoginPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await adminLogin(password, totp.trim())
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <form className="card w-full max-w-md space-y-4 p-6 sm:p-8" onSubmit={onSubmit}>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Comfy <span className="text-primary">Gateway</span>
          </h1>
          <p className="mt-1 text-sm text-muted">管理员密码 + Authenticator 动态码</p>
        </div>

        <div>
          <label className="label" htmlFor="password">
            管理密码
          </label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            placeholder="ADMIN_PASSWORD"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="totp">
            动态验证码
          </label>
          <input
            id="totp"
            className="input"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="手机 Authenticator 6 位"
            value={totp}
            onChange={(e) => setTotp(e.target.value)}
            required
          />
        </div>

        {error ? <p className="text-xs text-danger">{error}</p> : null}

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? '处理中…' : '登录'}
        </button>
      </form>
    </div>
  )
}
