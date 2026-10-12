import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, Settings, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useAppStore } from '../stores/appStore'
import type { AiPolishSettingsPublic } from '../../../shared/prompt-polish/types'
import { DEFAULT_AI_POLISH_PUBLIC } from '../../../shared/prompt-polish/types'
import {
  AI_PROVIDER_PRESETS,
  matchPresetId
} from '../../../shared/prompt-polish/ai-provider-presets'

export function SettingsPage() {
  const settings = useAppStore((s) => s.settings)
  const appVersion = useAppStore((s) => s.appVersion)
  const encryptionAvailable = useAppStore((s) => s.encryptionAvailable)
  const showToast = useAppStore((s) => s.showToast)
  const [galleryPath, setGalleryPath] = useState('')
  const [userDataPath, setUserDataPath] = useState('')
  const [clearTasksOpen, setClearTasksOpen] = useState(false)
  const [clearGalleryOpen, setClearGalleryOpen] = useState(false)
  const [ai, setAi] = useState<AiPolishSettingsPublic>(DEFAULT_AI_POLISH_PUBLIC)
  const [aiKeyDraft, setAiKeyDraft] = useState('')
  const [aiTesting, setAiTesting] = useState(false)
  const [presetId, setPresetId] = useState('custom')

  useEffect(() => {
    void window.studio.getSettings().then((res) => {
      setGalleryPath(res.galleryPath || '')
      setUserDataPath(res.userDataPath || '')
    })
    void window.studio.getAiPolishSettings().then((s) => {
      setAi(s)
      setPresetId(matchPresetId(s.baseUrl, s.model))
    })
  }, [])

  const activePreset = useMemo(
    () => AI_PROVIDER_PRESETS.find((p) => p.id === presetId) ?? AI_PROVIDER_PRESETS[AI_PROVIDER_PRESETS.length - 1]!,
    [presetId]
  )

  async function applyPreset(id: string) {
    const preset = AI_PROVIDER_PRESETS.find((p) => p.id === id)
    if (!preset) return
    setPresetId(id)
    if (preset.id === 'custom') return
    const next = {
      ...ai,
      enabled: true,
      baseUrl: preset.baseUrl,
      model: preset.model
    }
    setAi(next)
    const saved = await window.studio.saveAiPolishSettings({
      enabled: true,
      allowDirect: true,
      useGateway: false,
      baseUrl: preset.baseUrl,
      model: preset.model
    })
    setAi(saved)
    showToast('success', `已填入 ${preset.name}，请粘贴 API Key`)
  }

  async function update(partial: Partial<typeof settings>) {
    const next = await window.studio.saveSettings(partial)
    useAppStore.setState({ settings: next })
    showToast('success', '已保存')
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <h1 className="page-title mb-4 flex items-center gap-2">
        <Settings className="h-5 w-5 text-primary" />
        设置
      </h1>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-3 text-sm font-semibold">默认生图参数</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="label">宽度</label>
              <input
                type="number"
                className="input"
                value={settings.defaultWidth}
                onChange={(e) => void update({ defaultWidth: Number(e.target.value) || 1024 })}
              />
            </div>
            <div>
              <label className="label">高度</label>
              <input
                type="number"
                className="input"
                value={settings.defaultHeight}
                onChange={(e) => void update({ defaultHeight: Number(e.target.value) || 1024 })}
              />
            </div>
            <div>
              <label className="label">Steps</label>
              <input
                type="number"
                className="input"
                value={settings.defaultSteps}
                onChange={(e) => void update({ defaultSteps: Number(e.target.value) || 25 })}
              />
            </div>
            <div>
              <label className="label">超时（秒）</label>
              <input
                type="number"
                className="input"
                value={Math.round(settings.timeoutMs / 1000)}
                onChange={(e) =>
                  void update({ timeoutMs: Math.max(30, Number(e.target.value) || 900) * 1000 })
                }
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="label">默认负向提示词</label>
            <textarea
              className="input min-h-[72px] resize-y"
              value={settings.defaultNegativePrompt}
              onChange={(e) => void update({ defaultNegativePrompt: e.target.value })}
            />
          </div>
        </section>

        <section className="card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">AI 润色</h2>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={ai.useGateway !== false}
                  onChange={(e) =>
                    void window.studio
                      .saveAiPolishSettings({ useGateway: e.target.checked })
                      .then(setAi)
                      .then(() => showToast('success', '已保存'))
                  }
                />
                网关代理
              </label>
              <button
                className="btn-secondary !py-1 text-xs"
                disabled={aiTesting}
                onClick={async () => {
                  setAiTesting(true)
                  try {
                    await window.studio.saveAiPolishSettings({ useGateway: true })
                    const res = await window.studio.testAiPolish()
                    setAi(await window.studio.getAiPolishSettings())
                    showToast(res.ok ? 'success' : 'error', res.message)
                  } catch (err) {
                    showToast('error', err instanceof Error ? err.message : '测试失败')
                  } finally {
                    setAiTesting(false)
                  }
                }}
              >
                测试
              </button>
            </div>
          </div>

          {(ai.gatewayMessage || ai.lastTestMessage) && (
            <p className="mb-3 text-xs text-muted">
              {ai.gatewayMessage}
              {ai.lastTestMessage
                ? `${ai.gatewayMessage ? ' · ' : ''}${ai.lastTestOk ? '测试成功' : '测试失败'}`
                : ''}
            </p>
          )}

          <details className="rounded-lg border border-border/80 p-3">
            <summary className="cursor-pointer text-xs text-muted">高级：直连上游</summary>
            <div className="mt-3 space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={ai.allowDirect === true}
                  onChange={(e) =>
                    void window.studio
                      .saveAiPolishSettings({
                        allowDirect: e.target.checked,
                        useGateway: e.target.checked ? false : ai.useGateway
                      })
                      .then(setAi)
                  }
                />
                允许直连
              </label>

              <div>
                <label className="label">服务商</label>
                <div className="flex flex-wrap gap-2">
                  {AI_PROVIDER_PRESETS.map((p) => {
                    const active = presetId === p.id
                    return (
                      <button
                        key={p.id}
                        type="button"
                        title={`${p.blurb}。${p.keyHint}`}
                        className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${
                          active
                            ? 'border-primary/50 bg-primary/15 text-primary'
                            : 'border-border bg-panel-elevated text-muted hover:text-text'
                        }`}
                        onClick={() => void applyPreset(p.id)}
                      >
                        {p.name}
                      </button>
                    )
                  })}
                </div>
                <p className="mt-1.5 text-[11px] text-muted">{activePreset.keyHint}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="label">API Base URL</label>
                  <input
                    className="input"
                    value={ai.baseUrl}
                    onChange={(e) => {
                      setAi({ ...ai, baseUrl: e.target.value })
                      setPresetId(matchPresetId(e.target.value, ai.model))
                    }}
                    onBlur={() =>
                      void window.studio.saveAiPolishSettings({ baseUrl: ai.baseUrl }).then(setAi)
                    }
                  />
                </div>
                <div>
                  <label className="label">模型</label>
                  <input
                    className="input"
                    value={ai.model}
                    onChange={(e) => {
                      setAi({ ...ai, model: e.target.value })
                      setPresetId(matchPresetId(ai.baseUrl, e.target.value))
                    }}
                    onBlur={() =>
                      void window.studio.saveAiPolishSettings({ model: ai.model }).then(setAi)
                    }
                  />
                </div>
                <div>
                  <label className="label">
                    API Key{ai.hasApiKey ? ` · ${ai.apiKeyMasked}` : ''}
                  </label>
                  <input
                    className="input"
                    type="password"
                    autoComplete="off"
                    placeholder={ai.hasApiKey ? '留空保持原密钥' : 'sk-…'}
                    value={aiKeyDraft}
                    onChange={(e) => setAiKeyDraft(e.target.value)}
                  />
                </div>
              </div>
              <button
                className="btn-secondary"
                onClick={async () => {
                  const payload: {
                    apiKey?: string
                    baseUrl: string
                    model: string
                    timeoutMs: number
                    allowDirect: boolean
                    useGateway: boolean
                    enabled: boolean
                  } = {
                    baseUrl: ai.baseUrl,
                    model: ai.model,
                    timeoutMs: ai.timeoutMs,
                    allowDirect: true,
                    useGateway: false,
                    enabled: true
                  }
                  if (aiKeyDraft.trim()) payload.apiKey = aiKeyDraft.trim()
                  const saved = await window.studio.saveAiPolishSettings(payload)
                  setAi(saved)
                  setAiKeyDraft('')
                  showToast('success', '已保存')
                }}
              >
                保存直连
              </button>
            </div>
          </details>
        </section>

        <section className="card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">本地数据</h2>
            <button
              className="btn-secondary !py-1 text-xs"
              onClick={() => void window.studio.openGalleryFolder()}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              打开画廊
            </button>
          </div>
          <div className="space-y-2 text-xs">
            <div>
              <span className="text-muted">画廊 · </span>
              <span className="break-all font-mono text-text">{galleryPath || '…'}</span>
            </div>
            <div>
              <span className="text-muted">数据 · </span>
              <span className="break-all font-mono text-text">{userDataPath || '…'}</span>
            </div>
          </div>
        </section>

        <section className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="mb-2 text-sm font-semibold">清理</h2>
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary !py-1.5 text-xs" onClick={() => setClearTasksOpen(true)}>
                <Trash2 className="h-3.5 w-3.5" />
                清空任务
              </button>
              <button className="btn-danger !py-1.5 text-xs" onClick={() => setClearGalleryOpen(true)}>
                <Trash2 className="h-3.5 w-3.5" />
                清空画廊
              </button>
            </div>
          </div>
          <div className="sm:text-right">
            <h2 className="mb-1 text-sm font-semibold">关于</h2>
            <p className="text-xs text-muted">
              Comfy Studio · v{appVersion}
              <br />
              加密：{encryptionAvailable ? 'safeStorage' : 'Base64'}
            </p>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={clearTasksOpen}
        title="清空任务记录？"
        message="仅清除本机任务历史，不影响画廊。"
        confirmText="清空"
        danger
        onCancel={() => setClearTasksOpen(false)}
        onConfirm={() => {
          useAppStore.setState({ tasks: [] })
          setClearTasksOpen(false)
          showToast('success', '已清空')
        }}
      />

      <ConfirmDialog
        open={clearGalleryOpen}
        title="清空画廊？"
        message="将删除本地全部作品，不可恢复。"
        confirmText="清空"
        danger
        onCancel={() => setClearGalleryOpen(false)}
        onConfirm={async () => {
          await window.studio.clearGallery()
          setClearGalleryOpen(false)
          showToast('success', '已清空')
        }}
      />
    </div>
  )
}
