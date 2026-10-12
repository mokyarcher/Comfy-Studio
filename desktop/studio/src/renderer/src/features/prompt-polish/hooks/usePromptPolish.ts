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

/** Majority script wins: more CJK → Chinese, more Latin → English. */
export function detectPromptDirection(
  ...parts: string[]
): 'en2zh' | 'zh2en' | null {
  const text = parts.join('\n')
  let latin = 0
  let cjk = 0
  for (const ch of text) {
    if (/[A-Za-z]/.test(ch)) latin += 1
    else if (/[\u4e00-\u9fff]/.test(ch)) cjk += 1
  }
  if (latin === 0 && cjk === 0) return null
  if (cjk === latin) return null
  return cjk > latin ? 'zh2en' : 'en2zh'
}

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
  const [translating, setTranslating] = useState(false)
  /** Snapshot before last draft translate (独立于润色恢复). */
  const [translateUndo, setTranslateUndo] = useState<{
    prompt: string
    negative: string
  } | null>(null)
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
    setTranslateUndo(null)
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
      const generationMode = draft.mode
      const profileForMode = generationMode === 'image_to_video' ? 'wan' : modelProfile
      const res = await window.studio.polishAi({
        prompt,
        negativePrompt,
        outputLanguage,
        detail,
        modelProfile: profileForMode,
        generationMode,
        profileId: activeProfileId || undefined
      })
      setResult(res)
      setSavedOriginal(res.originalPrompt)
      setSavedOriginalNegative(res.originalNegativePrompt ?? negativePrompt ?? '')
      const nextNegative = (res.enhancedNegativePrompt ?? '').trim() || negativePrompt
      setDraft({
        prompt: res.enhancedPrompt,
        negativePrompt: nextNegative,
        showNegative: true
      })
      showToast(
        'success',
        generationMode === 'image_to_video'
          ? '视频镜头润色已写入正向与负向提示词'
          : 'AI 润色已写入正向与负向提示词'
      )
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
    draft.mode,
    draft.showNegative,
    outputLanguage,
    detail,
    modelProfile,
    activeProfileId,
    showToast,
    setDraft
  ])

  const translateDraft = useCallback(async () => {
    const prompt = draft.prompt
    const negativePrompt = draft.negativePrompt
    if (!prompt.trim() && !negativePrompt.trim()) {
      setError('请先填写提示词')
      showToast('error', '请先填写提示词')
      return
    }
    if (!activeProfileId) {
      setError('请先登录')
      showToast('error', '请先登录')
      return
    }
    const direction = detectPromptDirection(prompt, negativePrompt)
    if (!direction) {
      setError('无法判断中英文占比，请先明确填写提示词')
      showToast('error', '无法判断中英文占比')
      return
    }
    setTranslating(true)
    setError(null)
    const snapshot = { prompt, negative: negativePrompt }
    try {
      const jobs: Array<Promise<string>> = [
        prompt.trim()
          ? window.studio
              .translatePrompt({
                profileId: activeProfileId,
                text: prompt,
                direction
              })
              .then((r: { translation: string }) => r.translation)
          : Promise.resolve(prompt),
        negativePrompt.trim()
          ? window.studio
              .translatePrompt({
                profileId: activeProfileId,
                text: negativePrompt,
                direction
              })
              .then((r: { translation: string }) => r.translation)
          : Promise.resolve(negativePrompt)
      ]
      const [nextPrompt, nextNegative] = await Promise.all(jobs)
      setDraft({
        prompt: nextPrompt,
        negativePrompt: nextNegative,
        showNegative: Boolean(nextNegative.trim()) || draft.showNegative
      })
      setTranslateUndo(snapshot)
      showToast('success', direction === 'en2zh' ? '已译为中文' : '已译为英文')
    } catch (err) {
      const message = err instanceof Error ? err.message : '翻译失败'
      setError(message)
      showToast('error', message)
    } finally {
      setTranslating(false)
    }
  }, [
    draft.prompt,
    draft.negativePrompt,
    draft.showNegative,
    activeProfileId,
    showToast,
    setDraft
  ])

  const restoreTranslate = useCallback(() => {
    if (!translateUndo) return
    setDraft({
      prompt: translateUndo.prompt,
      negativePrompt: translateUndo.negative
    })
    setTranslateUndo(null)
    showToast('info', '已恢复翻译前原文')
  }, [translateUndo, setDraft, showToast])

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
    translating,
    translateUndo,
    error,
    aiSettings,
    conflictAck,
    setConflictAck,
    polish,
    translateDraft,
    restoreTranslate,
    restoreOriginal,
    copyPrompt,
    hasWarning,
    hasBlocking,
    goConfigureAi
  }
}
