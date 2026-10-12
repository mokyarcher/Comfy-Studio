/**
 * Join API base URL (may include path prefix) with a relative path.
 * Example: joinUrl('http://host:8080/qwen-image', '/health/ready')
 *       → 'http://host:8080/qwen-image/health/ready'
 */
export function joinUrl(base: string, path: string): string {
  const trimmedBase = base.trim().replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  if (!trimmedBase) return normalizedPath
  return `${trimmedBase}${normalizedPath}`
}

export function isLocalhostUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1'
  } catch {
    return false
  }
}

export function isInsecurePublicHttp(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' && !isLocalhostUrl(url)
  } catch {
    return false
  }
}

export function maskApiKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}
