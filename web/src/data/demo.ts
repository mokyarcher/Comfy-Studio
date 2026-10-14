export type DemoImage = {
  /** 相对站点根，如 media/demo/create-01.png */
  src: string
  /** 短标签（叠加在图上，可选） */
  caption?: string
  /** 演示说明：底部展示，如「文生图界面，填入提示词、配置参数」 */
  note?: string
}

/** 同一功能下可挂多张图；左侧导览与右侧预览共用 */
export type DemoFeature = {
  id: string
  /** 功能名，如「Studio · 创作」 */
  title: string
  /** 左侧导览说明 */
  body: string
  images: DemoImage[]
}

export type DemoManifest = {
  features: DemoFeature[]
  /** 相对站点根，如 media/studio-tour.mp4 */
  video: string
  videoPoster?: string
}
