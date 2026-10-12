import { useState, type MouseEvent } from 'react'
import { Languages, Loader2 } from 'lucide-react'
import { toUserErrorMessage } from '../../../shared/errors'
import { useAppStore } from '../stores/appStore'

const cache = new Map<string, string>()

function looksEnglishHeavy(text: string): boolean {
  const s = text.trim()
  if (s.length < 8) return false
  const latin = (s.match(/[A-Za-z]/g) || []).length
  const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length
  return latin >= 10 && latin > cjk * 2
}

/** Toggle display-only Chinese translation; never mutates the source prompt. */
export function PromptTranslateButton(props: {
  text: string
  className?: string
  /** Stop click from bubbling (e.g. card insert) */
  stopPropagation?: boolean
}) {
  const activeProfileId = useAppStore((s) => s.activeProfileId)
  const showToast = useAppStore((s) => s.showToast)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [zh, setZh] = useState<string | null>(() => cache.get(props.text) ?? null)

  if (!looksEnglishHeavy(props.text)) return null

  const onToggle = async (e: MouseEvent) => {
    if (props.stopPropagation) e.stopPropagation()
    e.preventDefault()
    if (open) {
      setOpen(false)
      return
    }
    if (zh) {
      setOpen(true)
      return
    }
    if (!activeProfileId) {
      showToast('error', '请先登录')
      return
    }
    setLoading(true)
    try {
      const res = (await window.studio.translatePrompt({
        profileId: activeProfileId,
        text: props.text
      })) as { translation: string }
      cache.set(props.text, res.translation)
      setZh(res.translation)
      setOpen(true)
    } catch (err) {
      showToast('error', toUserErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={props.className}>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted transition hover:bg-panel-elevated hover:text-primary"
        onClick={(e) => void onToggle(e)}
        disabled={loading}
        title="仅显示中文含义，不改动提示词原文"
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Languages className="h-3 w-3" />
        )}
        {open ? '收起译文' : '查看译文'}
      </button>
      {open && zh ? (
        <p className="mt-1.5 whitespace-pre-wrap rounded-md border border-[#1a1d27] bg-[#12141a] px-2.5 py-2 text-[12px] leading-relaxed text-[#a8b0c2]">
          {zh}
        </p>
      ) : null}
    </div>
  )
}
