import { Languages, Loader2 } from 'lucide-react'
import { useState, type MouseEvent } from 'react'
import { translateViaGateway } from '@/lib/api'
import { useSession } from '@/store/session'
import { useToast } from '@/store/toast'

const cache = new Map<string, string>()

function looksEnglishHeavy(text: string): boolean {
  const s = text.trim()
  if (s.length < 8) return false
  const latin = (s.match(/[A-Za-z]/g) || []).length
  const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length
  return latin >= 10 && latin > cjk * 2
}

/** Display-only Chinese translation; never mutates the source prompt. */
export function PromptTranslateButton(props: {
  text: string
  className?: string
  stopPropagation?: boolean
}) {
  const apiKey = useSession((s) => s.user?.apiKey)
  const push = useToast((s) => s.push)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [zh, setZh] = useState<string | null>(() => cache.get(props.text) ?? null)

  if (!looksEnglishHeavy(props.text)) return null

  async function onToggle(e: MouseEvent) {
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
    if (!apiKey) {
      push('请先登录', 'error')
      return
    }
    setLoading(true)
    try {
      const translation = await translateViaGateway({
        apiKey,
        text: props.text,
        direction: 'en2zh'
      })
      cache.set(props.text, translation)
      setZh(translation)
      setOpen(true)
    } catch (err) {
      push(err instanceof Error ? err.message : '翻译失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={props.className}>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted transition hover:bg-white/[0.06] hover:text-text"
        onClick={(e) => void onToggle(e)}
        disabled={loading}
        title="仅显示中文含义，不改动提示词原文"
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Languages className="h-3 w-3" />}
        {open ? '收起译文' : '查看译文'}
      </button>
      {open && zh ? (
        <p className="mt-1.5 whitespace-pre-wrap rounded-lg px-2.5 py-2 text-[12px] leading-relaxed text-[#c2c8d6] [background:color-mix(in_srgb,#ffffff_6%,transparent)] [box-shadow:inset_0_0_0_0.5px_rgba(255,255,255,0.16)]">
          {zh}
        </p>
      ) : null}
    </div>
  )
}
