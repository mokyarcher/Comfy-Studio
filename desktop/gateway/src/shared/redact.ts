const PATTERNS: RegExp[] = [
  /\bAPI_KEY\s*=\s*["']?([^\s"']+)/gi,
  /\bX-API-Key\s*[:=]\s*["']?([^\s"']+)/gi,
  /\bAuthorization\s*[:=]\s*["']?Bearer\s+([^\s"']+)/gi,
  /\btoken\s*[:=]\s*["']?([^\s"']+)/gi,
  /\bauth_token\s*[:=]\s*["']?([^\s"']+)/gi,
  /\bpassword\s*[:=]\s*["']?([^\s"']+)/gi,
  /\bsecret\s*[:=]\s*["']?([^\s"']+)/gi
]

export function redactSecrets(input: string): string {
  let out = input
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, (match, value: string) => {
      if (!value) return match
      return match.replace(value, '***REDACTED***')
    })
  }
  return out
}

export function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}${'•'.repeat(Math.min(key.length - 8, 24))}${key.slice(-4)}`
}
