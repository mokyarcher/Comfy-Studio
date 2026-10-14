function connectionFailed(code?: number | string): string {
  if (code != null && String(code).trim()) {
    return `无法与服务器建立连接，请检查相关配置（${code}）`
  }
  return '无法与服务器建立连接，请检查相关配置'
}

export function sanitizeErrorMessage(msg: string): string {
  return msg
    .replace(/X-API-Key[:\s]*[^\s,]+/gi, 'X-API-Key: ***')
    .replace(/api[_-]?key[=:]\s*[^\s&]+/gi, 'api_key=***')
}

function extractCodedDetail(detail: unknown): { code?: string; message?: string } | null {
  if (detail == null || typeof detail !== 'object') return null
  const root = detail as Record<string, unknown>
  const inner =
    root.detail && typeof root.detail === 'object'
      ? (root.detail as Record<string, unknown>)
      : root
  const code = typeof inner.code === 'string' ? inner.code : undefined
  const message = typeof inner.message === 'string' ? sanitizeErrorMessage(inner.message) : undefined
  if (!code && !message) return null
  return { code, message }
}

function extractDetail(detail: unknown): string | undefined {
  if (detail == null) return undefined
  if (typeof detail === 'string') return sanitizeErrorMessage(detail)
  if (typeof detail === 'object') {
    const d = detail as Record<string, unknown>
    if (typeof d.detail === 'string') return sanitizeErrorMessage(d.detail)
    if (d.detail && typeof d.detail === 'object') {
      const inner = d.detail as Record<string, unknown>
      if (typeof inner.message === 'string') return sanitizeErrorMessage(inner.message)
    }
    if (typeof d.message === 'string') return sanitizeErrorMessage(d.message)
  }
  return undefined
}

export function mapHttpError(status: number, detail?: unknown): string {
  const coded = extractCodedDetail(detail)
  if (coded?.code === 'local_hold') return coded.message || '服务端本机占用中，请稍后再试。'
  if (coded?.code === 'daily_generate_quota') return coded.message || '今日生图次数已用完。'
  if (coded?.code === 'queue_full') return coded.message || '服务端队列已满，请稍后再试。'

  const detailText = coded?.message || extractDetail(detail)

  switch (status) {
    case 401:
      return '登录或密钥无效，请检查账号配置（401）'
    case 403:
      return '没有访问权限，请检查账号配置（403）'
    case 404:
      return detailText || '内容不存在或已删除（404）'
    case 422:
      return detailText ? `参数有误：${detailText}` : '参数有误，请检查后重试（422）'
    case 429:
      return detailText || '请求过于频繁或队列已满，请稍后再试（429）'
    case 500:
    case 502:
    case 503:
    case 504:
      return connectionFailed(status)
    default:
      if (status >= 500) return connectionFailed(status)
      if (status >= 400) return `请求失败，请检查相关配置（${status}）`
      return detailText || connectionFailed(status)
  }
}

export function mapNetworkError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()
  if (lower.includes('abort') || lower.includes('timeout')) return connectionFailed('超时')
  if (
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    lower.includes('cors')
  ) {
    return connectionFailed()
  }
  return sanitizeErrorMessage(msg.trim() || connectionFailed())
}
