import type { ProbeResult } from '../shared/types'

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return `${b}${p}`
}

async function probe(url: string, timeoutMs: number): Promise<ProbeResult> {
  const started = Date.now()
  const checkedAt = new Date().toISOString()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    })
    const latencyMs = Date.now() - started
    if (res.ok) {
      return {
        ok: true,
        state: 'up',
        statusCode: res.status,
        latencyMs,
        message: `HTTP ${res.status}`,
        checkedAt
      }
    }
    let detail = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (body?.detail) detail = `${detail}: ${JSON.stringify(body.detail)}`
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      state: res.status >= 500 ? 'down' : 'error',
      statusCode: res.status,
      latencyMs,
      message: detail,
      checkedAt
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      state: 'down',
      latencyMs: Date.now() - started,
      message: message.includes('abort') ? '请求超时' : message,
      checkedAt
    }
  } finally {
    clearTimeout(timer)
  }
}

export function testComfy(comfyUrl: string, timeoutMs: number): Promise<ProbeResult> {
  if (!comfyUrl.trim()) {
    return Promise.resolve({
      ok: false,
      state: 'unknown',
      message: '未配置 ComfyUI 地址',
      checkedAt: new Date().toISOString()
    })
  }
  return probe(joinUrl(comfyUrl, '/system_stats'), timeoutMs)
}

export function testLocalApi(host: string, port: number, timeoutMs: number): Promise<ProbeResult> {
  return probe(`http://${host}:${port}/health/ready`, timeoutMs)
}

export function testPublicApi(publicBaseUrl: string, timeoutMs: number): Promise<ProbeResult> {
  if (!publicBaseUrl.trim()) {
    return Promise.resolve({
      ok: false,
      state: 'unknown',
      message: '未配置公网地址',
      checkedAt: new Date().toISOString()
    })
  }
  return probe(joinUrl(publicBaseUrl, '/health/ready'), timeoutMs)
}
