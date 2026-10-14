import {
  fetchTaskBlob,
  pollTask,
  purgeTask,
  submitGenerate,
  uploadImage
} from './api'
import { saveFromTask } from './gallery-db'
import type { GenerateMode, GenerateParams, LocalTask } from './types'

export type GenerateCallbacks = {
  onUpdate: (task: LocalTask) => void
  pollIntervalMs: number
  timeoutMs: number
  jobTimeoutMs: number
  autoPurge: boolean
  apiKey: string
  isHidden?: () => boolean
  onBackgroundHint?: () => void
}

export async function runGenerateJob(opts: {
  localId: string
  mode: GenerateMode
  prompt: string
  negativePrompt?: string
  width: number
  height: number
  steps: number
  seed?: number | null
  length?: number
  files?: File[]
  cb: GenerateCallbacks
}): Promise<LocalTask> {
  const now = () => new Date().toISOString()
  let task: LocalTask = {
    id: opts.localId,
    status: 'submitting',
    mode: opts.mode,
    prompt: opts.prompt,
    negativePrompt: opts.negativePrompt,
    width: opts.width,
    height: opts.height,
    steps: opts.steps,
    seed: opts.seed,
    createdAt: now(),
    updatedAt: now(),
    progressMessage: '提交中…'
  }
  opts.cb.onUpdate(task)

  try {
    let images: string[] | undefined
    if (opts.files?.length) {
      task = { ...task, progressMessage: '上传参考图…', updatedAt: now() }
      opts.cb.onUpdate(task)
      images = []
      for (const file of opts.files) {
        const up = await uploadImage({
          apiKey: opts.cb.apiKey,
          timeoutMs: opts.cb.timeoutMs,
          file,
          filename: file.name || 'upload.png'
        })
        images.push(up.filename)
      }
    }

    const params: GenerateParams = {
      mode: opts.mode,
      prompt: opts.prompt,
      negative_prompt: opts.negativePrompt,
      width: opts.width,
      height: opts.height,
      steps: opts.steps,
      seed: opts.seed ?? null,
      length: opts.length,
      images
    }

    const submitted = await submitGenerate({
      apiKey: opts.cb.apiKey,
      timeoutMs: opts.cb.timeoutMs,
      params
    })

    task = {
      ...task,
      remoteTaskId: submitted.taskId,
      status: submitted.status,
      queueAhead: submitted.queueAhead,
      progressMessage: '排队中…',
      updatedAt: now()
    }
    opts.cb.onUpdate(task)

    const deadline = Date.now() + opts.cb.jobTimeoutMs
    let warnedHidden = false
    while (Date.now() < deadline) {
      if (opts.cb.isHidden?.() && !warnedHidden) {
        warnedHidden = true
        opts.cb.onBackgroundHint?.()
      }
      await sleep(opts.cb.pollIntervalMs)
      const polled = await pollTask({
        apiKey: opts.cb.apiKey,
        timeoutMs: opts.cb.timeoutMs,
        taskId: submitted.taskId
      })
      task = {
        ...task,
        status: polled.status,
        seed: polled.seed ?? task.seed,
        queueAhead: polled.queueAhead,
        progress: polled.progress,
        progressMessage:
          polled.status === 'queued'
            ? `排队中${polled.queueAhead != null ? ` · 前面 ${polled.queueAhead}` : ''}`
            : polled.status === 'running'
              ? polled.progress
                ? `生成中 ${Math.round(polled.progress.percent)}%`
                : '生成中…'
              : task.progressMessage,
        error: polled.error,
        updatedAt: now()
      }
      opts.cb.onUpdate(task)

      if (polled.status === 'failed') {
        task = { ...task, status: 'failed', error: polled.error || '生成失败', updatedAt: now() }
        opts.cb.onUpdate(task)
        return task
      }
      if (polled.status === 'succeeded') break
    }

    if (task.status !== 'succeeded') {
      task = { ...task, status: 'failed', error: '等待超时', updatedAt: now() }
      opts.cb.onUpdate(task)
      return task
    }

    task = { ...task, progressMessage: '下载结果…', updatedAt: now() }
    opts.cb.onUpdate(task)

    const media = await fetchTaskBlob({
      apiKey: opts.cb.apiKey,
      timeoutMs: Math.max(opts.cb.timeoutMs, 120_000),
      taskId: submitted.taskId
    })
    const previewUrl = URL.createObjectURL(media.blob)
    const gallery = await saveFromTask({
      taskId: submitted.taskId,
      blob: media.blob,
      mimeType: media.contentType,
      prompt: opts.prompt,
      negativePrompt: opts.negativePrompt,
      width: opts.width,
      height: opts.height,
      steps: opts.steps,
      seed: task.seed,
      mode: opts.mode
    })

    if (opts.cb.autoPurge) {
      await purgeTask({
        apiKey: opts.cb.apiKey,
        timeoutMs: opts.cb.timeoutMs,
        taskId: submitted.taskId
      })
    }

    task = {
      ...task,
      status: 'succeeded',
      previewUrl,
      galleryId: gallery.id,
      progressMessage: '完成',
      updatedAt: now()
    }
    opts.cb.onUpdate(task)
    return task
  } catch (err) {
    task = {
      ...task,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
      progressMessage: '失败',
      updatedAt: now()
    }
    opts.cb.onUpdate(task)
    return task
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
