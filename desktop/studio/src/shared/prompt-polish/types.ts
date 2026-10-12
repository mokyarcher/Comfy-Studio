export type PolishMode = 'ai'
export type PromptLanguage = 'match_input' | 'zh' | 'en'
export type PolishDetail = 'concise' | 'standard' | 'detailed'
export type ModelProfileId = 'sd15' | 'sdxl' | 'flux' | 'sd3' | 'unknown'

export interface PromptPolishConflict {
  code: string
  message: string
  severity: 'info' | 'warning' | 'blocking'
}

export interface PromptPolishRequest {
  prompt: string
  negativePrompt?: string
  mode: PolishMode
  outputLanguage: PromptLanguage
  detail: PolishDetail
  modelProfile: ModelProfileId
}

export interface PromptPolishResult {
  mode: PolishMode
  originalPrompt: string
  enhancedPrompt: string
  originalNegativePrompt?: string
  enhancedNegativePrompt?: string
  addedDetails: string[]
  preservedConstraints: string[]
  assumptions: string[]
  conflicts: PromptPolishConflict[]
  matchedCategories: string[]
  modelProfile: string
  outputLanguage: PromptLanguage
  generatedAt: string
}

export interface PromptPolishProvider {
  polish(request: PromptPolishRequest): Promise<PromptPolishResult>
}

export interface AiPolishSettingsPublic {
  /** Prefer Comfy Gateway /v1/prompt/polish (server holds upstream key). */
  useGateway: boolean
  /** Advanced: allow direct OpenAI-compatible provider with local key. */
  allowDirect: boolean
  enabled: boolean
  baseUrl: string
  model: string
  timeoutMs: number
  hasApiKey: boolean
  apiKeyMasked: string
  lastTestAt?: string
  lastTestOk?: boolean
  lastTestMessage?: string
  /** Last known gateway polish status message (optional). */
  gatewayMessage?: string
  gatewayConfigured?: boolean
  dailyRemaining?: number
}

export interface PromptPolishPrefs {
  mode: PolishMode
  outputLanguage: PromptLanguage
  detail: PolishDetail
  modelProfile: ModelProfileId
}

export const DEFAULT_POLISH_PREFS: PromptPolishPrefs = {
  mode: 'ai',
  outputLanguage: 'match_input',
  detail: 'standard',
  modelProfile: 'unknown'
}

export const DEFAULT_AI_POLISH_PUBLIC: AiPolishSettingsPublic = {
  useGateway: true,
  allowDirect: false,
  enabled: true,
  baseUrl: '',
  model: '',
  timeoutMs: 60_000,
  hasApiKey: false,
  apiKeyMasked: ''
}
