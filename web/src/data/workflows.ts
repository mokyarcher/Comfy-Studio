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
  /** 对应 mirrors[].id */
  mirror?: string
}

export type WorkflowModel = {
  id: string
  name: string
  role?: string
  sizeHint?: string
  savePath?: string
  links?: ModelLink[]
}

export type WorkflowItem = {
  id: string
  name: string
  /** txt2img | image_edit | image_to_video */
  mode: string
  summary: string
  required?: boolean
  models: WorkflowModel[]
}

export type WorkflowsManifest = {
  projectVersion: string
  updatedAt?: string
  /** 面向访客的短说明（不要写维护说明） */
  intro?: string
  mirrors: ModelMirror[]
  workflows: WorkflowItem[]
}
