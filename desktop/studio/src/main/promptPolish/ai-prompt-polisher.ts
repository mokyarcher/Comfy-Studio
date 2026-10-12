import { AI_POLISH_SYSTEM_PROMPT } from '../../shared/prompt-polish/ai-system-prompt'
import { AiPolishPayloadSchema } from '../../shared/prompt-polish/schemas'
import type { PromptPolishRequest, PromptPolishResult } from '../../shared/prompt-polish/types'
import { getPolishGatewayStatus, polishViaGateway } from '../api/client'
import { getProfileSecret, listProfiles } from '../store/profiles'
import { getAiPolishSecret, saveAiPolishSettings } from './aiSettings'

function stripMarkdownFence(text: string): string {
  const trimmed = text.trim()
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fence ? fence[1].trim() : trimmed
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return `${b}${p}`
}

export class AiPolishError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'AiPolishError'
    this.code = code
  }
}

function resolveProfileId(explicit?: string): string | null {
  if (explicit) return explicit
  const { profiles } = listProfiles()
  return profiles.find((p) => p.isDefault)?.id ?? profiles[0]?.id ?? null
}

export async function polishPromptViaGateway(
  request: PromptPolishRequest,
  profileId?: string
): Promise<PromptPolishResult> {
  const id = resolveProfileId(profileId)
  if (!id) throw new AiPolishError('no_profile', '请先在「API 连接」中配置网关地址与密钥')
  const sec = getProfileSecret(id)
  if (!sec?.apiKey) throw new AiPolishError('no_profile', 'API Key 缺失，请重新保存连接配置')

  const timeoutMs = Math.min(Math.max(sec.profile.timeoutMs, 30_000), 120_000)
  try {
    const data = await polishViaGateway({
      baseUrl: sec.profile.baseUrl,
      apiKey: sec.apiKey,
      timeoutMs,
      prompt: request.prompt,
      negativePrompt: request.negativePrompt,
      outputLanguage: request.outputLanguage,
      detail: request.detail,
      modelProfile: request.modelProfile
    })

    if (data.quota) {
      saveAiPolishSettings({
        gatewayConfigured: true,
        gatewayMessage: `今日剩余 ${data.quota.daily_remaining}/${data.quota.daily_limit}`,
        dailyRemaining: data.quota.daily_remaining
      })
    }

    const conflicts = (data.conflicts || []).map((c) => ({
      code: c.code || 'ai_conflict',
      message: c.message,
      severity: (['info', 'warning', 'blocking'].includes(c.severity)
        ? c.severity
        : 'warning') as 'info' | 'warning' | 'blocking'
    }))

    return {
      mode: 'ai',
      originalPrompt: request.prompt,
      enhancedPrompt: (data.enhanced_prompt || request.prompt).trim() || request.prompt,
      originalNegativePrompt: request.negativePrompt,
      enhancedNegativePrompt: data.enhanced_negative_prompt?.trim() || request.negativePrompt,
      addedDetails: data.added_details || [],
      preservedConstraints: data.preserved_constraints || [],
      assumptions: [
        ...(data.assumptions || []),
        '本次经网关代理润色，上游 API Key 仅保存在服务器。'
      ],
      conflicts,
      matchedCategories: data.matched_categories || [],
      modelProfile: request.modelProfile,
      outputLanguage: request.outputLanguage,
      generatedAt: new Date().toISOString()
    }
  } catch (err) {
    throw new AiPolishError(
      'gateway',
      err instanceof Error ? err.message : '网关润色失败'
    )
  }
}

/** Direct OpenAI-compatible call (advanced bypass). */
export async function polishPromptDirect(request: PromptPolishRequest): Promise<PromptPolishResult> {
  const secret = getAiPolishSecret()
  if (!secret) throw new AiPolishError('not_configured', 'AI 润色未配置')
  const { settings, apiKey } = secret
  if (!settings.allowDirect) {
    throw new AiPolishError('direct_disabled', '未开启自备 Key 直连，请使用网关润色')
  }
  if (!settings.enabled) throw new AiPolishError('disabled', 'AI 润色未启用')
  if (!settings.baseUrl) throw new AiPolishError('missing_url', '请先配置直连 API Base URL')
  if (!apiKey) throw new AiPolishError('missing_key', '请先配置直连 API Key')
  if (!settings.model) throw new AiPolishError('missing_model', '请先配置模型名称')

  const userPayload = {
    original_prompt: request.prompt,
    original_negative_prompt: request.negativePrompt ?? '',
    model_profile: request.modelProfile,
    output_language: request.outputLanguage,
    detail: request.detail,
    instructions: '请按 system 要求返回 JSON。'
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs)

  let response: Response
  try {
    response = await fetch(joinUrl(settings.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: AI_POLISH_SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(userPayload) }
        ]
      }),
      signal: controller.signal
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AiPolishError('timeout', `AI 润色超时（${settings.timeoutMs}ms）`)
    }
    throw new AiPolishError(
      'network',
      `AI 网络请求失败：${err instanceof Error ? err.message : String(err)}`
    )
  } finally {
    clearTimeout(timer)
  }

  if (response.status === 401) throw new AiPolishError('auth', 'AI API 认证失败（401）')
  if (response.status === 429) throw new AiPolishError('rate_limit', 'AI API 速率限制（429）')
  if (!response.ok) {
    throw new AiPolishError('http', `AI API 错误 ${response.status}`)
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (!content || !content.trim()) throw new AiPolishError('empty', 'AI 返回内容为空')

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(stripMarkdownFence(content))
  } catch {
    throw new AiPolishError('invalid_json', 'AI 返回的不是合法 JSON')
  }

  const payload = AiPolishPayloadSchema.safeParse(parsedJson)
  if (!payload.success) {
    throw new AiPolishError('schema', 'AI 返回结构不符合约定')
  }

  return {
    mode: 'ai',
    originalPrompt: request.prompt,
    enhancedPrompt: payload.data.enhanced_prompt.trim() || request.prompt,
    originalNegativePrompt: request.negativePrompt,
    enhancedNegativePrompt:
      payload.data.enhanced_negative_prompt?.trim() || request.negativePrompt,
    addedDetails: payload.data.added_details,
    preservedConstraints: payload.data.preserved_constraints,
    assumptions: payload.data.assumptions,
    conflicts: payload.data.conflicts,
    matchedCategories: payload.data.matched_categories ?? [],
    modelProfile: request.modelProfile,
    outputLanguage: request.outputLanguage,
    generatedAt: new Date().toISOString()
  }
}

export async function polishPromptWithAi(
  request: PromptPolishRequest,
  profileId?: string
): Promise<PromptPolishResult> {
  const secret = getAiPolishSecret()
  const useGateway = secret?.settings.useGateway !== false

  if (useGateway) {
    try {
      return await polishPromptViaGateway(request, profileId)
    } catch (err) {
      const allowDirect = secret?.settings.allowDirect === true
      if (!allowDirect) throw err
      // fall through to direct
    }
  }

  return polishPromptDirect(request)
}

export async function testAiPolishConnection(profileId?: string): Promise<{
  ok: boolean
  message: string
  latencyMs: number
}> {
  const secret = getAiPolishSecret()
  const useGateway = secret?.settings.useGateway !== false

  if (useGateway) {
    const id = resolveProfileId(profileId)
    if (!id) return { ok: false, message: '未配置 API 连接', latencyMs: 0 }
    const sec = getProfileSecret(id)
    if (!sec?.apiKey) return { ok: false, message: 'API Key 缺失', latencyMs: 0 }
    const started = Date.now()
    try {
      const st = await getPolishGatewayStatus({
        baseUrl: sec.profile.baseUrl,
        apiKey: sec.apiKey,
        timeoutMs: 15_000
      })
      const latencyMs = Date.now() - started
      saveAiPolishSettings({
        gatewayConfigured: st.configured,
        gatewayMessage: st.message,
        dailyRemaining: st.quota?.daily_remaining
      })
      if (!st.enabled || !st.configured) {
        return { ok: false, message: st.message, latencyMs }
      }
      const remain =
        st.quota && st.quota.daily_remaining >= 0
          ? ` · 今日剩余 ${st.quota.daily_remaining}/${st.quota.daily_limit}`
          : ''
      return { ok: true, message: `${st.message}${remain}`, latencyMs }
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - started
      }
    }
  }

  // Direct provider test
  if (!secret?.settings.baseUrl) return { ok: false, message: '未配置 Base URL', latencyMs: 0 }
  if (!secret.apiKey) return { ok: false, message: '未配置 API Key', latencyMs: 0 }
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    const res = await fetch(joinUrl(secret.settings.baseUrl, '/models'), {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret.apiKey}` },
      signal: controller.signal
    })
    const latencyMs = Date.now() - started
    if (res.ok) return { ok: true, message: `直连成功（${res.status}）`, latencyMs }
    if (res.status === 401) return { ok: false, message: '认证失败（401）', latencyMs }
    return { ok: false, message: `HTTP ${res.status}`, latencyMs }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - started
    }
  } finally {
    clearTimeout(timer)
  }
}
