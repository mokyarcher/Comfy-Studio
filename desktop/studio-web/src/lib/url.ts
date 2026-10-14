export function joinUrl(base: string, path: string): string {
  const trimmedBase = base.trim().replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  if (!trimmedBase) return normalizedPath
  return `${trimmedBase}${normalizedPath}`
}

export function maskApiKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}
