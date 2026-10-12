import { useCallback, useEffect, useState } from 'react'
import type {
  AiPolishSettingsPublic,
  PolishDetail,
  PromptLanguage,
  PromptPolishResult,
  ModelProfileId
} from '../../../../../shared/prompt-polish/types'
import { DEFAULT_AI_POLISH_PUBLIC, DEFAULT_POLISH_PREFS } from '../../../../../shared/prompt-polish/types'
import { useAppStore } from '../../../stores/appStore'

export function usePromptPolish() {
  const settings = useAppStore((s) => s.settings)
  const showToast = useAppStore((s) => s.showToast)
  const setPage = useAppStore((s) => s.setPage)
  const setDraft = useAppStore((s) => s.setDraft)
  const draft = useAppStore((s) => s.draft)

  const prefs = settings.polishPrefs ?? DEFAULT_POLISH_PREFS
  const [outputLanguage, setOutputLanguage] = useState<PromptLanguage>(prefs.outputLanguage)
  const [detail, setDetail] = useState<PolishDetail>(prefs.detail)
  const [modelProfile, setModelProfile] = useState<ModelProfileId>(prefs.modelProfile)

  const [result, setResult] = useState<PromptPolishResult | null>(null)
  const [savedOriginal, setSavedOriginal] = useState<string | null>(null)
  const [savedOriginalNegative, setSavedOriginalNegative] = useState<string | null>(null)
  const [polishing, setPolishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiSettings, setAiSettings] = useState<AiPolishSettingsPublic>(DEFAULT_AI_POLISH_PUBLIC)
  const [conflictAck, setConflictAck] = useState(false)

  const draftClearSeq = useAppStore((s) => s.draftClearSeq)

  useEffect(() => {
    void window.studio.getAiPolishSettings().then(setAiSettings)
  }, [])

  useEffect(() => {
    if (draftClearSeq === 0) return
    setResult(null)
    setSavedOriginal(null)
    setSavedOriginalNegative(null)
    setError(null)
    setConflictAck(false)
  }, [draftClearSeq])

  const persistPrefs = useCallback(
    async (partial: {
      outputLanguage?: PromptLanguage
      detail?: PolishDetail
      modelProfile?: ModelProfileId
    }) => {
      const next = {
        mode: 'ai' as const,
        outputLanguage,
        detail,
        modelProfile,
        ...partial
      }
      const saved = await window.studio.saveSettings({ polishPrefs: next })
      useAppStore.setState({ settings: saved })
    },
    [outputLanguage, detail, modelProfile]
  )

  const updateLanguage = (l: PromptLanguage) => {
    setOutputLanguage(l)
    void persistPrefs({ outputLanguage: l })
  }
  const updateDetail = (d: PolishDetail) => {
    setDetail(d)
    void persistPrefs({ detail: d })
  }
  const updateModelProfile = (p: ModelProfileId) => {
    setModelProfile(p)
    void persistPrefs({ modelProfile: p })
  }

  const activeProfileId = useAppStore((s) => s.activeProfileId)

  const polish = useCallback(async () => {
    const prompt = draft.prompt
    const negativePrompt = draft.negativePrompt
    const trimmed = prompt.trim()
    if (!trimmed) {
      setError('请先填写正向提示词')
      showToast('error', '请先填写正向提示词')
      return
    }
    setPolishing(true)
    setError(null)
    setConflictAck(false)
    try {
      const res = await window.studio.polishAi({
        prompt,
        negativePrompt,
        outputLanguage,
        detail,
        modelProfile,
        profileId: activeProfileId || undefined
      })
      setResult(res)
      setSavedOriginal(res.originalPrompt)
      setSavedOriginalNegative(res.originalNegativePrompt ?? negativePrompt ?? '')
      setDraft({
        prompt: res.enhancedPrompt,
        negativePrompt: res.enhancedNegativePrompt ?? negativePrompt,
        showNegative:
          draft.showNegative ||
          Boolean(res.enhancedNegativePrompt && res.enhancedNegativePrompt !== negativePrompt)
      })
      showToast('success', 'AI 润色已写入上方提示词')
    } catch (err) {
      const message = err instanceof Error ? err.message : '润色失败'
      setError(message)
      showToast('error', message)
    } finally {
      setPolishing(false)
    }
  }, [
    draft.prompt,
    draft.negativePrompt,
    draft.showNegative,
    outputLanguage,
    detail,
    modelProfile,
    activeProfileId,
    showToast,
    setDraft
  ])

  const restoreOriginal = useCallback(() => {
    if (savedOriginal === null) return
    setDraft({
      prompt: savedOriginal,
      negativePrompt: savedOriginalNegative ?? draft.negativePrompt
    })
    showToast('info', '已恢复润色前的原文')
  }, [savedOriginal, savedOriginalNegative, draft.negativePrompt, setDraft, showToast])

  const copyPrompt = useCallback(async () => {
    if (!draft.prompt) return
    await navigator.clipboard.writeText(draft.prompt)
    showToast('success', '提示词已复制')
  }, [draft.prompt, showToast])

  const hasBlocking = Boolean(result?.conflicts.some((c) => c.severity === 'blocking'))
  const hasWarning = Boolean(result?.conflicts.some((c) => c.severity === 'warning'))

  const goConfigureAi = () => setPage('settings')

  return {
    outputLanguage,
    updateLanguage,
    detail,
    updateDetail,
    modelProfile,
    updateModelProfile,
    result,
    savedOriginal,
    polishing,
    error,
    aiSettings,
    conflictAck,
    setConflictAck,
    polish,
    restoreOriginal,
    copyPrompt,
    hasWarning,
    hasBlocking,
    goConfigureAi
  }
}
