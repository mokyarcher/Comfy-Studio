import { ImageIcon, ImagePlus, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { GlassButton } from '@/components/GlassButton'
import { SlidingSeg } from '@/components/SlidingSeg'
import { polishViaGateway, translateViaGateway } from '@/lib/api'
import { listGallery, type GalleryRecord } from '@/lib/gallery-db'
import { runGenerateJob } from '@/lib/generate'
import {
  IMAGE_MAX_SIDE,
  IMAGE_SIZE_PRESETS,
  MAX_VIDEO_LENGTH,
  SIZE_MULTIPLE,
  VIDEO_MAX_LONG,
  VIDEO_SIZE_PRESETS,
  clampImageSize,
  clampSteps,
  clampVideoLength,
  clampVideoSize
} from '@/lib/limits'
import type { GenerateMode } from '@/lib/types'
import { useQueue } from '@/store/queue'
import { useServerLimits } from '@/store/serverLimits'
import { useSession } from '@/store/session'
import { useSettings } from '@/store/settings'
import { useToast } from '@/store/toast'

type RecentItem = GalleryRecord & { url: string }

export function CreatePage() {
  const user = useSession((s) => s.user)!
  const settings = useSettings()
  const maxSteps = useServerLimits((s) => s.maxSteps)
  const maxWidth = useServerLimits((s) => s.maxWidth)
  const maxHeight = useServerLimits((s) => s.maxHeight)
  const upsert = useQueue((s) => s.upsert)
  const push = useToast((s) => s.push)

  const [mode, setMode] = useState<GenerateMode>('txt2img')
  const [prompt, setPrompt] = useState(() => {
    try {
      const raw = sessionStorage.getItem('comfy-studio-web-apply-prompt')
      if (!raw) return ''
      const data = JSON.parse(raw) as { prompt?: string }
      return data.prompt?.trim() ? data.prompt : ''
    } catch {
      return ''
    }
  })
  const [negative, setNegative] = useState(() => {
    try {
      const raw = sessionStorage.getItem('comfy-studio-web-apply-prompt')
      if (!raw) return settings.defaultNegativePrompt
      const data = JSON.parse(raw) as { negative?: string }
      if (data.negative != null) return data.negative
    } catch {
      /* ignore */
    }
    return settings.defaultNegativePrompt
  })
  const [width, setWidth] = useState(settings.defaultWidth)
  const [height, setHeight] = useState(settings.defaultHeight)
  const [steps, setSteps] = useState(settings.defaultSteps)
  const [seed, setSeed] = useState('')
  const [length, setLength] = useState(81)
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [previewIsVideo, setPreviewIsVideo] = useState(false)
  const [status, setStatus] = useState('就绪')
  const [recent, setRecent] = useState<RecentItem[]>([])

  useEffect(() => {
    sessionStorage.removeItem('comfy-studio-web-apply-prompt')
  }, [])

  async function reloadRecent() {
    const rows = await listGallery()
    setRecent((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.url))
      return rows.slice(0, 12).map((r) => ({ ...r, url: URL.createObjectURL(r.blob) }))
    })
  }

  useEffect(() => {
    void reloadRecent().catch(() => undefined)
    return () => {
      setRecent((prev) => {
        prev.forEach((p) => URL.revokeObjectURL(p.url))
        return []
      })
    }
  }, [])

  const needsUpload = mode === 'image_edit' || mode === 'image_to_video'
  const isVideo = mode === 'image_to_video'
  const imageMaxSide = Math.min(IMAGE_MAX_SIDE, maxWidth, maxHeight)
  const sizePresets = isVideo ? VIDEO_SIZE_PRESETS : IMAGE_SIZE_PRESETS

  function applySize(nextW: number, nextH: number) {
    const sized = isVideo
      ? clampVideoSize(nextW, nextH)
      : clampImageSize(nextW, nextH, imageMaxSide)
    setWidth(sized.width)
    setHeight(sized.height)
  }

  useEffect(() => {
    applySize(width, height)
    setSteps((s) => clampSteps(s, maxSteps))
    if (isVideo) setLength((n) => clampVideoLength(n))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reclamp when mode / server limits change
  }, [mode, maxSteps, maxWidth, maxHeight])

  const uploadPreviews = useMemo(
    () => files.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })),
    [files]
  )
  useEffect(() => {
    return () => {
      uploadPreviews.forEach((p) => URL.revokeObjectURL(p.url))
    }
  }, [uploadPreviews])

  const canSubmit = useMemo(() => {
    if (!prompt.trim()) return false
    if (needsUpload && !files.length) return false
    if (busy) return false
    return true
  }, [prompt, needsUpload, files, busy])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON') {
        e.preventDefault()
        void onGenerate()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSubmit, mode, prompt, negative, width, height, steps, seed, length, files, busy])

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
    setPreviewIsVideo(mode === 'image_to_video')
    const localId = crypto.randomUUID()
    const sized = isVideo ? clampVideoSize(width, height) : clampImageSize(width, height, imageMaxSide)
    const safeSteps = clampSteps(steps, maxSteps)
    const safeLength = clampVideoLength(length)
    setWidth(sized.width)
    setHeight(sized.height)
    setSteps(safeSteps)
    if (isVideo) setLength(safeLength)
    try {
      const result = await runGenerateJob({
        localId,
        mode,
        prompt: prompt.trim(),
        negativePrompt: negative.trim() || undefined,
        width: sized.width,
        height: sized.height,
        steps: safeSteps,
        seed: seed.trim() ? Number(seed) : null,
        length: isVideo ? safeLength : undefined,
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
            if (t.previewUrl) {
              setPreview(t.previewUrl)
              setPreviewIsVideo(t.mode === 'image_to_video' || Boolean(t.previewUrl.includes('video')))
            }
          }
        }
      })
      if (result.status === 'succeeded') {
        push('生成完成，已保存到画廊', 'success')
        void reloadRecent().catch(() => undefined)
      } else push(result.error || '生成失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  function openRecent(item: RecentItem) {
    setPreview(item.url)
    setPreviewIsVideo(item.mimeType.startsWith('video/'))
    setStatus('历史预览')
    if (item.prompt) setPrompt(item.prompt)
    if (item.negativePrompt) setNegative(item.negativePrompt)
  }

  function closeHistoryPreview() {
    if (status !== '历史预览') return
    setPreview(null)
    setPreviewIsVideo(false)
    setStatus('就绪')
  }

  return (
    <div className="page-fill">
      <div className="flex min-h-0 flex-col gap-4 lg:flex-row lg:gap-5">
        <section className="card flex min-h-0 w-full shrink-0 flex-col overflow-hidden lg:w-[28rem] xl:w-[30rem]">
          <div className="border-b border-border px-3.5 py-2.5 sm:px-4">
            <SlidingSeg
              aria-label="生成模式"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'txt2img', label: '文生图' },
                { value: 'image_edit', label: '图编辑' },
                { value: 'image_to_video', label: '图生视频' }
              ]}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-3.5 py-3.5 sm:px-4">
            {/* Prompt stack: with upload 50/25/25; without upload ~67/33 */}
            <div className="flex min-h-[14rem] flex-1 flex-col gap-2.5">
              <div className={`flex min-h-0 flex-col ${needsUpload ? 'basis-[50%] flex-[2]' : 'basis-[65%] flex-[2]'}`}>
                <label className="label shrink-0">提示词</label>
                <textarea
                  className="input min-h-0 flex-1 resize-none leading-relaxed"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="描述画面…（Ctrl+Enter 生成）"
                />
              </div>

              <div className={`flex min-h-0 flex-col ${needsUpload ? 'basis-[25%] flex-1' : 'basis-[35%] flex-1'}`}>
                <label className="label shrink-0">负向提示词</label>
                <textarea
                  className="input min-h-0 flex-1 resize-none"
                  value={negative}
                  onChange={(e) => setNegative(e.target.value)}
                  placeholder="不想出现的内容…"
                />
              </div>

              {needsUpload ? (
                <div className="flex min-h-0 basis-[25%] flex-1 flex-col">
                  <label className="label shrink-0">
                    {mode === 'image_to_video' ? '起始图' : '参考图（可多选）'}
                  </label>
                  <label className="file-drop min-h-0 flex-1 cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      multiple={mode === 'image_edit'}
                      className="sr-only"
                      onChange={(e) => setFiles(Array.from(e.target.files || []))}
                    />
                    {uploadPreviews.length ? (
                      <div className="flex h-full min-h-0 w-full items-center justify-center gap-2 overflow-x-auto p-2">
                        {uploadPreviews.map((p) => (
                          <img
                            key={p.url}
                            src={p.url}
                            alt={p.name}
                            className="h-full max-h-full w-auto shrink-0 rounded-md object-cover"
                          />
                        ))}
                        <span className="shrink-0 text-xs text-muted">已选 {files.length} 张 · 点击更换</span>
                      </div>
                    ) : (
                      <div className="file-drop-empty">
                        <ImagePlus className="h-5 w-5 text-white/70" strokeWidth={1.75} />
                        <span className="text-xs text-muted">
                          {mode === 'image_to_video' ? '点击选择起始图' : '点击选择参考图'}
                        </span>
                      </div>
                    )}
                  </label>
                </div>
              ) : null}
            </div>

            <div className="grid shrink-0 grid-cols-2 gap-2.5">
              <div className="col-span-2">
                <label className="label">尺寸预设</label>
                <div className="flex flex-wrap gap-1.5">
                  {sizePresets.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`px-2.5 py-1.5 text-xs ${
                        width === p.width && height === p.height ? 'btn-primary' : 'btn-secondary'
                      }`}
                      onClick={() => applySize(p.width, p.height)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-muted">
                  {isVideo
                    ? '图生视频：横版≤800×496 / 竖版≤496×800，边长为 8 的倍数'
                    : `文生图/图编：每边≤${imageMaxSide}，且为 ${SIZE_MULTIPLE} 的倍数`}
                </p>
              </div>
              <div>
                <label className="label">宽</label>
                <input
                  className="input"
                  type="number"
                  min={SIZE_MULTIPLE}
                  max={isVideo ? VIDEO_MAX_LONG : imageMaxSide}
                  step={SIZE_MULTIPLE}
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                  onBlur={() => applySize(width, height)}
                />
              </div>
              <div>
                <label className="label">高</label>
                <input
                  className="input"
                  type="number"
                  min={SIZE_MULTIPLE}
                  max={isVideo ? VIDEO_MAX_LONG : imageMaxSide}
                  step={SIZE_MULTIPLE}
                  value={height}
                  onChange={(e) => setHeight(Number(e.target.value))}
                  onBlur={() => applySize(width, height)}
                />
              </div>
              <div>
                <label className="label">步数</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={maxSteps}
                  value={steps}
                  onChange={(e) => setSteps(Number(e.target.value))}
                  onBlur={() => setSteps((s) => clampSteps(s, maxSteps))}
                />
                <p className="mt-1 text-[11px] text-muted">上限 {maxSteps}（服务端）</p>
              </div>
              <div>
                <label className="label">种子</label>
                <input className="input" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="随机" />
              </div>
              {isVideo ? (
                <div className="col-span-2">
                  <label className="label">视频帧长</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={MAX_VIDEO_LENGTH}
                    value={length}
                    onChange={(e) => setLength(Number(e.target.value))}
                    onBlur={() => setLength((n) => clampVideoLength(n))}
                  />
                  <p className="mt-1 text-[11px] text-muted">上限 {MAX_VIDEO_LENGTH}</p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="shrink-0 space-y-2.5 border-t border-white/10 px-3.5 py-3 sm:px-4">
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                className="btn-secondary py-2 text-xs"
                disabled={busy || !prompt.trim()}
                onClick={() => onTranslate('zh2en')}
              >
                中 → 英
              </button>
              <button
                type="button"
                className="btn-secondary py-2 text-xs"
                disabled={busy || !prompt.trim()}
                onClick={() => onTranslate('en2zh')}
              >
                英 → 中
              </button>
              <button
                type="button"
                className="btn-secondary py-2 text-xs"
                disabled={busy || !prompt.trim()}
                onClick={() => void onPolish()}
              >
                AI 润色
              </button>
            </div>
            <GlassButton disabled={!canSubmit} onClick={() => void onGenerate()}>
              {busy ? status : '开始生成'}
            </GlassButton>
            <p className="text-center text-[11px] text-muted">Ctrl + Enter</p>
          </div>
        </section>

        <section className="card flex min-h-[22rem] min-w-0 flex-1 flex-col overflow-hidden lg:min-h-0">
          <div className="flex items-center justify-between gap-3 border-b border-border px-3.5 py-2.5 sm:px-4">
            <p className="text-sm font-medium text-text">预览</p>
            <div className="flex items-center gap-2">
              {status === '历史预览' ? (
                <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={closeHistoryPreview}>
                  返回
                </button>
              ) : null}
              <span className="status-chip">{status}</span>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col p-3.5 sm:p-4">
            {preview ? (
              <div
                className={`flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-border bg-bg ${
                  status === '历史预览' ? 'cursor-pointer' : ''
                }`}
                title={status === '历史预览' ? '点击返回最近作品' : undefined}
                onClick={status === '历史预览' ? closeHistoryPreview : undefined}
              >
                {previewIsVideo ? (
                  <video
                    src={preview}
                    controls
                    className="max-h-full max-w-full object-contain"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <img src={preview} alt="结果" className="max-h-full max-w-full object-contain" />
                )}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-4">
                <div className="empty-state min-h-[10rem] shrink-0 py-8">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10">
                    {busy ? <Sparkles className="h-5 w-5 animate-pulse text-white/85" /> : <ImageIcon className="h-5 w-5 text-white/75" />}
                  </div>
                  <p className="text-sm text-muted">
                    {busy ? status : '在左侧输入提示词，开始创作'}
                  </p>
                  <p className="max-w-sm text-[11px] leading-relaxed text-muted/80">
                    {busy
                      ? '生成中…结果会出现在这里'
                      : `成功后写入本机画廊${settings.autoPurge ? '，并 purge 服务端任务' : ''}`}
                  </p>
                </div>

                {recent.length ? (
                  <div className="min-h-0 flex-1 overflow-auto">
                    <p className="mb-2 text-xs font-medium text-muted">最近作品</p>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                      {recent.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="group overflow-hidden rounded-lg border border-border bg-bg text-left transition hover:border-white/35"
                          title={item.prompt}
                          onClick={() => openRecent(item)}
                        >
                          {item.mimeType.startsWith('video/') ? (
                            <video src={item.url} className="aspect-square w-full object-cover" muted />
                          ) : (
                            <img
                              src={item.url}
                              alt=""
                              className="aspect-square w-full object-cover transition group-hover:scale-[1.03]"
                            />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
            {preview && status === '历史预览' ? (
              <p className="mt-3 text-center text-[11px] text-muted">点击图片返回最近作品</p>
            ) : null}
            {preview && status !== '历史预览' ? (
              <p className="mt-3 text-[11px] leading-relaxed text-muted">
                已写入本机画廊；{settings.autoPurge ? '随后会请求服务端 purge' : '未开启自动 purge'}。
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}
