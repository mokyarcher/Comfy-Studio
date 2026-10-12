import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import type {
  GalleryItem,
  GenerateParams,
  GenerateProgressEvent,
  GenerateUiPhase,
  TaskStatus
} from '../shared/types'
import { fetchTaskImage, pollTask, purgeTask, submitGenerate } from './api/client'
import { galleryMediaUrl } from './galleryProtocol'
import { getProfileSecret } from './store/profiles'
import { getSettings } from './store/settings'
import { saveImageFromBuffer } from './store/gallery'

export type { GenerateProgressEvent, GenerateUiPhase }

export interface LocalRefImage {
  filename: string
  bytesBase64: string
}

export interface GenerateJobInput {
  localId?: string
  profileId: string
  params: GenerateParams
  profileName?: string
  /** Local reference images to persist with gallery (image_edit) */
  localRefs?: LocalRefImage[]
}

export interface GenerateJobResult {
  localId: string
  remoteTaskId: string
  status: 'succeeded'
  seed?: number | null
  imageDataUrl: string
  galleryItem: GalleryItem
}

interface QueueItem {
  input: GenerateJobInput
  localId: string
  resolve: (value: GenerateJobResult) => void
  reject: (reason: Error) => void
  sender: Electron.WebContents
}

const POLL_INTERVAL_MS = 2000
const MAX_CONCURRENT = 1

let activeCount = 0
const queue: QueueItem[] = []

function sendProgress(sender: Electron.WebContents, event: GenerateProgressEvent): void {
  if (sender.isDestroyed()) return
  sender.send('studio:generateProgress', event)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function runJob(item: QueueItem): Promise<void> {
  const { input, localId, sender } = item
  const started = Date.now()
  const settings = getSettings()
  const sec = getProfileSecret(input.profileId)
  if (!sec) {
    const err = new Error('未找到 API 连接配置')
    sendProgress(sender, {
      localId,
      phase: 'failed',
      error: err.message,
      elapsedMs: Date.now() - started
    })
    throw err
  }
  if (!sec.apiKey) {
    const err = new Error('API Key 缺失，请重新保存连接配置')
    sendProgress(sender, {
      localId,
      phase: 'failed',
      error: err.message,
      elapsedMs: Date.now() - started
    })
    throw err
  }

  const timeoutMs = sec.profile.timeoutMs || settings.timeoutMs || 900_000
  const pollInterval = settings.pollIntervalMs || POLL_INTERVAL_MS

  sendProgress(sender, {
    localId,
    phase: 'waiting',
    message: '正在提交任务…',
    elapsedMs: 0
  })

  try {
    const submit = await submitGenerate({
      baseUrl: sec.profile.baseUrl,
      apiKey: sec.apiKey,
      timeoutMs: Math.min(timeoutMs, 120_000),
      params: input.params
    })

    const submitMsg =
      submit.queueAhead && submit.queueAhead > 0
        ? `已入队，前方还有 ${submit.queueAhead} 个任务（全球队串行，GPU 一次只跑一个）`
        : '已入队，即将开始生成（GPU 空闲时立即执行）'

    sendProgress(sender, {
      localId,
      phase: 'submitted',
      remoteTaskId: submit.taskId,
      remoteStatus: submit.status,
      message: submitMsg,
      queueAhead: submit.queueAhead,
      queuePosition: submit.queuePosition,
      queueSize: submit.queueSize,
      elapsedMs: Date.now() - started
    })

    let lastStatus: TaskStatus = submit.status
    let seed: number | null | undefined = input.params.seed ?? null
    const deadline = Date.now() + timeoutMs

    while (true) {
      if (Date.now() > deadline) {
        throw new Error('等待任务完成超时。远端任务可能仍在运行，请勿立即重复提交。')
      }

      await sleep(pollInterval)

      const poll = await pollTask({
        baseUrl: sec.profile.baseUrl,
        apiKey: sec.apiKey,
        timeoutMs: Math.min(timeoutMs, 60_000),
        taskId: submit.taskId
      })

      lastStatus = poll.status
      if (poll.seed != null) seed = poll.seed

      const progress = poll.progress ?? null
      const queueMsg =
        poll.status === 'queued'
          ? poll.queueAhead != null && poll.queueAhead > 0
            ? `排队中，前方还有 ${poll.queueAhead} 个任务（第 ${poll.queuePosition ?? '?'} 位）`
            : '排队中，下一位就是你…'
          : poll.status === 'running'
            ? progress && progress.max > 0
              ? `正在生成… ${progress.value}/${progress.max}`
              : '正在生成…'
            : `状态：${poll.status}`

      sendProgress(sender, {
        localId,
        phase: 'polling',
        remoteTaskId: submit.taskId,
        remoteStatus: poll.status,
        seed,
        error: poll.error,
        message: queueMsg,
        queueAhead: poll.queueAhead,
        queuePosition: poll.queuePosition,
        queueSize: poll.queueSize,
        progress,
        elapsedMs: Date.now() - started
      })

      if (poll.status === 'failed') {
        throw new Error(poll.error || '远端任务失败')
      }
      if (poll.status === 'succeeded') break
    }

    const mode = input.params.mode ?? 'txt2img'
    sendProgress(sender, {
      localId,
      phase: 'downloading',
      remoteTaskId: submit.taskId,
      remoteStatus: 'succeeded',
      seed,
      message: mode === 'image_to_video' ? '正在下载视频…' : '正在下载图片…',
      elapsedMs: Date.now() - started
    })

    const media = await fetchTaskImage({
      baseUrl: sec.profile.baseUrl,
      apiKey: sec.apiKey,
      timeoutMs: Math.max(timeoutMs, 60_000),
      taskId: submit.taskId,
      index: 0
    })
    const buf = media.buffer
    const contentType =
      media.contentType ||
      (mode === 'image_to_video' ? 'video/mp4' : 'image/png')

    const refBuffers =
      (mode === 'image_edit' || mode === 'image_to_video') && input.localRefs?.length
        ? input.localRefs.map((r) => ({
            bytes: Buffer.from(r.bytesBase64, 'base64'),
            filename: r.filename
          }))
        : undefined

    const elapsedMs = Date.now() - started
    const galleryItem = saveImageFromBuffer({
      buffer: buf,
      prompt: input.params.prompt,
      negativePrompt: input.params.negative_prompt,
      width: input.params.width ?? (mode === 'image_to_video' ? 800 : 1024),
      height: input.params.height ?? (mode === 'image_to_video' ? 496 : 1024),
      steps: input.params.steps ?? 20,
      seed: seed ?? null,
      taskId: submit.taskId,
      profileId: input.profileId,
      profileName: input.profileName ?? sec.profile.name,
      mode,
      contentType,
      elapsedMs,
      refBuffers
    })

    // Privacy: after local save, ask API to wipe server/Comfy artifacts (best-effort).
    let doneMessage = '生成完成'
    try {
      const purged = await purgeTask({
        baseUrl: sec.profile.baseUrl,
        apiKey: sec.apiKey,
        timeoutMs: Math.min(timeoutMs, 60_000),
        taskId: submit.taskId
      })
      if (!purged.ok) {
        console.warn('[studio] server purge failed:', purged.message)
        doneMessage = '生成完成（服务端清理未成功，不影响本机已保存）'
      }
    } catch (purgeErr) {
      console.warn('[studio] server purge error:', purgeErr)
      doneMessage = '生成完成（服务端清理未成功，不影响本机已保存）'
    }

    // Prefer custom protocol over huge data: URLs (Chromium fails on large video base64).
    const imageDataUrl = galleryMediaUrl(galleryItem.id)
    const result: GenerateJobResult = {
      localId,
      remoteTaskId: submit.taskId,
      status: 'succeeded',
      seed: seed ?? null,
      imageDataUrl,
      galleryItem
    }

    sendProgress(sender, {
      localId,
      phase: 'done',
      remoteTaskId: submit.taskId,
      remoteStatus: lastStatus,
      seed: seed ?? null,
      imageDataUrl,
      galleryItem,
      message: doneMessage,
      elapsedMs
    })

    item.resolve(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : '生成失败'
    sendProgress(sender, {
      localId,
      phase: 'failed',
      error: message,
      message,
      elapsedMs: Date.now() - started
    })
    item.reject(err instanceof Error ? err : new Error(message))
  }
}

function pump(): void {
  while (activeCount < MAX_CONCURRENT && queue.length > 0) {
    const item = queue.shift()!
    activeCount += 1
    void runJob(item).finally(() => {
      activeCount -= 1
      pump()
    })
  }
}

/** Enqueue a generate job. Concurrent default = 1. */
export function enqueueGenerate(
  sender: Electron.WebContents,
  input: GenerateJobInput
): Promise<GenerateJobResult> {
  const localId = input.localId || randomUUID()
  return new Promise((resolve, reject) => {
    const item: QueueItem = { input: { ...input, localId }, localId, resolve, reject, sender }
    const waiting = activeCount >= MAX_CONCURRENT
    if (waiting) {
      sendProgress(sender, {
        localId,
        phase: 'waiting',
        message: '本地队列等待中（并发上限 1）…',
        elapsedMs: 0
      })
    }
    queue.push(item)
    pump()
  })
}

export function getQueueDepth(): { active: number; pending: number } {
  return { active: activeCount, pending: queue.length }
}

export function getFocusedWebContents(): Electron.WebContents | null {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  return win?.webContents ?? null
}
