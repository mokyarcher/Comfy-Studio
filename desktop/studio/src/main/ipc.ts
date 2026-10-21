import { BrowserWindow, dialog, ipcMain, shell, app } from 'electron'
import { z } from 'zod'
import {
  authChangePassword,
  authLogin,
  authRegister,
  deleteSharedPrompt,
  fetchPromptLibrary,
  fetchShowcaseAsset,
  fetchTaskImage,
  listSharedPrompts,
  listShowcase,
  listShowcaseComments,
  addShowcaseComment,
  deleteShowcaseComment,
  pollTask,
  sharePromptTemplate,
  shareToShowcase,
  submitGenerate,
  testConnection,
  translateViaGateway,
  fetchGpuStatus,
  toggleShowcaseFavorite,
  toggleShowcaseLike,
  unlistShowcase,
  ShowcaseNotFoundError,
  uploadImage
} from './api/client'
import { enqueueGenerate } from './generateQueue'
import {
  deleteGalleryItem,
  exportImage,
  getGalleryItem,
  listGallery,
  openGalleryFile,
  openInFolder,
  readGalleryFileBuffer,
  readGalleryRefBuffers,
  readImageAsDataUrl,
  saveImageFromBuffer,
  setGalleryShowcaseId,
  toggleFavorite,
  clearGallery
} from './store/gallery'
import {
  getCachedFullBuffer,
  getCachedFullDataUrl,
  getCachedThumbDataUrl,
  parseShowcaseAssetPath,
  putCachedFull,
  putCachedThumb,
  upsertShowcaseMeta
} from './store/showcaseCache'
import {
  clearAllProfiles,
  deleteProfile,
  getProfileSecret,
  listProfiles,
  saveProfile,
  setDefaultProfile,
  updateProfileTestResult
} from './store/profiles'
import {
  mapServerLibrary,
  readOfficialPrompts,
  writeOfficialPrompts
} from './store/officialPrompts'
import { deletePhrase, deleteTemplate, listPrompts, savePhrase, saveTemplate } from './store/prompts'
import {
  clearTaskHistory,
  listTaskHistory,
  saveTaskHistory
} from './store/taskHistory'
import { getGalleryMediaInfo } from './galleryProtocol'
import { getSettings, saveSettings } from './store/settings'
import { GenerateParamsSchema, normalizeShowcaseItem, type LocalTask } from '../shared/types'
import { isEncryptionAvailable } from './store/crypto'
import { galleryDir, getUserDataRoot } from './store/paths'
import {
  getAiPolishSettingsPublic,
  saveAiPolishSettings,
  updateAiPolishTestResult
} from './promptPolish/aiSettings'
import { polishPromptWithAi, testAiPolishConnection, AiPolishError } from './promptPolish/ai-prompt-polisher'

const ProfileInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  username: z.string().optional(),
  healthPath: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  setDefault: z.boolean().optional()
})

const AuthBodySchema = z.object({
  baseUrl: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
  displayName: z.string().optional()
})

function assertSender(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) throw new Error('非法调用方')
  return win
}

function windowFromEvent(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  return assertSender(event)
}

export function registerIpc(): void {
  ipcMain.handle('studio:authRegister', async (event, raw) => {
    assertSender(event)
    const body = AuthBodySchema.parse(raw)
    return authRegister({
      baseUrl: body.baseUrl.replace(/\/+$/, ''),
      username: body.username,
      password: body.password,
      displayName: body.displayName
    })
  })

  ipcMain.handle('studio:authLogin', async (event, raw) => {
    assertSender(event)
    const body = AuthBodySchema.parse(raw)
    const baseUrl = body.baseUrl.replace(/\/+$/, '')
    const result = await authLogin({
      baseUrl,
      username: body.username,
      password: body.password
    })
    if (!result.ok || !result.apiKey) return result
    const profile = saveProfile({
      name: result.username || body.username,
      baseUrl,
      apiKey: result.apiKey,
      username: result.username || body.username,
      healthPath: '/health/ready',
      timeoutMs: 900_000,
      setDefault: true
    })
    return { ...result, profile }
  })

  ipcMain.handle('studio:logout', (event) => {
    assertSender(event)
    clearAllProfiles()
    return { ok: true }
  })

  ipcMain.handle('studio:changePassword', async (event, raw) => {
    assertSender(event)
    const body = z
      .object({
        oldPassword: z.string().min(1),
        newPassword: z.string().min(6)
      })
      .parse(raw)
    const profiles = listProfiles().profiles
    const active = profiles.find((p) => p.isDefault) ?? profiles[0]
    if (!active) return { ok: false, message: '未登录' }
    const sec = getProfileSecret(active.id)
    if (!sec?.apiKey) return { ok: false, message: '会话无效，请重新登录' }
    return authChangePassword({
      baseUrl: sec.profile.baseUrl,
      apiKey: sec.apiKey,
      oldPassword: body.oldPassword,
      newPassword: body.newPassword
    })
  })

  // --- Profiles ---
  ipcMain.handle('studio:getProfiles', (event) => {
    assertSender(event)
    return listProfiles()
  })
  ipcMain.handle('profiles:list', (event) => {
    assertSender(event)
    return listProfiles()
  })

  ipcMain.handle('studio:saveProfile', (event, raw) => {
    assertSender(event)
    return saveProfile(ProfileInputSchema.parse(raw))
  })
  ipcMain.handle('profiles:save', (event, raw) => {
    assertSender(event)
    return saveProfile(ProfileInputSchema.parse(raw))
  })

  ipcMain.handle('studio:deleteProfile', (event, id: string) => {
    assertSender(event)
    z.string().min(1).parse(id)
    deleteProfile(id)
    return { ok: true }
  })
  ipcMain.handle('profiles:delete', (event, id: string) => {
    assertSender(event)
    z.string().min(1).parse(id)
    deleteProfile(id)
    return { ok: true }
  })

  ipcMain.handle('studio:setActiveProfile', (event, id: string) => {
    assertSender(event)
    return setDefaultProfile(z.string().min(1).parse(id))
  })
  ipcMain.handle('profiles:setDefault', (event, id: string) => {
    assertSender(event)
    return setDefaultProfile(z.string().min(1).parse(id))
  })

  ipcMain.handle('studio:testConnection', async (event, raw) => {
    assertSender(event)
    return handleTestConnection(raw)
  })
  ipcMain.handle('profiles:testConnection', async (event, raw) => {
    assertSender(event)
    return handleTestConnection(raw)
  })
  ipcMain.handle('studio:getGpuStatus', async (event, raw) => {
    assertSender(event)
    return handleGetGpuStatus(raw)
  })

  // --- Generate (main-process orchestration preferred) ---
  ipcMain.handle('studio:generateImage', async (event, raw) => {
    assertSender(event)
    const schema = z.object({
      localId: z.string().optional(),
      profileId: z.string().min(1),
      params: GenerateParamsSchema,
      profileName: z.string().optional(),
      localRefs: z
        .array(
          z.object({
            filename: z.string().min(1),
            bytesBase64: z.string().min(1)
          })
        )
        .max(10)
        .optional()
    })
    const input = schema.parse(raw)
    return enqueueGenerate(event.sender, input)
  })

  ipcMain.handle('studio:uploadImage', async (event, raw) => {
    assertSender(event)
    const schema = z.object({
      profileId: z.string().min(1),
      filename: z.string().min(1),
      bytesBase64: z.string().min(1),
      contentType: z.string().optional()
    })
    const input = schema.parse(raw)
    const sec = getProfileSecret(input.profileId)
    if (!sec) throw new Error('未找到 API 连接配置')
    if (!sec.apiKey) throw new Error('API Key 缺失，请重新保存连接配置')
    const bytes = Buffer.from(input.bytesBase64, 'base64')
    return uploadImage({
      baseUrl: sec.profile.baseUrl,
      apiKey: sec.apiKey,
      timeoutMs: Math.min(sec.profile.timeoutMs || 60_000, 120_000),
      filename: input.filename,
      bytes: new Uint8Array(bytes),
      contentType: input.contentType
    })
  })

  // Low-level helpers (kept for debugging / advanced use)
  ipcMain.handle('api:generate', async (event, raw) => {
    assertSender(event)
    const schema = z.object({
      profileId: z.string().min(1),
      params: GenerateParamsSchema
    })
    const { profileId, params } = schema.parse(raw)
    const sec = getProfileSecret(profileId)
    if (!sec) throw new Error('未找到 API 连接配置')
    if (!sec.apiKey) throw new Error('API Key 缺失，请重新保存连接配置')
    return submitGenerate({
      baseUrl: sec.profile.baseUrl,
      apiKey: sec.apiKey,
      timeoutMs: sec.profile.timeoutMs,
      params
    })
  })

  ipcMain.handle('api:pollTask', async (event, raw) => {
    assertSender(event)
    const schema = z.object({
      profileId: z.string().min(1),
      taskId: z.string().min(1)
    })
    const { profileId, taskId } = schema.parse(raw)
    const sec = getProfileSecret(profileId)
    if (!sec) throw new Error('未找到 API 连接配置')
    return pollTask({
      baseUrl: sec.profile.baseUrl,
      apiKey: sec.apiKey,
      timeoutMs: sec.profile.timeoutMs,
      taskId
    })
  })

  ipcMain.handle('api:fetchImage', async (event, raw) => {
    assertSender(event)
    const schema = z.object({
      profileId: z.string().min(1),
      taskId: z.string().min(1),
      index: z.number().int().nonnegative().optional(),
      save: z
        .object({
          prompt: z.string(),
          negativePrompt: z.string().optional(),
          width: z.number().int(),
          height: z.number().int(),
          steps: z.number().int(),
          seed: z.number().nullable().optional(),
          profileName: z.string().optional()
        })
        .optional()
    })
    const input = schema.parse(raw)
    const sec = getProfileSecret(input.profileId)
    if (!sec) throw new Error('未找到 API 连接配置')
    const media = await fetchTaskImage({
      baseUrl: sec.profile.baseUrl,
      apiKey: sec.apiKey,
      timeoutMs: Math.max(sec.profile.timeoutMs, 60_000),
      taskId: input.taskId,
      index: input.index
    })
    const buf = media.buffer
    const contentType = media.contentType || 'image/png'

    let galleryItem = null
    if (input.save) {
      galleryItem = saveImageFromBuffer({
        buffer: buf,
        prompt: input.save.prompt,
        negativePrompt: input.save.negativePrompt,
        width: input.save.width,
        height: input.save.height,
        steps: input.save.steps,
        seed: input.save.seed,
        taskId: input.taskId,
        profileId: input.profileId,
        profileName: input.save.profileName ?? sec.profile.name,
        contentType
      })
    }

    return {
      dataUrl: `data:${contentType};base64,${buf.toString('base64')}`,
      galleryItem
    }
  })

  // --- Gallery ---
  ipcMain.handle('studio:getGallery', (event) => {
    assertSender(event)
    return listGallery()
  })
  ipcMain.handle('gallery:list', (event) => {
    assertSender(event)
    return listGallery()
  })

  ipcMain.handle('studio:deleteGalleryItem', (event, id: string) => {
    assertSender(event)
    deleteGalleryItem(id)
    return { ok: true }
  })
  ipcMain.handle('gallery:delete', (event, id: string) => {
    assertSender(event)
    deleteGalleryItem(id)
    return { ok: true }
  })

  ipcMain.handle('gallery:toggleFavorite', (event, raw) => {
    assertSender(event)
    const { id, favorite } = z.object({ id: z.string(), favorite: z.boolean() }).parse(raw)
    return toggleFavorite(id, favorite)
  })

  ipcMain.handle('studio:exportImage', async (event, id: string) => {
    const win = windowFromEvent(event)
    const result = await dialog.showSaveDialog(win, {
      title: '导出图片',
      defaultPath: `comfy-studio-${id.slice(0, 8)}.png`,
      filters: [{ name: 'PNG', extensions: ['png'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    exportImage(id, result.filePath)
    return { ok: true, path: result.filePath }
  })
  ipcMain.handle('gallery:export', async (event, id: string) => {
    const win = windowFromEvent(event)
    const result = await dialog.showSaveDialog(win, {
      title: '导出图片',
      defaultPath: `comfy-studio-${id.slice(0, 8)}.png`,
      filters: [{ name: 'PNG', extensions: ['png'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    exportImage(id, result.filePath)
    return { ok: true, path: result.filePath }
  })

  ipcMain.handle('studio:openInFolder', (event, id: string) => {
    assertSender(event)
    openInFolder(id)
    return { ok: true }
  })
  ipcMain.handle('gallery:openInFolder', (event, id: string) => {
    assertSender(event)
    openInFolder(id)
    return { ok: true }
  })
  ipcMain.handle('gallery:openFile', async (event, id: string) => {
    assertSender(event)
    return openGalleryFile(id)
  })

  ipcMain.handle('gallery:readDataUrl', (event, id: string) => {
    assertSender(event)
    return readImageAsDataUrl(id)
  })
  ipcMain.handle('gallery:getMediaUrl', (event, id: string) => {
    assertSender(event)
    return getGalleryMediaInfo(id)
  })

  ipcMain.handle('gallery:saveFromDataUrl', (event, raw) => {
    assertSender(event)
    const schema = z.object({
      dataUrl: z.string().regex(/^data:(image|video)\//),
      prompt: z.string(),
      negativePrompt: z.string().optional(),
      width: z.number().int(),
      height: z.number().int(),
      steps: z.number().int(),
      seed: z.number().nullable().optional(),
      taskId: z.string(),
      profileId: z.string().optional(),
      profileName: z.string().optional(),
      mode: z.enum(['txt2img', 'image_edit', 'image_to_video']).optional()
    })
    const input = schema.parse(raw)
    const header = input.dataUrl.slice(0, input.dataUrl.indexOf(','))
    const b64 = input.dataUrl.split(',')[1]
    if (!b64) throw new Error('无效的媒体数据')
    const buf = Buffer.from(b64, 'base64')
    const contentType = header.replace(/^data:/, '').split(';')[0] || 'image/png'
    return saveImageFromBuffer({
      buffer: buf,
      prompt: input.prompt,
      negativePrompt: input.negativePrompt,
      width: input.width,
      height: input.height,
      steps: input.steps,
      seed: input.seed,
      taskId: input.taskId,
      profileId: input.profileId,
      profileName: input.profileName,
      mode: input.mode || (contentType.startsWith('video/') ? 'image_to_video' : 'txt2img'),
      contentType
    })
  })

  ipcMain.handle('studio:clearGallery', (event) => {
    assertSender(event)
    clearGallery()
    return { ok: true }
  })

  // --- Showcase (作品展馆) ---
  function requireProfileSecret(profileId: string) {
    const sec = getProfileSecret(profileId)
    if (!sec) throw new Error('未找到 API 连接配置')
    if (!sec.apiKey) throw new Error('API Key 缺失，请重新保存连接配置')
    return sec
  }

  ipcMain.handle('studio:listShowcase', async (event, raw) => {
    assertSender(event)
    const { profileId, limit, offset } = z
      .object({
        profileId: z.string().min(1),
        limit: z.number().int().positive().optional(),
        offset: z.number().int().nonnegative().optional()
      })
      .parse(raw ?? {})
    const sec = requireProfileSecret(profileId)
    const result = await listShowcase({
      baseUrl: sec.profile.baseUrl,
      apiKey: sec.apiKey,
      timeoutMs: sec.profile.timeoutMs,
      limit,
      offset
    })
    const items = result.items.map((item) => normalizeShowcaseItem(item))
    for (const item of items) {
      upsertShowcaseMeta(item)
    }
    return { items, count: result.count }
  })

  ipcMain.handle('studio:shareGalleryToShowcase', async (event, raw) => {
    assertSender(event)
    const { profileId, galleryId } = z
      .object({
        profileId: z.string().min(1),
        galleryId: z.string().min(1)
      })
      .parse(raw)
    const item = getGalleryItem(galleryId)
    if (!item) throw new Error('本地作品不存在')
    const file = readGalleryFileBuffer(galleryId)
    if (!file) throw new Error('本地图片文件不存在')
    const sec = requireProfileSecret(profileId)
    const refs = readGalleryRefBuffers(galleryId)
    const shared = await shareToShowcase({
      baseUrl: sec.profile.baseUrl,
      apiKey: sec.apiKey,
      timeoutMs: sec.profile.timeoutMs,
      prompt: item.prompt,
      negativePrompt: item.negativePrompt,
      mode: item.mode || 'txt2img',
      width: item.width,
      height: item.height,
      steps: item.steps,
      seed: item.seed,
      elapsedMs: item.elapsedMs,
      image: file,
      refs
    })
    setGalleryShowcaseId(galleryId, shared.id)
    return { item: shared, galleryItem: getGalleryItem(galleryId) }
  })

  ipcMain.handle('studio:unlistShowcase', async (event, raw) => {
    assertSender(event)
    const { profileId, showcaseId, galleryId } = z
      .object({
        profileId: z.string().min(1),
        showcaseId: z.string().min(1),
        galleryId: z.string().optional()
      })
      .parse(raw)
    const sec = requireProfileSecret(profileId)
    let unlisted: Awaited<ReturnType<typeof unlistShowcase>> | null = null
    let alreadyGone = false
    try {
      unlisted = await unlistShowcase({
        baseUrl: sec.profile.baseUrl,
        apiKey: sec.apiKey,
        timeoutMs: sec.profile.timeoutMs,
        itemId: showcaseId
      })
    } catch (err) {
      // Stale local showcaseId: server already has no record — still clear local flag.
      if (err instanceof ShowcaseNotFoundError) {
        alreadyGone = true
      } else {
        throw err
      }
    }
    if (galleryId) {
      setGalleryShowcaseId(galleryId, null)
    } else {
      for (const g of listGallery()) {
        if (g.showcaseId === showcaseId) setGalleryShowcaseId(g.id, null)
      }
    }
    return {
      item: unlisted,
      galleryItem: galleryId ? getGalleryItem(galleryId) : null,
      alreadyGone
    }
  })

  ipcMain.handle('studio:toggleShowcaseLike', async (event, raw) => {
    assertSender(event)
    const { profileId, showcaseId } = z
      .object({
        profileId: z.string().min(1),
        showcaseId: z.string().min(1)
      })
      .parse(raw)
    const sec = requireProfileSecret(profileId)
    return toggleShowcaseLike({
      baseUrl: sec.profile.baseUrl,
      apiKey: sec.apiKey,
      timeoutMs: sec.profile.timeoutMs,
      itemId: showcaseId
    })
  })

  ipcMain.handle('studio:toggleShowcaseFavorite', async (event, raw) => {
    assertSender(event)
    const { profileId, showcaseId } = z
      .object({
        profileId: z.string().min(1),
        showcaseId: z.string().min(1)
      })
      .parse(raw)
    const sec = requireProfileSecret(profileId)
    return toggleShowcaseFavorite({
      baseUrl: sec.profile.baseUrl,
      apiKey: sec.apiKey,
      timeoutMs: sec.profile.timeoutMs,
      itemId: showcaseId
    })
  })

  ipcMain.handle('studio:listShowcaseComments', async (event, raw) => {
    assertSender(event)
    const { profileId, showcaseId, limit } = z
      .object({
        profileId: z.string().min(1),
        showcaseId: z.string().min(1),
        limit: z.number().int().positive().optional()
      })
      .parse(raw ?? {})
    const sec = requireProfileSecret(profileId)
    return listShowcaseComments({
      baseUrl: sec.profile.baseUrl,
      apiKey: sec.apiKey,
      timeoutMs: sec.profile.timeoutMs,
      itemId: showcaseId,
      limit
    })
  })

  ipcMain.handle('studio:addShowcaseComment', async (event, raw) => {
    assertSender(event)
    const { profileId, showcaseId, body } = z
      .object({
        profileId: z.string().min(1),
        showcaseId: z.string().min(1),
        body: z.string().trim().min(1).max(500)
      })
      .parse(raw)
    const sec = requireProfileSecret(profileId)
    return addShowcaseComment({
      baseUrl: sec.profile.baseUrl,
      apiKey: sec.apiKey,
      timeoutMs: sec.profile.timeoutMs,
      itemId: showcaseId,
      body
    })
  })

  ipcMain.handle('studio:deleteShowcaseComment', async (event, raw) => {
    assertSender(event)
    const { profileId, showcaseId, commentId } = z
      .object({
        profileId: z.string().min(1),
        showcaseId: z.string().min(1),
        commentId: z.string().min(1)
      })
      .parse(raw)
    const sec = requireProfileSecret(profileId)
    await deleteShowcaseComment({
      baseUrl: sec.profile.baseUrl,
      apiKey: sec.apiKey,
      timeoutMs: sec.profile.timeoutMs,
      itemId: showcaseId,
      commentId
    })
    return { ok: true }
  })

  ipcMain.handle('studio:fetchShowcaseAsset', async (event, raw) => {
    assertSender(event)
    const { profileId, path } = z
      .object({
        profileId: z.string().min(1),
        path: z.string().min(1)
      })
      .parse(raw)
    const parsed = parseShowcaseAssetPath(path)
    if (parsed?.kind === 'thumb') {
      const hit = getCachedThumbDataUrl(parsed.id)
      if (hit) return hit
    }
    if (parsed?.kind === 'image') {
      const hit = getCachedFullDataUrl(parsed.id)
      if (hit) return hit
    }

    const sec = requireProfileSecret(profileId)
    const buf = await fetchShowcaseAsset({
      baseUrl: sec.profile.baseUrl,
      apiKey: sec.apiKey,
      timeoutMs: Math.max(sec.profile.timeoutMs, 60_000),
      path
    })

    if (parsed?.kind === 'thumb') {
      putCachedThumb(parsed.id, buf)
      return `data:image/jpeg;base64,${buf.toString('base64')}`
    }
    if (parsed?.kind === 'image') {
      const sniffExt =
        buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50
          ? '.png'
          : buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8
            ? '.jpg'
            : buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF'
              ? '.webp'
              : '.png'
      putCachedFull(parsed.id, buf, sniffExt)
      const mime =
        sniffExt === '.jpg' ? 'image/jpeg' : sniffExt === '.webp' ? 'image/webp' : 'image/png'
      return `data:${mime};base64,${buf.toString('base64')}`
    }

    const lower = path.toLowerCase()
    const mime =
      lower.includes('thumb') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')
        ? 'image/jpeg'
        : lower.endsWith('.webp')
          ? 'image/webp'
          : 'image/png'
    return `data:${mime};base64,${buf.toString('base64')}`
  })

  ipcMain.handle('studio:downloadShowcaseImage', async (event, raw) => {
    assertSender(event)
    const { profileId, path, suggestedName, showcaseId } = z
      .object({
        profileId: z.string().min(1),
        path: z.string().min(1),
        suggestedName: z.string().optional(),
        showcaseId: z.string().optional()
      })
      .parse(raw)
    const parsed = parseShowcaseAssetPath(path)
    const id = showcaseId || parsed?.id
    let buf: Buffer | null = null
    let filename = suggestedName || `showcase-${Date.now()}.png`
    if (id) {
      const cached = getCachedFullBuffer(id)
      if (cached) {
        buf = cached.buffer
        filename = suggestedName || cached.filename
      }
    }
    if (!buf) {
      const sec = requireProfileSecret(profileId)
      buf = await fetchShowcaseAsset({
        baseUrl: sec.profile.baseUrl,
        apiKey: sec.apiKey,
        timeoutMs: Math.max(sec.profile.timeoutMs, 60_000),
        path
      })
      if (id) {
        const sniffExt =
          buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 ? '.png' : '.png'
        putCachedFull(id, buf, sniffExt)
      }
    }
    const win = windowFromEvent(event)
    const result = await dialog.showSaveDialog(win, {
      title: '下载展馆图片',
      defaultPath: filename,
      filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    const { writeFileSync } = await import('fs')
    writeFileSync(result.filePath, buf)
    return { ok: true, path: result.filePath }
  })

  // --- Settings ---
  ipcMain.handle('studio:getSettings', (event) => {
    assertSender(event)
    return {
      settings: getSettings(),
      encryptionAvailable: isEncryptionAvailable(),
      version: app.getVersion(),
      appName: 'Comfy Studio',
      appId: 'com.sharex.comfy.studio',
      galleryPath: galleryDir(),
      userDataPath: getUserDataRoot()
    }
  })
  ipcMain.handle('settings:get', (event) => {
    assertSender(event)
    return {
      settings: getSettings(),
      encryptionAvailable: isEncryptionAvailable(),
      version: app.getVersion(),
      appName: 'Comfy Studio',
      appId: 'com.sharex.comfy.studio',
      galleryPath: galleryDir(),
      userDataPath: getUserDataRoot()
    }
  })

  ipcMain.handle('studio:saveSettings', (event, raw) => {
    assertSender(event)
    return saveSettings(raw)
  })
  ipcMain.handle('settings:save', (event, raw) => {
    assertSender(event)
    return saveSettings(raw)
  })

  ipcMain.handle('studio:openGalleryFolder', (event) => {
    assertSender(event)
    shell.openPath(galleryDir())
    return { ok: true }
  })

  // --- Task history ---
  ipcMain.handle('tasks:listHistory', (event) => {
    assertSender(event)
    return listTaskHistory()
  })
  ipcMain.handle('tasks:saveHistory', (event, raw) => {
    assertSender(event)
    const items = Array.isArray(raw) ? (raw as LocalTask[]) : []
    return saveTaskHistory(items)
  })
  ipcMain.handle('tasks:clearHistory', (event) => {
    assertSender(event)
    clearTaskHistory()
    return { ok: true }
  })

  // --- Prompts ---
  ipcMain.handle('prompts:list', (event) => {
    assertSender(event)
    return listPrompts()
  })
  ipcMain.handle('prompts:saveTemplate', (event, raw) => {
    assertSender(event)
    return saveTemplate(raw)
  })
  ipcMain.handle('prompts:deleteTemplate', (event, id: string) => {
    assertSender(event)
    deleteTemplate(id)
    return { ok: true }
  })
  ipcMain.handle('prompts:savePhrase', (event, raw) => {
    assertSender(event)
    return savePhrase(raw)
  })
  ipcMain.handle('prompts:deletePhrase', (event, id: string) => {
    assertSender(event)
    deletePhrase(id)
    return { ok: true }
  })

  ipcMain.handle('prompts:listOfficial', (event) => {
    assertSender(event)
    return readOfficialPrompts()
  })

  ipcMain.handle('prompts:refreshOfficial', async (event, raw) => {
    assertSender(event)
    const schema = z.object({ profileId: z.string().min(1) })
    const input = schema.parse(raw ?? {})
    const sec = getProfileSecret(input.profileId)
    if (!sec?.apiKey) throw new Error('请先登录并配置 API 连接')
    const remote = await fetchPromptLibrary({
      baseUrl: sec.profile.baseUrl,
      apiKey: sec.apiKey,
      timeoutMs: Math.max(sec.profile.timeoutMs || 60_000, 30_000)
    })
    return writeOfficialPrompts(mapServerLibrary(remote))
  })

  ipcMain.handle('prompts:checkOfficialUpdate', async (event, raw) => {
    assertSender(event)
    const { profileId } = z.object({ profileId: z.string().min(1) }).parse(raw ?? {})
    const sec = requireProfileSecret(profileId)
    const remote = await fetchPromptLibrary({
      baseUrl: sec.profile.baseUrl,
      apiKey: sec.apiKey,
      timeoutMs: Math.max(sec.profile.timeoutMs || 60_000, 30_000)
    })
    const local = readOfficialPrompts()
    const remoteUpdatedAt = String(remote.updated_at || '')
    const localUpdatedAt = local?.updatedAt || ''
    const remoteVersion = Number(remote.version) || 0
    const localVersion = local?.version ?? 0
    const hasUpdate =
      !local ||
      remoteVersion > localVersion ||
      (remoteUpdatedAt !== '' &&
        localUpdatedAt !== '' &&
        remoteUpdatedAt > localUpdatedAt)
    return {
      hasUpdate,
      remoteVersion,
      remoteUpdatedAt,
      localVersion,
      localUpdatedAt
    }
  })

  ipcMain.handle('prompts:listShared', async (event, raw) => {
    assertSender(event)
    const { profileId } = z.object({ profileId: z.string().min(1) }).parse(raw ?? {})
    const sec = requireProfileSecret(profileId)
    const remote = await listSharedPrompts({
      baseUrl: sec.profile.baseUrl,
      apiKey: sec.apiKey,
      timeoutMs: Math.max(sec.profile.timeoutMs || 60_000, 30_000),
      limit: 100
    })
    return {
      count: remote.count,
      items: remote.items.map((i) => ({
        id: i.id,
        title: i.title,
        prompt: i.prompt,
        negativePrompt: i.negative_prompt ?? '',
        tags: i.tags || [],
        authorName: i.author_name,
        authorUsername: i.author_username,
        createdAt: i.created_at,
        mine: Boolean(i.mine)
      }))
    }
  })

  ipcMain.handle('prompts:shareToShared', async (event, raw) => {
    assertSender(event)
    const input = z
      .object({
        profileId: z.string().min(1),
        title: z.string().min(1),
        prompt: z.string().min(1),
        negativePrompt: z.string().optional(),
        tags: z.array(z.string()).optional()
      })
      .parse(raw)
    const sec = requireProfileSecret(input.profileId)
    const shared = await sharePromptTemplate({
      baseUrl: sec.profile.baseUrl,
      apiKey: sec.apiKey,
      timeoutMs: Math.max(sec.profile.timeoutMs || 60_000, 30_000),
      title: input.title,
      prompt: input.prompt,
      negativePrompt: input.negativePrompt,
      tags: input.tags
    })
    return {
      id: shared.id,
      title: shared.title,
      prompt: shared.prompt,
      negativePrompt: shared.negative_prompt ?? '',
      tags: shared.tags || [],
      authorName: shared.author_name,
      authorUsername: shared.author_username,
      createdAt: shared.created_at,
      mine: Boolean(shared.mine)
    }
  })

  ipcMain.handle('prompts:deleteShared', async (event, raw) => {
    assertSender(event)
    const input = z
      .object({
        profileId: z.string().min(1),
        itemId: z.string().min(1)
      })
      .parse(raw)
    const sec = requireProfileSecret(input.profileId)
    await deleteSharedPrompt({
      baseUrl: sec.profile.baseUrl,
      apiKey: sec.apiKey,
      timeoutMs: Math.max(sec.profile.timeoutMs || 60_000, 30_000),
      itemId: input.itemId
    })
    return { ok: true }
  })

  // --- Prompt polish (AI / gateway only) ---
  ipcMain.handle('polish:ai', async (event, raw) => {
    assertSender(event)
    const schema = z.object({
      prompt: z.string(),
      negativePrompt: z.string().optional(),
      outputLanguage: z.enum(['match_input', 'zh', 'en']).default('match_input'),
      detail: z.enum(['concise', 'standard', 'detailed']).default('standard'),
      modelProfile: z
        .enum(['sd15', 'sdxl', 'flux', 'sd3', 'wan', 'unknown'])
        .default('unknown'),
      generationMode: z
        .enum(['txt2img', 'image_edit', 'image_to_video'])
        .default('txt2img'),
      profileId: z.string().optional()
    })
    const input = schema.parse(raw)
    try {
      return await polishPromptWithAi(
        {
          prompt: input.prompt,
          negativePrompt: input.negativePrompt,
          mode: 'ai',
          outputLanguage: input.outputLanguage,
          detail: input.detail,
          modelProfile: input.modelProfile,
          generationMode: input.generationMode
        },
        input.profileId
      )
    } catch (err) {
      if (err instanceof AiPolishError) {
        throw new Error(err.message)
      }
      throw err
    }
  })

  ipcMain.handle('polish:translate', async (event, raw) => {
    assertSender(event)
    const input = z
      .object({
        profileId: z.string().min(1),
        text: z.string().min(1),
        direction: z.enum(['en2zh', 'zh2en']).optional()
      })
      .parse(raw)
    const sec = requireProfileSecret(input.profileId)
    return translateViaGateway({
      baseUrl: sec.profile.baseUrl,
      apiKey: sec.apiKey,
      timeoutMs: Math.max(sec.profile.timeoutMs || 60_000, 60_000),
      text: input.text,
      direction: input.direction
    })
  })

  ipcMain.handle('polish:getAiSettings', (event) => {
    assertSender(event)
    return getAiPolishSettingsPublic()
  })

  ipcMain.handle('polish:saveAiSettings', (event, raw) => {
    assertSender(event)
    const schema = z.object({
      useGateway: z.boolean().optional(),
      allowDirect: z.boolean().optional(),
      enabled: z.boolean().optional(),
      baseUrl: z.string().optional(),
      model: z.string().optional(),
      timeoutMs: z.number().int().positive().optional(),
      apiKey: z.string().optional()
    })
    return saveAiPolishSettings(schema.parse(raw))
  })

  ipcMain.handle('polish:testAi', async (event, raw) => {
    assertSender(event)
    const profileId =
      raw && typeof raw === 'object' && 'profileId' in raw
        ? String((raw as { profileId?: string }).profileId || '')
        : undefined
    const result = await testAiPolishConnection(profileId || undefined)
    updateAiPolishTestResult(result.ok, result.message)
    return result
  })

  // --- Window controls ---
  ipcMain.handle('studio:windowMinimize', (event) => {
    windowFromEvent(event).minimize()
    return { ok: true }
  })
  ipcMain.handle('studio:windowMaximize', (event) => {
    const win = windowFromEvent(event)
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return { ok: true, maximized: win.isMaximized() }
  })
  ipcMain.handle('studio:windowClose', (event) => {
    windowFromEvent(event).close()
    return { ok: true }
  })
  ipcMain.handle('studio:windowIsMaximized', (event) => {
    return { maximized: windowFromEvent(event).isMaximized() }
  })
}

async function handleTestConnection(raw: unknown) {
  const schema = z.object({
    profileId: z.string().optional(),
    baseUrl: z.string().url().optional(),
    healthPath: z.string().optional(),
    timeoutMs: z.number().int().positive().optional(),
    apiKey: z.string().optional()
  })
  const input = schema.parse(raw)

  let baseUrl = input.baseUrl
  let healthPath = input.healthPath || '/health/ready'
  let timeoutMs = input.timeoutMs || 15_000
  let apiKey = input.apiKey

  if (input.profileId) {
    const sec = getProfileSecret(input.profileId)
    if (!sec) throw new Error('配置不存在')
    baseUrl = baseUrl || sec.profile.baseUrl
    healthPath = healthPath || sec.profile.healthPath
    timeoutMs = timeoutMs || sec.profile.timeoutMs
    apiKey = apiKey || sec.apiKey
  }
  if (!baseUrl) throw new Error('缺少 Base URL')

  const result = await testConnection({ baseUrl, healthPath, timeoutMs, apiKey })
  if (input.profileId) {
    updateProfileTestResult(input.profileId, {
      ok: result.ok,
      latencyMs: result.latencyMs,
      message: result.message
    })
  }
  return result
}

async function handleGetGpuStatus(raw: unknown) {
  const schema = z.object({
    profileId: z.string().optional(),
    timeoutMs: z.number().int().positive().optional()
  })
  const input = schema.parse(raw ?? {})
  const profileId = input.profileId
  if (!profileId) {
    return {
      ok: false,
      state: null,
      queueRunning: 0,
      queueQueued: 0,
      localHold: false,
      message: '请先登录'
    }
  }
  const sec = getProfileSecret(profileId)
  if (!sec) {
    return {
      ok: false,
      state: null,
      queueRunning: 0,
      queueQueued: 0,
      localHold: false,
      message: '配置不存在'
    }
  }
  return fetchGpuStatus({
    baseUrl: sec.profile.baseUrl,
    apiKey: sec.apiKey,
    timeoutMs: input.timeoutMs || sec.profile.timeoutMs || 8_000
  })
}
