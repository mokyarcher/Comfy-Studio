import { useState } from 'react'
import { Copy, Loader2, RotateCcw, Wand2 } from 'lucide-react'
import type { ModelProfileId, PolishDetail, PromptLanguage } from '../../../../../shared/prompt-polish/types'
import { usePromptPolish } from '../hooks/usePromptPolish'
import { PromptModeSwitch } from './PromptModeSwitch'
import { PromptChangeSummary } from './PromptChangeSummary'
import { PromptConflictBanner } from './PromptConflictBanner'

const MODEL_OPTIONS: Array<{ id: ModelProfileId; label: string }> = [
  { id: 'unknown', label: '通用' },
  { id: 'flux', label: 'FLUX' },
  { id: 'sdxl', label: 'SDXL' },
  { id: 'sd15', label: 'SD 1.5' },
  { id: 'sd3', label: 'SD3' }
]

export function PromptPolishPanel() {
  const polish = usePromptPolish()
  const [summaryOpen, setSummaryOpen] = useState(false)

  return (
    <section className="rounded-xl border border-border bg-panel-elevated/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Wand2 className="h-4 w-4 text-primary" />
          AI 润色
        </h2>
        <PromptModeSwitch aiSettings={polish.aiSettings} onConfigureAi={polish.goConfigureAi} />
      </div>

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
            value={polish.modelProfile}
            onChange={(e) => polish.updateModelProfile(e.target.value as ModelProfileId)}
          >
            {MODEL_OPTIONS.map((o) => (
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
          disabled={polish.polishing}
          onClick={() => void polish.polish()}
        >
          {polish.polishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          润色
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={polish.savedOriginal === null || polish.polishing}
          onClick={polish.restoreOriginal}
        >
          <RotateCcw className="h-4 w-4" />
          恢复
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={!polish.result || polish.polishing}
          onClick={() => void polish.copyPrompt()}
        >
          <Copy className="h-4 w-4" />
          复制
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
