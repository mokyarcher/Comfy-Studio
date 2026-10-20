import { z } from 'zod'

export const GatewayConfigSchema = z.object({
  apiProjectDir: z.string().default(''),
  pythonPath: z.string().default(''),
  apiHost: z.string().default('127.0.0.1'),
  apiPort: z.number().int().min(1).max(65535).default(8000),
  comfyUrl: z.string().default('http://127.0.0.1:8188'),
  /** ComfyUI 目录：桌面版含 main.py；便携版为 portable 根目录或外层安装夹 */
  comfyUiDir: z.string().default(''),
  /** 启动命令；桌面版用 .venv，便携版用 python_embeded（可留默认，启动时按目录类型校正） */
  comfyUiLaunch: z
    .string()
    .default('.venv\\Scripts\\python.exe main.py --listen 127.0.0.1 --port 8188'),
  publicBaseUrl: z.string().default('http://111.229.166.216:8080/qwen-image'),
  frpcPath: z.string().default(''),
  frpcConfigPath: z.string().default(''),
  workflowPath: z.string().default(''),
  healthIntervalMs: z.number().int().min(1000).max(60000).default(3000),
  requestTimeoutMs: z.number().int().min(1000).max(120000).default(8000),
  minimizeToTrayOnClose: z.boolean().default(false),
  /** Gateway 启动后自动拉起 ComfyUI（可独立勾选） */
  autoStartComfy: z.boolean().default(false),
  /** Gateway 启动后自动拉起 FastAPI */
  autoStartApi: z.boolean().default(false),
  /** Gateway 启动后自动拉起 FRP */
  autoStartFrp: z.boolean().default(false)
})

export type GatewayConfig = z.infer<typeof GatewayConfigSchema>

export type ServiceState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error'
  | 'unconfigured'
  | 'unknown'

export type ProbeState = 'unknown' | 'up' | 'down' | 'error'

export interface ProbeResult {
  ok: boolean
  state: ProbeState
  statusCode?: number
  latencyMs?: number
  message: string
  checkedAt: string
}

export interface ServiceRuntime {
  state: ServiceState
  pid?: number
  startedByApp: boolean
  lastError?: string
  startedAt?: string
}

export interface GatewayStatus {
  api: ServiceRuntime
  frp: ServiceRuntime
  /** ComfyUI 进程运行时（本应用启停） */
  comfyRuntime: ServiceRuntime
  /** ComfyUI HTTP 探测 */
  comfy: ProbeResult
  localApi: ProbeResult
  publicApi: ProbeResult
  config: GatewayConfig
  resolvedPythonPath?: string
  resolvedWorkflowPath?: string
}

export type LogSource = 'api' | 'frp' | 'comfy' | 'system'

export interface LogLine {
  id: number
  ts: string
  source: LogSource
  stream: 'stdout' | 'stderr' | 'system'
  text: string
}

export interface ActionResult {
  ok: boolean
  message: string
  restartRequired?: boolean
}

export type CloseChoice = 'tray' | 'keep' | 'quit-stop'
