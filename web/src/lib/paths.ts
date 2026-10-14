/** Prefix path with Astro/Vite BASE_URL (trailing slash on base). */
export function withBase(path = ''): string {
  const base = import.meta.env.BASE_URL || '/'
  if (!path || path === '/') return base
  if (path.startsWith('#')) return `${base}${path}`
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  const clean = path.replace(/^\//, '')
  return `${base}${clean}`
}
