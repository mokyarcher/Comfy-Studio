export type ShowcaseItem = {
  id: string
  prompt: string
  modeLabel: string
  /** Full-resolution image — load only when opening lightbox */
  image?: string
  /** Small grid preview */
  thumb?: string
  tint?: string
}
