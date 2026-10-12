import { describe, expect, it } from 'vitest'
import { AiPolishPayloadSchema } from './schemas'

describe('AI polish payload schema', () => {
  it('accepts valid snake_case payload', () => {
    const parsed = AiPolishPayloadSchema.parse({
      enhanced_prompt: '一只黑色猫咪坐在红色沙发上，毛发质感清楚',
      added_details: ['毛发质感清楚'],
      preserved_constraints: ['黑色', '一只', '红色沙发'],
      assumptions: [],
      conflicts: []
    })
    expect(parsed.enhanced_prompt).toContain('猫咪')
  })

  it('rejects empty enhanced_prompt', () => {
    const r = AiPolishPayloadSchema.safeParse({
      enhanced_prompt: '',
      added_details: [],
      preserved_constraints: [],
      assumptions: [],
      conflicts: []
    })
    expect(r.success).toBe(false)
  })

  it('strips trust of client-owned metadata by not requiring it', () => {
    const parsed = AiPolishPayloadSchema.parse({
      enhanced_prompt: 'a cat',
      original_prompt: 'SHOULD_BE_IGNORED',
      mode: 'ai',
      added_details: [],
      preserved_constraints: [],
      assumptions: [],
      conflicts: []
    })
    expect(parsed.enhanced_prompt).toBe('a cat')
  })
})
