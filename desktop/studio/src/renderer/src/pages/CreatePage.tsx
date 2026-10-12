import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Dices, Eraser, Expand, ImagePlus, Loader2, PenLine, Save, X } from 'lucide-react'
import { SIZE_PRESETS, type EditImageSlot } from '../../../shared/types'
import { formatElapsed, phaseText, statusLabel } from '../lib/format'
import { useGenerate } from '../hooks/useGenerate'
import { useAppStore } from '../stores/appStore'
import { PromptPolishPanel } from '../features/prompt-polish/components/PromptPolishPanel'
import { GeneratingPreview } from '../components/GeneratingPreview'
import { randomUUID } from '../lib/uuid'

async function fileToEditSlot(file: File): Promise<EditImageSlot> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!)
  const bytesBase64 = btoa(binary)
  const previewDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('无法读取图片预览'))
    reader.readAsDataURL(file)
  })
  return {
    id: randomUUID(),
    name: file.name || 'upload.png',
    previewDataUrl,
    bytesBase64
  }
}

export function CreatePage() {
  const draft = useAppStore((s) => s.draft)
  const setDraft = useAppStore((s) => s.setDraft)
  const clearCreatePrompts = useAppStore((s) => s.clearCreatePrompts)
  const busy = useAppStore((s) => s.busy)
  const tasks = useAppStore((s) => s.tasks)
  const showToast = useAppStore((s) => s.showToast)
  const { run } = useGenerate()
  const [tick, setTick] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const fileRef0 = useRef<HTMLInputElement>(null)
  const fileRef1 = useRef<HTMLInputElement>(null)
  const fileRefs = [fileRef0, fileRef1]
  const current = useMemo(() => {
    return (
      tasks.find(
        (t) =>
          t.status === 'waiting' ||
          t.status === 'submitting' ||
          t.status === 'queued' ||
          t.status === 'running'
      ) ??
      tasks.find((t) => t.status === 'succeeded' && t.imageDataUrl) ??
      tasks[0]
    )
  }, [tasks])

  const canClear = Boolean(
    draft.prompt.trim() ||
      draft.negativePrompt.trim() ||
      draft.editImages.some(Boolean) ||
      current?.imageDataUrl ||
      tasks.length
  )

  useEffect(() => {
    if (!busy) return
    const id = setInterval(() => setTick((x) => x + 1), 1000)
    return () => clearInterval(id)
  }, [busy])

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  // tick forces re-render each second while busy
  void tick
  const elapsed = current?.startedAt ? Date.now() - new Date(current.startedAt).getTime() : 0
  const previewUrl = current?.imageDataUrl && !busy ? current.imageDataUrl : null
  const previewIsVideo = Boolean(
    previewUrl?.startsWith('data:video/') ||
      (draft.mode === 'image_to_video' && previewUrl && !previewUrl.startsWith('data:image/'))
  )

  const buttonLabel = busy
    ? current?.phase === 'waiting' || current?.status === 'waiting'
      ? '等待中…'
      : current?.phase === 'submitted' || current?.status === 'submitting'
        ? '已提交…'
        : current?.phase === 'polling' || current?.status === 'queued'
          ? '轮询中…'
          : current?.phase === 'downloading'
            ? '下载中…'
            : '生成中…'
    : current?.status === 'succeeded'
      ? '再次生成'
      : '开始生成'

  return (
    <div className="flex h-full min-h-0 gap-4 p-5">
      <section className="card flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h1 className="page-title flex items-center gap-2">
            <PenLine className="h-5 w-5 text-primary" />
            开始创作
          </h1>
          <button
            type="button"
            className="btn-secondary shrink-0"
            disabled={!canClear || busy}
            title="清屏"
            onClick={() => {
              clearCreatePrompts()
              showToast('info', '已清屏')
            }}
          >
            <Eraser className="h-4 w-4" />
            清屏
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <label className="label">模式</label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: 'txt2img' as const, label: '文生图' },
                  { id: 'image_edit' as const, label: '图像编辑' },
                  { id: 'image_to_video' as const, label: '图生视频' }
                ] as const
              ).map((m) => {
                const active = draft.mode === m.id
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`rounded-lg border px-3 py-2 text-xs transition ${
                      active
                        ? 'border-primary/50 bg-primary/15 text-primary'
                        : 'border-border bg-panel-elevated text-muted hover:text-text'
                    }`}
                    disabled={busy}
                    onClick={() => {
                      if (m.id === 'image_to_video') {
                        setDraft({ mode: m.id, width: 832, height: 480, steps: 20 })
                      } else {
                        setDraft({ mode: m.id })
                      }
                    }}
                  >
                    {m.label}
                  </button>
                )
              })}
            </div>
          </div>

          {(draft.mode === 'image_edit' || draft.mode === 'image_to_video') && (
            <div>
              <label className="label">
                {draft.mode === 'image_to_video' ? '起始图' : '参考图'}
              </label>
              <div
                className={`grid gap-3 ${draft.mode === 'image_to_video' ? 'grid-cols-1 max-w-xs' : 'grid-cols-2'}`}
              >
                {(
                  draft.mode === 'image_to_video'
                    ? (['起始图'] as const)
                    : (['底图 <image1>', '参考 <image2>'] as const)
                ).map((label, index) => {
                  const slot = draft.editImages[index]
                  return (
                    <div
                      key={label}
                      className="rounded-xl border border-border bg-panel-elevated p-3"
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-xs text-muted">{label}</span>
                        {slot && (
                          <button
                            type="button"
                            className="btn-ghost !px-1 !py-0.5"
                            disabled={busy}
                            title="移除"
                            onClick={() => {
                              const next = [...draft.editImages] as Array<EditImageSlot | null>
                              next[index] = null
                              setDraft({ editImages: next })
                            }}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      {slot ? (
                        <img
                          src={slot.previewDataUrl}
                          alt={label}
                          className="h-28 w-full rounded-lg object-cover"
                        />
                      ) : (
                        <button
                          type="button"
                          className="flex h-28 w-full items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted hover:text-text"
                          disabled={busy}
                          onClick={() => fileRefs[index]?.current?.click()}
                        >
                          选择图片
                        </button>
                      )}
                      <input
                        ref={fileRefs[index]}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          e.target.value = ''
                          if (!file) return
                          void fileToEditSlot(file)
                            .then((slot) => {
                              const next = [...draft.editImages] as Array<EditImageSlot | null>
                              next[index] = slot
                              setDraft({ editImages: next })
                            })
                            .catch((err) =>
                              showToast('error', err instanceof Error ? err.message : '读图失败')
                            )
                        }}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div>
            <label className="label">正向提示词</label>
            <textarea
              className="input min-h-[180px] resize-y leading-relaxed"
              placeholder={
                draft.mode === 'image_edit'
                  ? '保持 <image1> 的姿势，把 <image2> 的服装换上去…'
                  : draft.mode === 'image_to_video'
                    ? '镜头缓慢推进，人物自然眨眼…'
                    : '描述画面…'
              }
              value={draft.prompt}
              onChange={(e) => setDraft({ prompt: e.target.value })}
            />
          </div>

          <div>
            <label className="label">负向提示词</label>
            <textarea
              className="input min-h-[100px] resize-y leading-relaxed"
              placeholder="不想出现的元素…"
              value={draft.negativePrompt}
              onChange={(e) => setDraft({ negativePrompt: e.target.value })}
            />
          </div>

          <PromptPolishPanel />

          <div>
            <label className="label">尺寸</label>
            <div className="flex flex-wrap gap-2">
              {SIZE_PRESETS.map((p) => {
                const active = draft.width === p.width && draft.height === p.height
                return (
                  <button
                    key={p.id}
                    className={`rounded-xl border px-3 py-2 text-xs transition ${
                      active
                        ? 'border-primary/50 bg-primary/15 text-primary'
                        : 'border-border bg-panel-elevated text-muted hover:text-text'
                    }`}
                    onClick={() => setDraft({ width: p.width, height: p.height })}
                    title={`${p.width}×${p.height}`}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">步数</label>
              <input
                type="number"
                min={1}
                max={100}
                className="input"
                value={draft.steps}
                onChange={(e) => setDraft({ steps: Number(e.target.value) || 1 })}
              />
            </div>
            <div>
              <label className="label">种子</label>
              <div className="flex gap-2">
                <select
                  className="input !w-28"
                  value={draft.seedMode}
                  onChange={(e) =>
                    setDraft({
                      seedMode: e.target.value as 'random' | 'fixed',
                      seed: e.target.value === 'random' ? null : (draft.seed ?? Math.floor(Math.random() * 1e9))
                    })
                  }
                >
                  <option value="random">随机</option>
                  <option value="fixed">固定</option>
                </select>
                <input
                  type="number"
                  className="input"
                  disabled={draft.seedMode === 'random'}
                  value={draft.seed ?? ''}
                  placeholder="—"
                  onChange={(e) =>
                    setDraft({ seed: e.target.value === '' ? null : Number(e.target.value) })
                  }
                />
                <button
                  className="btn-secondary !px-3"
                  title="随机种子"
                  onClick={() =>
                    setDraft({ seedMode: 'fixed', seed: Math.floor(Math.random() * 1e9) })
                  }
                >
                  <Dices className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-border p-5">
          <button className="btn-primary w-full !py-3 text-base" disabled={busy} onClick={() => void run()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            {buttonLabel}
          </button>
          {busy && current && (
            <p className="mt-3 text-center text-sm text-muted">
              {current.progressMessage || phaseText(current.status, current.phase)} · 已等待{' '}
              {formatElapsed(elapsed)}
            </p>
          )}
        </div>
      </section>

      <section className="card flex w-[420px] shrink-0 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">预览</h2>
          {(busy || current) && (
            <span className="text-xs text-muted">
              {busy
                ? current?.progressMessage || phaseText(current?.status ?? 'waiting', current?.phase)
                : statusLabel(current!.status)}
            </span>
          )}
        </div>
        <div className="flex min-h-0 flex-1 items-stretch justify-center bg-[#12141a] p-3">
          {previewUrl ? (
            <button
              type="button"
              className="group relative flex max-h-full max-w-full self-center"
              title="点击全屏查看"
              onClick={() => setFullscreen(true)}
            >
              {previewIsVideo ? (
                <video
                  src={previewUrl}
                  controls
                  playsInline
                  className="max-h-full max-w-full rounded-lg border border-border object-contain shadow-panel"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <img
                  src={previewUrl}
                  alt="preview"
                  className="max-h-full max-w-full rounded-lg border border-border object-contain shadow-panel"
                />
              )}
              <span className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/65 px-2 py-1 text-[11px] text-white opacity-80 group-hover:opacity-100">
                <Expand className="h-3.5 w-3.5" />
                全屏
              </span>
            </button>
          ) : busy ? (
            <GeneratingPreview
              mode={draft.mode}
              elapsedMs={elapsed}
              statusText={
                current?.progressMessage || phaseText(current?.status ?? 'waiting', current?.phase)
              }
            />
          ) : (
            <div
              className="flex flex-1 rounded-lg border border-dashed border-[#252830] bg-[#14161d]"
              aria-hidden="true"
            />
          )}
        </div>
        <div className="grid grid-cols-4 gap-1.5 border-t border-border px-3 py-2.5">
          <button
            className="btn-secondary !gap-1 !px-2 !py-1.5 text-xs whitespace-nowrap"
            title="全屏查看"
            disabled={!previewUrl}
            onClick={() => setFullscreen(true)}
          >
            <Expand className="h-3.5 w-3.5 shrink-0" />
            全屏
          </button>
          <button
            className="btn-secondary !gap-1 !px-2 !py-1.5 text-xs whitespace-nowrap"
            title="保存到作品画廊"
            disabled={!previewUrl}
            onClick={async () => {
              if (!previewUrl || !current) return
              try {
                await window.studio.saveImageFromDataUrl({
                  dataUrl: previewUrl,
                  prompt: current.prompt,
                  negativePrompt: current.negativePrompt,
                  width: current.width,
                  height: current.height,
                  steps: current.steps,
                  seed: current.seed,
                  taskId: current.remoteTaskId || current.id,
                  profileId: current.profileId,
                  profileName: current.profileName
                })
                showToast('success', '已保存到作品画廊')
              } catch (err) {
                showToast('error', err instanceof Error ? err.message : '保存失败')
              }
            }}
          >
            <Save className="h-3.5 w-3.5 shrink-0" />
            保存
          </button>
          <button
            className="btn-secondary !gap-1 !px-2 !py-1.5 text-xs whitespace-nowrap"
            title="复制提示词"
            disabled={!current?.prompt}
            onClick={async () => {
              if (!current?.prompt) return
              await navigator.clipboard.writeText(current.prompt)
              showToast('success', '提示词已复制')
            }}
          >
            <Copy className="h-3.5 w-3.5 shrink-0" />
            复制
          </button>
          <button
            className="btn-secondary !gap-1 !px-2 !py-1.5 text-xs whitespace-nowrap"
            title="复用参数到左侧"
            disabled={!current}
            onClick={() => {
              if (!current) return
              useAppStore.getState().applyReuse({
                prompt: current.prompt,
                negativePrompt: current.negativePrompt,
                width: current.width,
                height: current.height,
                steps: current.steps,
                seed: current.seed
              })
              showToast('info', '已回填参数')
            }}
          >
            <Check className="h-3.5 w-3.5 shrink-0" />
            复用
          </button>
        </div>
      </section>

      {fullscreen && previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4"
          onClick={() => setFullscreen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="全屏预览"
        >
          <button
            type="button"
            className="absolute right-4 top-4 z-10 rounded-lg border border-white/20 bg-black/50 p-2 text-white hover:bg-black/70"
            title="关闭全屏（Esc）"
            onClick={() => setFullscreen(false)}
          >
            <X className="h-5 w-5" />
          </button>
          {previewIsVideo ? (
            <video
              src={previewUrl}
              controls
              autoPlay
              playsInline
              className="max-h-full max-w-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              src={previewUrl}
              alt=""
              className="max-h-full max-w-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}
    </div>
  )
}
