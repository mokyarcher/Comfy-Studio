import { z } from 'zod'

export const PromptPolishConflictSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.enum(['info', 'warning', 'blocking'])
})

export const PromptPolishResultSchema = z.object({
  mode: z.literal('ai'),
  originalPrompt: z.string(),
  enhancedPrompt: z.string().min(1),
  originalNegativePrompt: z.string().optional(),
  enhancedNegativePrompt: z.string().optional(),
  addedDetails: z.array(z.string()),
  preservedConstraints: z.array(z.string()),
  assumptions: z.array(z.string()),
  conflicts: z.array(PromptPolishConflictSchema),
  matchedCategories: z.array(z.string()),
  modelProfile: z.string(),
  outputLanguage: z.enum(['match_input', 'zh', 'en']),
  generatedAt: z.string()
})

/** Schema for AI model JSON payload (snake_case fields). */
export const AiPolishPayloadSchema = z.object({
  enhanced_prompt: z.string().min(1),
  enhanced_negative_prompt: z.string().optional().nullable(),
  added_details: z.array(z.string()).default([]),
  preserved_constraints: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  conflicts: z
    .array(
      z.object({
        code: z.string().default('ai_conflict'),
        message: z.string(),
        severity: z.enum(['info', 'warning', 'blocking']).default('warning')
      })
    )
    .default([]),
  matched_categories: z.array(z.string()).optional().default([])
})
