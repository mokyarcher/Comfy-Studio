import { describe, expect, it } from 'vitest'
import { maskApiKey, redactSensitive } from '../src/shared/redact'
import { labelServiceState, mergeApiDisplayState } from '../src/shared/statusHelpers'

describe('redactSensitive', () => {
  it('redacts API_KEY values', () => {
    const input = 'Loaded API_KEY=super-secret-value-123 from env'
    const out = redactSensitive(input)
    expect(out).toContain('[REDACTED]')
    expect(out).not.toContain('super-secret-value-123')
  })

  it('redacts bearer tokens', () => {
    const input = 'Authorization: Bearer abc.def.ghi'
    expect(redactSensitive(input)).toContain('[REDACTED]')
  })
})

describe('maskApiKey', () => {
  it('masks middle of key', () => {
    const masked = maskApiKey('abcdefghijklmnop')
    expect(masked.startsWith('abcd')).toBe(true)
    expect(masked.endsWith('mnop')).toBe(true)
    expect(masked).toContain('•')
  })
})

describe('statusHelpers', () => {
  it('labels running state', () => {
    expect(labelServiceState('running')).toBe('运行中')
  })

  it('detects external API without claiming ownership', () => {
    const result = mergeApiDisplayState('stopped', {
      ok: true,
      statusCode: 200,
      latencyMs: 12,
      message: 'ok',
      external: true
    })
    expect(result.state).toBe('external')
    expect(result.label).toContain('非本应用启动')
  })
})
