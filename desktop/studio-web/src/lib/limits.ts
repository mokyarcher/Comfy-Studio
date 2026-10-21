/** Mirror desktop/studio/src/shared/types.ts size helpers. */

/** @deprecated Prefer IMAGE_MAX_WIDTH / IMAGE_MAX_HEIGHT (asymmetric). */
export const IMAGE_MAX_SIDE = 1928
export const IMAGE_MAX_WIDTH = 1928
export const IMAGE_MAX_HEIGHT = 1088
export const VIDEO_MAX_LONG = 800
export const VIDEO_MAX_SHORT = 496
export const MAX_VIDEO_LENGTH = 161
export const SIZE_MULTIPLE = 8

export const DEFAULT_SERVER_LIMITS = {
  maxSteps: 40,
  maxWidth: IMAGE_MAX_WIDTH,
  maxHeight: IMAGE_MAX_HEIGHT
} as const

export type ServerLimits = {
  maxSteps: number
  maxWidth: number
  maxHeight: number
}

export const IMAGE_SIZE_PRESETS = [
  { id: 'fhd-wide', label: '1928×1088', width: 1928, height: 1088 },
  { id: '1024', label: '1024²', width: 1024, height: 1024 },
  { id: 'portrait', label: '768×1024', width: 768, height: 1024 },
  { id: 'landscape', label: '1024×768', width: 1024, height: 768 },
  { id: '768', label: '768²', width: 768, height: 768 },
  { id: '512', label: '512²', width: 512, height: 512 }
] as const

export const VIDEO_SIZE_PRESETS = [
  { id: 'v-landscape', label: '800×496', width: 800, height: 496 },
  { id: 'v-portrait', label: '496×800', width: 496, height: 800 },
  { id: 'v-landscape-sm', label: '640×384', width: 640, height: 384 },
  { id: 'v-portrait-sm', label: '384×640', width: 384, height: 640 },
  { id: 'v-square', label: '496²', width: 496, height: 496 }
] as const

export function snapSizeMultiple(n: number, multiple = SIZE_MULTIPLE, maxSide = IMAGE_MAX_WIDTH): number {
  if (!Number.isFinite(n)) return multiple
  const m = Math.max(multiple, Math.round(n / multiple) * multiple)
  return Math.min(maxSide, Math.max(multiple, m))
}

export function clampImageSize(
  width: number,
  height: number,
  maxWidth = IMAGE_MAX_WIDTH,
  maxHeight = IMAGE_MAX_HEIGHT
): { width: number; height: number } {
  const maxW = Math.min(IMAGE_MAX_WIDTH, Math.max(SIZE_MULTIPLE, maxWidth))
  const maxH = Math.min(IMAGE_MAX_HEIGHT, Math.max(SIZE_MULTIPLE, maxHeight))
  return {
    width: snapSizeMultiple(width, SIZE_MULTIPLE, maxW),
    height: snapSizeMultiple(height, SIZE_MULTIPLE, maxH)
  }
}

export function clampVideoSize(width: number, height: number): { width: number; height: number } {
  let w = Math.max(SIZE_MULTIPLE, width)
  let h = Math.max(SIZE_MULTIPLE, height)
  const landscape = w >= h
  const maxW = landscape ? VIDEO_MAX_LONG : VIDEO_MAX_SHORT
  const maxH = landscape ? VIDEO_MAX_SHORT : VIDEO_MAX_LONG
  const scale = Math.min(1, maxW / w, maxH / h)
  w = snapSizeMultiple(w * scale, SIZE_MULTIPLE, maxW)
  h = snapSizeMultiple(h * scale, SIZE_MULTIPLE, maxH)
  if (w > maxW) w = maxW
  if (h > maxH) h = maxH
  if (w % SIZE_MULTIPLE !== 0) w = snapSizeMultiple(w, SIZE_MULTIPLE, maxW)
  if (h % SIZE_MULTIPLE !== 0) h = snapSizeMultiple(h, SIZE_MULTIPLE, maxH)
  return { width: w, height: h }
}

export function clampSteps(n: number, maxSteps: number): number {
  const max = Math.max(1, maxSteps)
  if (!Number.isFinite(n)) return 1
  return Math.min(max, Math.max(1, Math.round(n)))
}

export function clampVideoLength(n: number): number {
  if (!Number.isFinite(n)) return 81
  return Math.min(MAX_VIDEO_LENGTH, Math.max(1, Math.round(n)))
}
