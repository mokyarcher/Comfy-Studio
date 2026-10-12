import { useCallback, useEffect, useRef } from 'react'
import { toUserErrorMessage } from '../../../shared/errors'
import { randomUUID } from '../lib/uuid'
import { useAppStore } from '../stores/appStore'
import type { GenerateProgressEvent, LocalTask, TaskStatus } from '../../../shared/types'

function mapPhaseToStatus(phase: GenerateProgressEvent['phase'], remote?: TaskStatus): LocalTask['status'] {
  if (phase === 'waiting') return 'waiting'
  if (phase === 'submitted') return 'submitting'
  if (phase === 'polling') return remote ?? 'queued'
  if (phase === 'downloading') return 'running'
  if (phase === 'done') return 'succeeded'
  if (phase === 'failed') return 'failed'
  return 'waiting'
}

export function useGenerate() {
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    unsubRef.current = window.studio.onGenerateProgress((ev: GenerateProgressEvent) => {
      const state = useAppStore.getState()
      const existing = state.tasks.find((t) => t.id === ev.localId)
      if (!existing) return

      const next: LocalTask = {
        ...existing,
        phase: ev.phase,
        status: mapPhaseToStatus(ev.phase, ev.remoteStatus),
        remoteTaskId: ev.remoteTaskId ?? existing.remoteTaskId,
        seed: ev.seed !== undefined ? ev.seed : existing.seed,
        error: ev.error,
        progressMessage: ev.message ?? existing.progressMessage,
        imageDataUrl: ev.imageDataUrl ?? existing.imageDataUrl,
        galleryId: ev.galleryItem?.id ?? existing.galleryId,
        updatedAt: new Date().toISOString(),
        finishedAt:
          ev.phase === 'done' || ev.phase === 'failed'
            ? new Date().toISOString()
            : existing.finishedAt
      }
      state.upsertTask(next)
    })
    return () => {
      unsubRef.current?.()
      unsubRef.current = null
    }
  }, [])

  const run = useCallback(async (override?: Partial<LocalTask>) => {
    const state = useAppStore.getState()
    if (state.busy) {
      state.showToast('info', '已有任务进行中')
      return
    }
    const profileId = override?.profileId || state.activeProfileId
    if (!profileId) {
      state.showToast('error', '请先登录')
      state.setPage('connection')
      return
    }

    const prompt = (override?.prompt !== undefined ? override.prompt : state.draft.prompt).trim()
    if (!prompt) {
      state.showToast('error', '请填写正向提示词')
      return
    }

    const mode = state.draft.mode
    if ((mode === 'image_edit' || mode === 'image_to_video') && !state.draft.editImages[0]) {
      state.showToast('error', mode === 'image_to_video' ? '请上传起始图' : '请上传底图')
      return
    }

    state.setBusy(true)

    const localId = randomUUID()
    const seed =
      override?.seed !== undefined
        ? override.seed
        : state.draft.seedMode === 'fixed'
          ? state.draft.seed
          : null
    const width = override?.width ?? state.draft.width
    const height = override?.height ?? state.draft.height
    const steps = override?.steps ?? state.draft.steps
    const negativePrompt =
      (override?.negativePrompt !== undefined
        ? override.negativePrompt
        : state.draft.negativePrompt) || undefined
    const profile = state.profiles.find((p) => p.id === profileId)

    const baseTask: LocalTask = {
      id: localId,
      status: 'waiting',
      phase: 'waiting',
      prompt,
      negativePrompt,
      width,
      height,
      steps,
      seed,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      profileId,
      profileName: profile?.name,
      progressMessage:
        mode === 'image_edit' || mode === 'image_to_video' ? '正在上传参考图…' : '正在提交任务…'
    }
    state.upsertTask(baseTask)

    try {
      let remoteImages: string[] | undefined
      if (mode === 'image_edit' || mode === 'image_to_video') {
        remoteImages = []
        for (const slot of state.draft.editImages) {
          if (!slot) break
          const uploaded = (await window.studio.uploadImage({
            profileId,
            filename: slot.name,
            bytesBase64: slot.bytesBase64,
            contentType: slot.name.toLowerCase().endsWith('.png')
              ? 'image/png'
              : 'application/octet-stream'
          })) as { filename: string }
          remoteImages.push(uploaded.filename)
          if (mode === 'image_to_video') break
        }
        if (!remoteImages.length) {
          throw new Error('图像上传失败：未得到有效文件名')
        }
      }

      const localRefs =
        mode === 'image_edit' || mode === 'image_to_video'
          ? state.draft.editImages
              .filter((s): s is NonNullable<typeof s> => Boolean(s))
              .slice(0, mode === 'image_to_video' ? 1 : undefined)
              .map((s) => ({ filename: s.name, bytesBase64: s.bytesBase64 }))
          : undefined

      const result = await window.studio.generateImage({
        localId,
        profileId,
        profileName: profile?.name,
        params: {
          mode,
          prompt,
          negative_prompt: negativePrompt,
          width,
          height,
          steps,
          seed: seed ?? undefined,
          images: remoteImages
        },
        localRefs
      })

      const done: LocalTask = {
        ...baseTask,
        ...useAppStore.getState().tasks.find((t) => t.id === localId),
        remoteTaskId: result.remoteTaskId,
        status: 'succeeded',
        phase: 'done',
        seed: result.seed ?? seed,
        imageDataUrl: result.imageDataUrl,
        galleryId: result.galleryItem?.id,
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
      useAppStore.getState().upsertTask(done)
      useAppStore.getState().showToast('success', '生成完成，已保存到作品画廊。')
    } catch (err) {
      const message = toUserErrorMessage(err)
      const failed: LocalTask = {
        ...baseTask,
        ...useAppStore.getState().tasks.find((t) => t.id === localId),
        status: 'failed',
        phase: 'failed',
        error: message,
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
      useAppStore.getState().upsertTask(failed)
      useAppStore.getState().showToast('error', message)
    } finally {
      useAppStore.getState().setBusy(false)
    }
  }, [])

  return { run }
}
