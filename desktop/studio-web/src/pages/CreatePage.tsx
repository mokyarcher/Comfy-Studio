import { Eraser, ImageIcon, ImagePlus, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { GlassButton } from '@/components/GlassButton'
import { GlassSwitch } from '@/components/GlassSwitch'
import { SlidingSeg } from '@/components/SlidingSeg'
import { listWorkflows, polishViaGateway, translateViaGateway } from '@/lib/api'
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
import type { GenerateMode, WorkflowInfo } from '@/lib/types'
import { useQueue } from '@/store/queue'
import { useServerLimits } from '@/store/serverLimits'
import { useSession } from '@/store/session'
import { useSettings } from '@/store/settings'
import { useToast } from '@/store/toast'

type RecentItem = GalleryRecord & { url: string }

function hiddenRecentKey(userId: string): string {
  return `comfy-studio-web-recent-hidden:${userId}`
}

function loadHiddenRecent(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(hiddenRecentKey(userId))
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((id): id is string => typeof id === 'string'))
  } catch {
    return new Set()
  }
}

function saveHiddenRecent(userId: string, ids: Set<string>): void {
  localStorage.setItem(hiddenRecentKey(userId), JSON.stringify([...ids]))
}

const WORKFLOW_PREF_KEY = 'comfy-studio-web-txt2img-workflow'

function loadWorkflowPref(): string | null {
  try {
    return localStorage.getItem(WORKFLOW_PREF_KEY)
  } catch {
    return null
  }
}

function saveWorkflowPref(id: string): void {
  try {
    localStorage.setItem(WORKFLOW_PREF_KEY, id)
  } catch {
    /* ignore */
  }
}

type ApplyDraft = {
  prompt?: string
  negative?: string
  width?: number
  height?: number
  steps?: number
  seed?: number | string | null
  mode?: GenerateMode
}

function readApplyDraft(): ApplyDraft | null {
  try {
    const raw = sessionStorage.getItem('comfy-studio-web-apply-prompt')
    if (!raw) return null
    return JSON.parse(raw) as ApplyDraft
  } catch {
    return null
  }
}

export function CreatePage() {
  const user = useSession((s) => s.user)!
  const settings = useSettings()
  const patchSettings = useSettings((s) => s.patch)
  const maxSteps = useServerLimits((s) => s.maxSteps)
  const maxWidth = useServerLimits((s) => s.maxWidth)
  const maxHeight = useServerLimits((s) => s.maxHeight)
  const upsert = useQueue((s) => s.upsert)
  const push = useToast((s) => s.push)
  const apply = useMemo(() => readApplyDraft(), [])

  const [mode, setMode] = useState<GenerateMode>(apply?.mode || 'txt2img')
  const [workflows, setWorkflows] = useState<WorkflowInfo[]>([])
  const [workflowId, setWorkflowId] = useState<string>(() => loadWorkflowPref() || '')
  const [prompt, setPrompt] = useState(() => (apply?.prompt?.trim() ? apply.prompt : ''))
  const [negative, setNegative] = useState(() =>
    apply?.negative != null ? apply.negative : settings.defaultNegativePrompt
  )
  const [width, setWidth] = useState(
    typeof apply?.width === 'number' ? apply.width : settings.defaultWidth
  )
  const [height, setHeight] = useState(
    typeof apply?.height === 'number' ? apply.height : settings.defaultHeight
  )
  const [steps, setSteps] = useState(
    typeof apply?.steps === 'number' ? apply.steps : settings.defaultSteps
  )
  const [seed, setSeed] = useState(() =>
    apply?.seed != null && apply.seed !== '' ? String(apply.seed) : ''
  )
  const [length, setLength] = useState(81)
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [previewIsVideo, setPreviewIsVideo] = useState(false)
  const [historyId, setHistoryId] = useState<string | null>(null)
  const [status, setStatus] = useState('就绪')
  const [progressPercent, setProgressPercent] = useState<number | null>(null)
  const [recent, setRecent] = useState<RecentItem[]>([])
  const [pickingRecent, setPickingRecent] = useState(false)
  const [pickedRecent, setPickedRecent] = useState<Set<string>>(() => new Set())
  const recentOwner = user.userId || user.username
  const hiddenRecentRef = useRef<Set<string>>(loadHiddenRecent(recentOwner))

  useEffect(() => {
    sessionStorage.removeItem('comfy-studio-web-apply-prompt')
  }, [])

  function onClear() {
    if (busy) return
    setPrompt('')
    setNegative('')
    setFiles([])
    setSeed('')
    setPreview(null)
    setPreviewIsVideo(false)
    setHistoryId(null)
    setStatus('就绪')
    setProgressPercent(null)
  }

  async function reloadRecent() {
    const rows = await listGallery()
    const hidden = hiddenRecentRef.current
    setRecent((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.url))
      return rows
        .filter((r) => !hidden.has(r.id))
        .slice(0, 12)
        .map((r) => ({ ...r, url: URL.createObjectURL(r.blob) }))
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

  useEffect(() => {
    if (mode !== 'txt2img') {
      setWorkflows([])
      return
    }
    let cancelled = false
    void listWorkflows({ apiKey: user.apiKey, timeoutMs: settings.timeoutMs, mode: 'txt2img' })
      .then((res) => {
        if (cancelled) return
        setWorkflows(res.workflows)
        const pref = loadWorkflowPref()
        const ids = new Set(res.workflows.map((w) => w.id))
        const fallback =
          (pref && ids.has(pref) ? pref : null) ||
          res.default ||
          res.workflows.find((w) => w.default)?.id ||
          res.workflows[0]?.id ||
          ''
        setWorkflowId(fallback)
      })
      .catch(() => {
        if (!cancelled) setWorkflows([])
      })
    return () => {
      cancelled = true
    }
  }, [mode, user.apiKey, settings.timeoutMs])

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
    setHistoryId(null)
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
        workflowId: mode === 'txt2img' && workflowId ? workflowId : undefined,
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
          saveToCloud: settings.saveToCloud,
          isHidden: () => document.visibilityState === 'hidden',
          onBackgroundHint: () => push('标签页在后台，轮询可能被浏览器降速', 'info'),
          onCloudSaved: () => push('已保存至云端', 'success'),
          onCloudFailed: (msg) => push(msg || '云端同步失败', 'error'),
          onUpdate: (t) => {
            upsert(t)
            setStatus(t.progressMessage || t.status)
            if (t.previewUrl) {
              setPreview(t.previewUrl)
              setPreviewIsVideo(t.mode === 'image_to_video' || Boolean(t.previewUrl.includes('video')))
              // Drop the loading shell as soon as bytes are ready.
              setBusy(false)
              setProgressPercent(null)
              return
            }
            if (t.status === 'running' && t.progress) {
              setProgressPercent(Math.round(t.progress.percent))
            } else if (t.progressMessage === '下载中' && t.progress) {
              setProgressPercent(Math.round(t.progress.percent))
            } else if (t.status === 'queued' || t.status === 'submitting') {
              setProgressPercent(null)
            }
          }
        }
      })
      if (result.status === 'succeeded') {
        push('生成完成', 'success')
        void reloadRecent().catch(() => undefined)
      } else push(result.error || '生成失败', 'error')
    } finally {
      setBusy(false)
      setProgressPercent(null)
    }
  }

  function openRecent(item: RecentItem) {
    setPreview(item.url)
    setPreviewIsVideo(item.mimeType.startsWith('video/'))
    setHistoryId(item.id)
    setStatus('历史预览')
    if (item.prompt) setPrompt(item.prompt)
    if (item.negativePrompt) setNegative(item.negativePrompt)
  }

  function closeHistoryPreview() {
    if (status !== '历史预览') return
    setPreview(null)
    setPreviewIsVideo(false)
    setHistoryId(null)
    setStatus('就绪')
  }

  function togglePickedRecent(id: string) {
    setPickedRecent((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function cancelPickRecent() {
    setPickingRecent(false)
    setPickedRecent(new Set())
  }

  function confirmClearRecent() {
    if (!pickedRecent.size) return
    const next = new Set(hiddenRecentRef.current)
    pickedRecent.forEach((id) => next.add(id))
    hiddenRecentRef.current = next
    saveHiddenRecent(recentOwner, next)
    if (historyId && pickedRecent.has(historyId)) {
      setPreview(null)
      setPreviewIsVideo(false)
      setHistoryId(null)
      setStatus('就绪')
    }
    cancelPickRecent()
    void reloadRecent().catch(() => undefined)
    push('已从预览中清除，画廊作品仍保留', 'success')
  }

  return (
    <div className="page-fill">
      <div className="flex min-h-0 flex-col gap-4 lg:flex-row lg:gap-5">
        <section className="card flex min-h-0 w-full shrink-0 flex-col overflow-hidden lg:w-[28rem] xl:w-[30rem]">
          <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5 sm:px-4">
            <div className="min-w-0 flex-1">
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
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-3.5 py-3.5 sm:px-4">
            {mode === 'txt2img' && workflows.length > 1 ? (
              <div>
                <label className="label" htmlFor="txt2img-workflow">
                  工作流
                </label>
                <select
                  id="txt2img-workflow"
                  className="input"
                  value={workflowId}
                  onChange={(e) => {
                    const next = e.target.value
                    setWorkflowId(next)
                    if (next) saveWorkflowPref(next)
                  }}
                >
                  {workflows.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.display_name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

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
              <div className="empty-state min-h-[8rem] shrink-0 py-6">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10">
                  {busy ? (
                    <Sparkles className="h-5 w-5 animate-pulse text-white/85" />
                  ) : (
                    <ImageIcon className="h-5 w-5 text-white/75" />
                  )}
                </div>
                {busy ? (
                  <div className="w-full max-w-xs space-y-3 px-2">
                    <p className="text-sm text-text">
                      {status}
                      {progressPercent != null ? ` · ${progressPercent}%` : ''}
                    </p>
                    <div className="preview-progress">
                      <div
                        className="preview-progress-bar"
                        style={{
                          width:
                            progressPercent != null
                              ? `${Math.min(100, Math.max(4, progressPercent))}%`
                              : '28%'
                        }}
                        data-indeterminate={progressPercent == null ? '1' : undefined}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted">在左侧输入提示词，开始创作</p>
                )}
              </div>
            )}

            {!busy && recent.length && settings.showRecentWorks ? (
              <div className="mt-3 min-h-0 max-h-[42%] overflow-auto">
                <p className="mb-2 text-xs font-medium text-muted">
                  {pickingRecent ? `选择要清除的预览 · 已选 ${pickedRecent.size}` : '最近作品'}
                </p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                  {recent.map((item) => {
                    const picked = pickedRecent.has(item.id)
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`group relative overflow-hidden rounded-lg border bg-bg text-left transition ${
                          picked
                            ? 'border-white/80 ring-2 ring-white/50'
                            : 'border-border hover:border-white/35'
                        }`}
                        onClick={() =>
                          pickingRecent ? togglePickedRecent(item.id) : openRecent(item)
                        }
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
                        {pickingRecent ? (
                          <span
                            className={`absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                              picked ? 'bg-white text-black' : 'bg-black/50 text-white ring-1 ring-white/40'
                            }`}
                          >
                            {picked ? '✓' : ''}
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}

            <div className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
                <GlassSwitch
                  className="min-w-0"
                  label="保存至云端"
                  checked={settings.saveToCloud}
                  disabled={busy}
                  onChange={(v) => patchSettings({ saveToCloud: v })}
                />
                {recent.length ? (
                  <GlassSwitch
                    className="min-w-0"
                    label="最近作品"
                    checked={settings.showRecentWorks}
                    disabled={busy}
                    onChange={(v) => {
                      if (!v) cancelPickRecent()
                      patchSettings({ showRecentWorks: v })
                    }}
                  />
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!busy && recent.length && settings.showRecentWorks ? (
                  pickingRecent ? (
                    <>
                      <GlassButton className="glass-cta-btn-sm" onClick={cancelPickRecent}>
                        取消
                      </GlassButton>
                      <GlassButton
                        className="glass-cta-btn-sm"
                        disabled={!pickedRecent.size}
                        onClick={confirmClearRecent}
                      >
                        确认清除{pickedRecent.size ? ` ${pickedRecent.size}` : ''}
                      </GlassButton>
                    </>
                  ) : (
                    <GlassButton className="glass-cta-btn-sm" onClick={() => setPickingRecent(true)}>
                      清除
                    </GlassButton>
                  )
                ) : null}
                <GlassButton className="glass-cta-btn-sm" disabled={busy} onClick={onClear}>
                  <span className="inline-flex items-center gap-1">
                    <Eraser className="h-3.5 w-3.5" />
                    清屏
                  </span>
                </GlassButton>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
