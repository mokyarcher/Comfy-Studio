import { useEffect, useMemo, useState } from 'react'
import { polishViaGateway, translateViaGateway } from '@/lib/api'
import { runGenerateJob } from '@/lib/generate'
import type { GenerateMode } from '@/lib/types'
import { useQueue } from '@/store/queue'
import { useSession } from '@/store/session'
import { useSettings } from '@/store/settings'
import { useToast } from '@/store/toast'

const PRESETS = [
  { w: 1024, h: 1024, label: '1024²' },
  { w: 768, h: 1024, label: '768×1024' },
  { w: 1024, h: 768, label: '1024×768' }
]

export function CreatePage() {
  const user = useSession((s) => s.user)!
  const settings = useSettings()
  const upsert = useQueue((s) => s.upsert)
  const push = useToast((s) => s.push)

  const [mode, setMode] = useState<GenerateMode>('txt2img')
  const [prompt, setPrompt] = useState('')
  const [negative, setNegative] = useState(settings.defaultNegativePrompt)
  const [width, setWidth] = useState(settings.defaultWidth)
  const [height, setHeight] = useState(settings.defaultHeight)
  const [steps, setSteps] = useState(settings.defaultSteps)
  const [seed, setSeed] = useState('')
  const [length, setLength] = useState(81)
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [status, setStatus] = useState('就绪')

  useEffect(() => {
    const raw = sessionStorage.getItem('comfy-studio-web-apply-prompt')
    if (!raw) return
    try {
      const data = JSON.parse(raw) as { prompt?: string; negative?: string }
      if (data.prompt) setPrompt(data.prompt)
      if (data.negative != null) setNegative(data.negative)
    } catch {
      /* ignore */
    }
    sessionStorage.removeItem('comfy-studio-web-apply-prompt')
  }, [])

  const needsUpload = mode === 'image_edit' || mode === 'image_to_video'
  const canSubmit = useMemo(() => {
    if (!prompt.trim()) return false
    if (needsUpload && !files.length) return false
    if (busy) return false
    return true
  }, [prompt, needsUpload, files, busy])

  async function onPolish() {
    try {
      const r = await polishViaGateway({
        apiKey: user.apiKey,
        timeoutMs: settings.timeoutMs,
        prompt,
        negativePrompt: negative,
        outputLanguage: settings.polishLanguage,
        detail: settings.polishDetail,
        modelProfile: mode === 'image_to_video' ? 'wan' : settings.polishProfile,
        generationMode: mode
      })
      setPrompt(r.enhanced_prompt)
      if (r.enhanced_negative_prompt) setNegative(r.enhanced_negative_prompt)
      push('润色完成', 'success')
    } catch (err) {
      push(err instanceof Error ? err.message : '润色失败', 'error')
    }
  }

  async function onTranslate(dir: 'zh2en' | 'en2zh') {
    try {
      const t = await translateViaGateway({ apiKey: user.apiKey, text: prompt, direction: dir })
      setPrompt(t)
      push('已写回译文', 'success')
    } catch (err) {
      push(err instanceof Error ? err.message : '翻译失败', 'error')
    }
  }

  async function onGenerate() {
    if (!canSubmit) return
    setBusy(true)
    setPreview(null)
    const localId = crypto.randomUUID()
    try {
      const result = await runGenerateJob({
        localId,
        mode,
        prompt: prompt.trim(),
        negativePrompt: negative.trim() || undefined,
        width,
        height,
        steps,
        seed: seed.trim() ? Number(seed) : null,
        length: mode === 'image_to_video' ? length : undefined,
        files: needsUpload ? files : undefined,
        cb: {
          apiKey: user.apiKey,
          pollIntervalMs: settings.pollIntervalMs,
          timeoutMs: settings.timeoutMs,
          jobTimeoutMs: settings.jobTimeoutMs,
          autoPurge: settings.autoPurge,
          isHidden: () => document.visibilityState === 'hidden',
          onBackgroundHint: () => push('标签页在后台，轮询可能被浏览器降速', 'info'),
          onUpdate: (t) => {
            upsert(t)
            setStatus(t.progressMessage || t.status)
            if (t.previewUrl) setPreview(t.previewUrl)
          }
        }
      })
      if (result.status === 'succeeded') push('生成完成，已保存到画廊', 'success')
      else push(result.error || '生成失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <section className="card space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['txt2img', '文生图'],
              ['image_edit', '图编辑'],
              ['image_to_video', '图生视频']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`rounded-lg px-3 py-1.5 text-sm ${mode === id ? 'bg-primary/20 text-primary' : 'bg-bg text-muted'}`}
              onClick={() => setMode(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="label mb-0">提示词</label>
            <div className="flex gap-1">
              <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => onTranslate('zh2en')}>
                中→英
              </button>
              <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => onTranslate('en2zh')}>
                英→中
              </button>
              <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={onPolish}>
                AI 润色
              </button>
            </div>
          </div>
          <textarea className="input min-h-[8rem] resize-y" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="描述画面…" />
        </div>

        <div>
          <label className="label">负向提示词</label>
          <textarea className="input min-h-[4rem] resize-y" value={negative} onChange={(e) => setNegative(e.target.value)} />
        </div>

        {needsUpload ? (
          <div>
            <label className="label">{mode === 'image_to_video' ? '起始图' : '参考图（可多选）'}</label>
            <input
              type="file"
              accept="image/*"
              multiple={mode === 'image_edit'}
              className="block w-full text-sm text-muted"
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
            {files.length ? <p className="mt-1 text-xs text-muted">已选 {files.length} 张</p> : null}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">尺寸预设</label>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className="btn-secondary px-2 py-1 text-xs"
                  onClick={() => {
                    setWidth(p.w)
                    setHeight(p.h)
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">宽</label>
              <input className="input" type="number" value={width} onChange={(e) => setWidth(Number(e.target.value))} />
            </div>
            <div>
              <label className="label">高</label>
              <input className="input" type="number" value={height} onChange={(e) => setHeight(Number(e.target.value))} />
            </div>
          </div>
          <div>
            <label className="label">步数</label>
            <input className="input" type="number" value={steps} onChange={(e) => setSteps(Number(e.target.value))} />
          </div>
          <div>
            <label className="label">种子（空=随机）</label>
            <input className="input" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="随机" />
          </div>
          {mode === 'image_to_video' ? (
            <div>
              <label className="label">视频帧长</label>
              <input className="input" type="number" value={length} onChange={(e) => setLength(Number(e.target.value))} />
            </div>
          ) : null}
        </div>

        <button type="button" className="btn-primary w-full" disabled={!canSubmit} onClick={onGenerate}>
          {busy ? status : '开始生成'}
        </button>
      </section>

      <section className="card flex min-h-[24rem] flex-col p-4 sm:p-5">
        <p className="mb-2 text-sm text-muted">预览 · {status}</p>
        <div className="flex flex-1 items-center justify-center overflow-hidden rounded-lg border border-border bg-bg">
          {preview ? (
            preview.includes('video') || mode === 'image_to_video' ? (
              <video src={preview} controls className="max-h-full max-w-full object-contain" />
            ) : (
              <img src={preview} alt="结果" className="max-h-full max-w-full object-contain" />
            )
          ) : (
            <p className="text-sm text-muted">生成结果会出现在这里</p>
          )}
        </div>
        <p className="mt-3 text-[11px] text-muted">
          成功后写入本机 IndexedDB 画廊；{settings.autoPurge ? '随后会请求服务端 purge' : '未开启自动 purge'}。关闭页面前请确认已保存。
        </p>
      </section>
    </div>
  )
}
