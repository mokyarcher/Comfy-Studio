import { describe, expect, it } from 'vitest'
import { isInsecurePublicHttp, isLocalhostUrl, joinUrl, maskApiKey } from './url'

describe('joinUrl', () => {
  it('joins base with path prefix and health path', () => {
    expect(joinUrl('http://111.229.166.216:8080/qwen-image', '/health/ready')).toBe(
      'http://111.229.166.216:8080/qwen-image/health/ready'
    )
  })

  it('strips trailing slashes on base', () => {
    expect(joinUrl('http://127.0.0.1:8000/', 'v1/images/generate')).toBe(
      'http://127.0.0.1:8000/v1/images/generate'
    )
  })

  it('handles root base', () => {
    expect(joinUrl('http://example.com', '/v1/tasks/abc')).toBe('http://example.com/v1/tasks/abc')
  })

  it('handles empty base', () => {
    expect(joinUrl('', '/health/ready')).toBe('/health/ready')
  })
})

describe('url helpers', () => {
  it('detects localhost', () => {
    expect(isLocalhostUrl('http://127.0.0.1:8000')).toBe(true)
    expect(isLocalhostUrl('http://localhost:8000/qwen')).toBe(true)
    expect(isLocalhostUrl('http://111.229.166.216:8080/qwen-image')).toBe(false)
  })

  it('warns on public http', () => {
    expect(isInsecurePublicHttp('http://111.229.166.216:8080/qwen-image')).toBe(true)
    expect(isInsecurePublicHttp('http://127.0.0.1:8000')).toBe(false)
    expect(isInsecurePublicHttp('https://img-api.example.com')).toBe(false)
  })

  it('masks api keys', () => {
    expect(maskApiKey('abcdefghijklmnop')).toBe('abcd••••mnop')
    expect(maskApiKey('short')).toBe('••••••••')
  })
})
