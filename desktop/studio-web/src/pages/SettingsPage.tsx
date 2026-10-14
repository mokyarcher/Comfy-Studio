import { useState, type FormEvent } from 'react'
import { authChangePassword, testConnection } from '@/lib/api'
import { useSession, maskedKey } from '@/store/session'
import { useSettings } from '@/store/settings'
import { useToast } from '@/store/toast'

export function SettingsPage() {
  const user = useSession((s) => s.user)!
  const settings = useSettings()
  const patch = useSettings((s) => s.patch)
  const push = useToast((s) => s.push)
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')

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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-lg font-medium text-text">参数设置</h1>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-medium text-text">账号</h2>
        <p className="text-xs text-muted">
          {user.username} · Key {maskedKey(user)}
        </p>
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={async () => {
            const r = await testConnection()
            push(r.ok ? r.message : r.message, r.ok ? 'success' : 'error')
            if (r.ok && r.maxSteps) {
              /* limits available for future UI */
            }
          }}
        >
          测试连接
        </button>
        <form className="space-y-2" onSubmit={onChangePassword}>
          <input className="input" type="password" placeholder="当前密码" value={oldPw} onChange={(e) => setOldPw(e.target.value)} required />
          <input className="input" type="password" placeholder="新密码" value={newPw} onChange={(e) => setNewPw(e.target.value)} required />
          <button type="submit" className="btn-secondary">
            修改密码
          </button>
        </form>
      </section>

      <section className="card grid gap-3 p-4 sm:grid-cols-2">
        <h2 className="text-sm font-medium text-text sm:col-span-2">创作默认值</h2>
        <div>
          <label className="label">默认宽</label>
          <input className="input" type="number" value={settings.defaultWidth} onChange={(e) => patch({ defaultWidth: Number(e.target.value) })} />
        </div>
        <div>
          <label className="label">默认高</label>
          <input className="input" type="number" value={settings.defaultHeight} onChange={(e) => patch({ defaultHeight: Number(e.target.value) })} />
        </div>
        <div>
          <label className="label">默认步数</label>
          <input className="input" type="number" value={settings.defaultSteps} onChange={(e) => patch({ defaultSteps: Number(e.target.value) })} />
        </div>
        <div>
          <label className="label">轮询间隔 (ms)</label>
          <input className="input" type="number" value={settings.pollIntervalMs} onChange={(e) => patch({ pollIntervalMs: Number(e.target.value) })} />
        </div>
        <div>
          <label className="label">任务超时 (ms)</label>
          <input className="input" type="number" value={settings.jobTimeoutMs} onChange={(e) => patch({ jobTimeoutMs: Number(e.target.value) })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">默认负向</label>
          <textarea className="input min-h-[4rem]" value={settings.defaultNegativePrompt} onChange={(e) => patch({ defaultNegativePrompt: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted sm:col-span-2">
          <input type="checkbox" checked={settings.autoPurge} onChange={(e) => patch({ autoPurge: e.target.checked })} />
          下载到画廊后自动 purge 服务端任务
        </label>
      </section>

      <section className="card grid gap-3 p-4 sm:grid-cols-3">
        <h2 className="text-sm font-medium text-text sm:col-span-3">网关润色</h2>
        <div>
          <label className="label">语言</label>
          <select className="input" value={settings.polishLanguage} onChange={(e) => patch({ polishLanguage: e.target.value as typeof settings.polishLanguage })}>
            <option value="match_input">跟随输入</option>
            <option value="zh">中文</option>
            <option value="en">英文</option>
          </select>
        </div>
        <div>
          <label className="label">详细度</label>
          <select className="input" value={settings.polishDetail} onChange={(e) => patch({ polishDetail: e.target.value as typeof settings.polishDetail })}>
            <option value="concise">简洁</option>
            <option value="standard">标准</option>
            <option value="detailed">详细</option>
          </select>
        </div>
        <div>
          <label className="label">模型画像</label>
          <select className="input" value={settings.polishProfile} onChange={(e) => patch({ polishProfile: e.target.value as typeof settings.polishProfile })}>
            <option value="unknown">通用</option>
            <option value="sdxl">SDXL</option>
            <option value="flux">Flux</option>
            <option value="wan">Wan</option>
          </select>
        </div>
      </section>
    </div>
  )
}
