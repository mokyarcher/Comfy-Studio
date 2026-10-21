import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ChevronLeft, ChevronRight, LogOut } from 'lucide-react'
import { GlassSelect } from '@/components/GlassSelect'
import { GlassSwitch } from '@/components/GlassSwitch'
import { BACKGROUNDS, BACKGROUND_PAGE_SIZE, preloadBackground } from '@/lib/backgrounds'
import { authBindEmail, authChangePassword, authProfile, testConnection } from '@/lib/api'
import {
  IMAGE_MAX_HEIGHT,
  IMAGE_MAX_WIDTH,
  SIZE_MULTIPLE,
  clampImageSize,
  clampSteps
} from '@/lib/limits'
import { useServerLimits } from '@/store/serverLimits'
import { useSession, maskedKey } from '@/store/session'
import {
  GLASS_BLUR_DEFAULT,
  GLASS_BLUR_MAX,
  GLASS_BLUR_MIN,
  GLASS_OPACITY_DEFAULT,
  GLASS_OPACITY_MAX,
  GLASS_OPACITY_MIN,
  useSettings
} from '@/store/settings'
import { useToast } from '@/store/toast'

export function SettingsPage() {
  const user = useSession((s) => s.user)!
  const logout = useSession((s) => s.logout)
  const patchUser = useSession((s) => s.patchUser)
  const settings = useSettings()
  const patch = useSettings((s) => s.patch)
  const maxSteps = useServerLimits((s) => s.maxSteps)
  const maxWidth = useServerLimits((s) => s.maxWidth)
  const maxHeight = useServerLimits((s) => s.maxHeight)
  const imageMaxW = Math.min(IMAGE_MAX_WIDTH, maxWidth)
  const imageMaxH = Math.min(IMAGE_MAX_HEIGHT, maxHeight)
  const push = useToast((s) => s.push)
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [bindEmail, setBindEmail] = useState('')
  const [bindPassword, setBindPassword] = useState('')
  const bgPageCount = Math.max(1, Math.ceil(BACKGROUNDS.length / BACKGROUND_PAGE_SIZE))
  const [bgPage, setBgPage] = useState(() => {
    const idx = BACKGROUNDS.findIndex((b) => b.id === settings.backgroundId)
    return idx >= 0 ? Math.floor(idx / BACKGROUND_PAGE_SIZE) : 0
  })
  const bgPageItems = useMemo(() => {
    const start = bgPage * BACKGROUND_PAGE_SIZE
    return BACKGROUNDS.slice(start, start + BACKGROUND_PAGE_SIZE)
  }, [bgPage])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const r = await authProfile(user.apiKey)
      if (cancelled || !r.ok || r.email == null) return
      patchUser({ email: r.email })
    })()
    return () => {
      cancelled = true
    }
  }, [user.apiKey, patchUser])

  async function onChangePassword(e: FormEvent) {
    e.preventDefault()
    const r = await authChangePassword({
      apiKey: user.apiKey,
      oldPassword: oldPw,
      newPassword: newPw
    })
    push(r.message, r.ok ? 'success' : 'error')
    if (r.ok) {
      setOldPw('')
      setNewPw('')
    }
  }

  async function onBindEmail(e: FormEvent) {
    e.preventDefault()
    const r = await authBindEmail({
      apiKey: user.apiKey,
      password: bindPassword,
      email: bindEmail.trim()
    })
    push(r.message, r.ok ? 'success' : 'error')
    if (r.ok) {
      patchUser({ email: r.email || bindEmail.trim() })
      setBindEmail('')
      setBindPassword('')
    }
  }

  return (
    <div className="page space-y-5">
      <div className="page-header mb-0">
        <div>
          <h1 className="page-title">参数设置</h1>
          <p className="page-sub">账号与创作默认值保存在本机浏览器。</p>
        </div>
      </div>

      <section className="card space-y-3 p-4 sm:p-5">
        <h2 className="text-sm font-medium text-text">外观</h2>
        <p className="text-xs text-muted">背景、浓度与毛玻璃强度保存在本机浏览器，即时生效。</p>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label className="label mb-0" htmlFor="glass-opacity">
              玻璃浓度
            </label>
            <button
              type="button"
              className="text-[11px] text-muted hover:text-text"
              onClick={() => patch({ glassOpacity: GLASS_OPACITY_DEFAULT })}
            >
              重置
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span className="shrink-0 text-[11px] text-muted">更透</span>
            <input
              id="glass-opacity"
              className="glass-range w-full"
              type="range"
              min={GLASS_OPACITY_MIN}
              max={GLASS_OPACITY_MAX}
              step={1}
              value={settings.glassOpacity}
              onChange={(e) => patch({ glassOpacity: Number(e.target.value) })}
            />
            <span className="shrink-0 text-[11px] text-muted">更实</span>
            <span className="w-8 shrink-0 text-right text-xs tabular-nums text-text">{settings.glassOpacity}</span>
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label className="label mb-0" htmlFor="glass-blur">
              毛玻璃强度
            </label>
            <button
              type="button"
              className="text-[11px] text-muted hover:text-text"
              onClick={() => patch({ glassBlur: GLASS_BLUR_DEFAULT })}
            >
              重置
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span className="shrink-0 text-[11px] text-muted">更弱</span>
            <input
              id="glass-blur"
              className="glass-range w-full"
              type="range"
              min={GLASS_BLUR_MIN}
              max={GLASS_BLUR_MAX}
              step={1}
              value={settings.glassBlur}
              onChange={(e) => patch({ glassBlur: Number(e.target.value) })}
            />
            <span className="shrink-0 text-[11px] text-muted">更强</span>
            <span className="w-8 shrink-0 text-right text-xs tabular-nums text-text">{settings.glassBlur}</span>
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="label mb-0">背景图</p>
            <span className="text-[11px] tabular-nums text-muted">
              {bgPage + 1} / {bgPageCount}
            </span>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {bgPageItems.map((bg) => {
              const active = settings.backgroundId === bg.id
              return (
                <button
                  key={bg.id}
                  type="button"
                  className={`relative overflow-hidden rounded-lg border text-left transition ${
                    active
                      ? 'border-white/45 shadow-[0_0_0_2px_rgba(255,255,255,0.22)]'
                      : 'border-white/10 hover:border-white/35'
                  }`}
                  title={bg.label}
                  onClick={() => {
                    if (settings.backgroundId === bg.id) return
                    patch({ backgroundId: bg.id })
                    void preloadBackground(bg.id)
                  }}
                >
                  {active ? (
                    <span className="absolute right-1 top-1 z-10 rounded bg-black/55 px-1 py-0.5 text-[10px] text-white">
                      已选中
                    </span>
                  ) : null}
                  <img
                    src={bg.previewUrl}
                    alt={bg.label}
                    className="aspect-video w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                  <span className="block truncate px-1.5 py-1 text-[11px] text-muted">{bg.label}</span>
                </button>
              )
            })}
          </div>
          {bgPageCount > 1 ? (
            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                className="btn-ghost inline-flex items-center gap-1 text-xs disabled:opacity-40"
                disabled={bgPage <= 0}
                onClick={() => setBgPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                上一页
              </button>
              <button
                type="button"
                className="btn-ghost inline-flex items-center gap-1 text-xs disabled:opacity-40"
                disabled={bgPage >= bgPageCount - 1}
                onClick={() => setBgPage((p) => Math.min(bgPageCount - 1, p + 1))}
              >
                下一页
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-3 p-4 sm:p-5">
          <h2 className="text-sm font-medium text-text">账号</h2>
          <p className="text-xs text-muted">
            {user.username} · Key {maskedKey(user)}
          </p>
          <p className="text-xs text-muted">
            找回邮箱：
            {user.email ? <span className="text-text">{user.email}</span> : '未绑定'}
          </p>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={async () => {
              const r = await testConnection()
              push(r.ok ? r.message : r.message, r.ok ? 'success' : 'error')
            }}
          >
            测试连接
          </button>
          <form className="space-y-2.5 pt-1" onSubmit={onChangePassword}>
            <input
              className="input"
              type="password"
              placeholder="当前密码"
              value={oldPw}
              onChange={(e) => setOldPw(e.target.value)}
              required
            />
            <input
              className="input"
              type="password"
              placeholder="新密码"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              required
            />
            <button type="submit" className="btn-secondary">
              修改密码
            </button>
          </form>
          <form className="space-y-2.5" onSubmit={onBindEmail}>
            <p className="text-[11px] text-muted">
              {user.email
                ? '更换找回邮箱（需验证当前密码，不会发邮件）'
                : '绑定找回邮箱（需验证当前密码，不会发邮件）'}
            </p>
            <input
              className="input"
              type="email"
              placeholder={user.email ? '新邮箱' : '邮箱'}
              value={bindEmail}
              onChange={(e) => setBindEmail(e.target.value)}
              required
            />
            <input
              className="input"
              type="password"
              placeholder="当前密码"
              value={bindPassword}
              onChange={(e) => setBindPassword(e.target.value)}
              required
            />
            <button type="submit" className="btn-secondary">
              {user.email ? '更新邮箱' : '绑定邮箱'}
            </button>
          </form>
          <div className="border-t border-border pt-3">
            <button
              type="button"
              className="btn-ghost h-9 w-full justify-start gap-2 px-2 text-xs hover:text-danger"
              onClick={logout}
            >
              <LogOut className="h-3.5 w-3.5" />
              退出登录
            </button>
          </div>
        </section>

        <section className="card grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
          <h2 className="text-sm font-medium text-text sm:col-span-2">网关润色</h2>
          <div>
            <label className="label">语言</label>
            <GlassSelect
              aria-label="语言"
              value={settings.polishLanguage}
              onChange={(v) => patch({ polishLanguage: v as typeof settings.polishLanguage })}
              options={[
                { value: 'match_input', label: '跟随输入' },
                { value: 'zh', label: '中文' },
                { value: 'en', label: '英文' }
              ]}
            />
          </div>
          <div>
            <label className="label">详细度</label>
            <GlassSelect
              aria-label="详细度"
              value={settings.polishDetail}
              onChange={(v) => patch({ polishDetail: v as typeof settings.polishDetail })}
              options={[
                { value: 'concise', label: '简洁' },
                { value: 'standard', label: '标准' },
                { value: 'detailed', label: '详细' }
              ]}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">模型画像</label>
            <GlassSelect
              aria-label="模型画像"
              value={settings.polishProfile}
              onChange={(v) => patch({ polishProfile: v as typeof settings.polishProfile })}
              options={[
                { value: 'unknown', label: '通用' },
                { value: 'sdxl', label: 'SDXL' },
                { value: 'flux', label: 'Flux' },
                { value: 'wan', label: 'Wan' }
              ]}
            />
          </div>
        </section>
      </div>

      <section className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 sm:p-5">
        <h2 className="text-sm font-medium text-text sm:col-span-2 lg:col-span-3">创作默认值</h2>
        <div>
          <label className="label">默认宽</label>
          <input
            className="input"
            type="number"
            min={SIZE_MULTIPLE}
            max={imageMaxW}
            step={SIZE_MULTIPLE}
            value={settings.defaultWidth}
            onChange={(e) => patch({ defaultWidth: Number(e.target.value) })}
            onBlur={() => {
              const sized = clampImageSize(
                settings.defaultWidth,
                settings.defaultHeight,
                imageMaxW,
                imageMaxH
              )
              patch({ defaultWidth: sized.width, defaultHeight: sized.height })
            }}
          />
        </div>
        <div>
          <label className="label">默认高</label>
          <input
            className="input"
            type="number"
            min={SIZE_MULTIPLE}
            max={imageMaxH}
            step={SIZE_MULTIPLE}
            value={settings.defaultHeight}
            onChange={(e) => patch({ defaultHeight: Number(e.target.value) })}
            onBlur={() => {
              const sized = clampImageSize(
                settings.defaultWidth,
                settings.defaultHeight,
                imageMaxW,
                imageMaxH
              )
              patch({ defaultWidth: sized.width, defaultHeight: sized.height })
            }}
          />
        </div>
        <div>
          <label className="label">默认步数</label>
          <input
            className="input"
            type="number"
            min={1}
            max={maxSteps}
            value={settings.defaultSteps}
            onChange={(e) => patch({ defaultSteps: Number(e.target.value) })}
            onBlur={() => patch({ defaultSteps: clampSteps(settings.defaultSteps, maxSteps) })}
          />
          <p className="mt-1 text-[11px] text-muted">上限 {maxSteps}（服务端）</p>
        </div>
        <div>
          <label className="label">轮询间隔 (ms)</label>
          <input
            className="input"
            type="number"
            value={settings.pollIntervalMs}
            onChange={(e) => patch({ pollIntervalMs: Number(e.target.value) })}
          />
        </div>
        <div>
          <label className="label">任务超时 (ms)</label>
          <input
            className="input"
            type="number"
            value={settings.jobTimeoutMs}
            onChange={(e) => patch({ jobTimeoutMs: Number(e.target.value) })}
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <label className="label">默认负向</label>
          <textarea
            className="input min-h-[4.5rem]"
            value={settings.defaultNegativePrompt}
            onChange={(e) => patch({ defaultNegativePrompt: e.target.value })}
          />
        </div>
        <GlassSwitch
          className="sm:col-span-2 lg:col-span-3"
          label="保存到画廊后，清理服务器上的临时图"
          checked={settings.autoPurge}
          onChange={(v) => patch({ autoPurge: v })}
        />
      </section>
    </div>
  )
}
