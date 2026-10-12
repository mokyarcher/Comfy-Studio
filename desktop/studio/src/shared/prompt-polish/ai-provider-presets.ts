export interface AiProviderPreset {
  id: string
  name: string
  /** Short Chinese blurb shown under the chip */
  blurb: string
  baseUrl: string
  model: string
  /** Where to get a key (hint only) */
  keyHint: string
}

/** OpenAI-compatible presets for AI prompt polish. Selecting fills Base URL + model. */
export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek 深度求索',
    blurb: '国内常用，性价比高，OpenAI 兼容',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    keyHint: '在 platform.deepseek.com 创建 API Key'
  },
  {
    id: 'sensenova',
    name: '商汤日日新',
    blurb: 'SenseNova 国内 Token 接口',
    baseUrl: 'https://token.sensenova.cn/v1',
    model: 'sensenova-6.8-flash-lite',
    keyHint: '在 platform.sensenova.cn 申请 Token Plan Key'
  },
  {
    id: 'sensenova_compatible',
    name: '商汤大装置兼容',
    blurb: 'SenseCore OpenAI 兼容模式',
    baseUrl: 'https://api.sensenova.cn/compatible-mode/v2',
    model: 'SenseChat-5',
    keyHint: '在商汤大装置控制台获取 API Key/Token'
  },
  {
    id: 'qwen',
    name: '通义千问',
    blurb: '阿里云 DashScope 兼容模式',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    keyHint: '在阿里云百炼 / DashScope 创建 Key'
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    blurb: '智谱开放平台',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    keyHint: '在 open.bigmodel.cn 创建 API Key'
  },
  {
    id: 'moonshot',
    name: '月之暗面 Kimi',
    blurb: 'Moonshot OpenAI 兼容',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    keyHint: '在 platform.moonshot.cn 创建 API Key'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    blurb: '官方接口（需可访问外网）',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyHint: '在 platform.openai.com 创建 API Key'
  },
  {
    id: 'custom',
    name: '自定义',
    blurb: '手动填写任意兼容接口',
    baseUrl: '',
    model: '',
    keyHint: 'Base URL 需指向 …/v1 或可拼接 /chat/completions 的地址'
  }
]

export function matchPresetId(baseUrl: string, model: string): string {
  const b = baseUrl.replace(/\/+$/, '').toLowerCase()
  const m = model.trim().toLowerCase()
  for (const p of AI_PROVIDER_PRESETS) {
    if (p.id === 'custom') continue
    const pb = p.baseUrl.replace(/\/+$/, '').toLowerCase()
    if (b === pb || b.startsWith(pb + '/')) {
      if (!m || m === p.model.toLowerCase() || m.includes(p.model.toLowerCase().split('-')[0]!)) {
        return p.id
      }
      return p.id
    }
  }
  return 'custom'
}
