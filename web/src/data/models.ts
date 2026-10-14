export type ModelMirror = {
  id: string
  name: string
  /** 1 = 首选, 2 = 次选 … */
  priority: number
  url: string
  note?: string
}

export type ModelLink = {
  label: string
  url: string
  /** 对应 mirrors[].id，便于排序展示 */
  mirror?: string
}

export type ProjectModel = {
  id: string
  name: string
  /** 在本项目中的用途，如「文生图主模型」 */
  role: string
  /** txt2img | image_edit | image_to_video | other */
  mode?: string
  sizeHint?: string
  /** 建议放到本机 ComfyUI 的相对路径 */
  savePath?: string
  required?: boolean
  links: ModelLink[]
  note?: string
}

export type ModelsManifest = {
  /** 与本站/客户端对齐的项目版本说明 */
  projectVersion: string
  updatedAt?: string
  intro?: string
  mirrors: ModelMirror[]
  models: ProjectModel[]
}
