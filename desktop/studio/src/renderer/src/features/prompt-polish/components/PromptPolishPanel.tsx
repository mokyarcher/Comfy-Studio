import { useState } from 'react'
import { ArrowLeftRight, Copy, Loader2, RotateCcw, Wand2 } from 'lucide-react'
import type { ModelProfileId, PolishDetail, PromptLanguage } from '../../../../../shared/prompt-polish/types'
import { usePromptPolish } from '../hooks/usePromptPolish'
import { PromptModeSwitch } from './PromptModeSwitch'
import { PromptChangeSummary } from './PromptChangeSummary'
import { PromptConflictBanner } from './PromptConflictBanner'
import { useAppStore } from '../../../stores/appStore'

const IMAGE_MODEL_OPTIONS: Array<{ id: ModelProfileId; label: string }> = [
  { id: 'unknown', label: '通用' },
  { id: 'flux', label: 'FLUX' },
  { id: 'sdxl', label: 'SDXL' },
  { id: 'sd15', label: 'SD 1.5' },
  { id: 'sd3', label: 'SD3' }
]

const VIDEO_MODEL_OPTIONS: Array<{ id: ModelProfileId; label: string }> = [
  { id: 'wan', label: 'Wan 视频' },
  { id: 'unknown', label: '通用' }
]

export function PromptPolishPanel() {
  const polish = usePromptPolish()
  const draftMode = useAppStore((s) => s.draft.mode)
  const isVideo = draftMode === 'image_to_video'
  const [summaryOpen, setSummaryOpen] = useState(false)
  const modelOptions = isVideo ? VIDEO_MODEL_OPTIONS : IMAGE_MODEL_OPTIONS
  const selectProfile = pickAllowedProfile(polish.modelProfile, modelOptions)

  return (
    <section className="rounded-xl border border-border bg-panel-elevated/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2
          className="flex items-center gap-2 text-sm font-semibold"
          title={
            isVideo
              ? '用服务端 AI 优化镜头/运动描述，写入正负向提示词'
              : '用服务端 AI 润色正负向提示词，让描述更完整'
          }
        >
          <Wand2 className="h-4 w-4 text-primary" />
          {isVideo ? '视频镜头润色' : 'AI 润色'}
        </h2>
        <PromptModeSwitch aiSettings={polish.aiSettings} onConfigureAi={polish.goConfigureAi} />
      </div>
      {isVideo && (
        <p className="mb-3 text-[11px] leading-relaxed text-muted">
          按图生视频规则优化：动作与运镜优先，少做静态画面扩写。
        </p>
      )}

      {polish.error && <p className="mb-2 text-xs text-danger">{polish.error}</p>}

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="label">语言</label>
          <select
            className="input"
            value={polish.outputLanguage}
            onChange={(e) => polish.updateLanguage(e.target.value as PromptLanguage)}
          >
            <option value="match_input">跟随原文</option>
            <option value="zh">中文</option>
            <option value="en">英文</option>
          </select>
        </div>
        <div>
          <label className="label">详细度</label>
          <select
            className="input"
            value={polish.detail}
            onChange={(e) => polish.updateDetail(e.target.value as PolishDetail)}
          >
            <option value="concise">精简</option>
            <option value="standard">标准</option>
            <option value="detailed">详细</option>
          </select>
        </div>
        <div>
          <label className="label">模型风格</label>
          <select
            className="input"
            value={selectProfile}
            onChange={(e) => polish.updateModelProfile(e.target.value as ModelProfileId)}
          >
            {modelOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {polish.result && (
        <div className="mt-3">
          <PromptConflictBanner
            conflicts={polish.result.conflicts}
            ack={polish.conflictAck}
            onAckChange={polish.setConflictAck}
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary"
          disabled={polish.polishing || polish.translating}
          onClick={() => void polish.polish()}
          title={isVideo ? '按图生视频规则优化当前提示词' : '一键润色当前正负向提示词'}
        >
          {polish.polishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          {isVideo ? '镜头润色' : '润色'}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={polish.savedOriginal === null || polish.polishing || polish.translating}
          onClick={polish.restoreOriginal}
          title="撤销润色，恢复润色前的原文"
        >
          <RotateCcw className="h-4 w-4" />
          恢复
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={!polish.result || polish.polishing || polish.translating}
          onClick={() => void polish.copyPrompt()}
          title="复制润色后的正向提示词到剪贴板"
        >
          <Copy className="h-4 w-4" />
          复制
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={polish.polishing || polish.translating}
          onClick={() => void polish.translateDraft()}
          title="按正负向提示词中英占比，自动译成另一种语言"
        >
          {polish.translating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowLeftRight className="h-4 w-4" />
          )}
          提示词翻译
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={!polish.translateUndo || polish.polishing || polish.translating}
          onClick={polish.restoreTranslate}
          title="撤销翻译，恢复翻译前的正负向原文"
        >
          <RotateCcw className="h-4 w-4" />
          恢复原文
        </button>
        {polish.result && (
          <button
            type="button"
            className="btn-ghost !px-2 text-xs"
            onClick={() => setSummaryOpen((v) => !v)}
          >
            {summaryOpen ? '收起' : '详情'}
          </button>
        )}
      </div>

      {summaryOpen && polish.result && (
        <div className="mt-3 rounded-xl border border-border/80 p-3">
          <PromptChangeSummary result={polish.result} />
        </div>
      )}
    </section>
  )
}

function pickAllowedProfile(
  current: ModelProfileId,
  options: Array<{ id: ModelProfileId; label: string }>
): ModelProfileId {
  return options.some((o) => o.id === current) ? current : options[0]!.id
}
