import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync, statSync } from 'fs'
import { join } from 'path'
import type {
  ActionResult,
  GatewayConfig,
  GatewayStatus,
  ProbeResult,
  ServiceRuntime
} from '../shared/types'
import { loadConfig, saveConfig, suggestApiProjectDir } from './config'
import { testComfy, testLocalApi, testPublicApi } from './health'
import { RingLogBuffer } from './logs'
import {
  generateApiKey,
  readApiKeyFromEnv,
  writeApiKeyToEnv
} from './envKey'

function emptyProbe(message = '尚未检查'): ProbeResult {
  return {
    ok: false,
    state: 'unknown',
    message,
    checkedAt: new Date().toISOString()
  }
}

function emptyRuntime(state: ServiceRuntime['state'] = 'stopped'): ServiceRuntime {
  return { state, startedByApp: false }
}

function resolvePython(config: GatewayConfig): string | undefined {
  if (config.pythonPath && existsSync(config.pythonPath)) return config.pythonPath
  if (config.apiProjectDir) {
    const venvPy = join(config.apiProjectDir, '.venv', 'Scripts', 'python.exe')
    if (existsSync(venvPy)) return venvPy
  }
  return config.pythonPath || undefined
}

function resolveWorkflow(config: GatewayConfig): string | undefined {
  if (config.workflowPath && existsSync(config.workflowPath)) return config.workflowPath
  if (config.apiProjectDir) {
    const candidate = join(config.apiProjectDir, 'workflow_api.json')
    if (existsSync(candidate)) return candidate
  }
  return config.workflowPath || undefined
}

function attachProcessLogs(
  proc: ChildProcessWithoutNullStreams,
  source: 'api' | 'frp',
  logs: RingLogBuffer
): void {
  proc.stdout.setEncoding('utf-8')
  proc.stderr.setEncoding('utf-8')
  proc.stdout.on('data', (chunk: string) => logs.append(source, 'stdout', chunk))
  proc.stderr.on('data', (chunk: string) => logs.append(source, 'stderr', chunk))
}

function killTree(pid: number): void {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore'
    })
  } else {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* ignore */
    }
  }
}

export class ServiceManager {
  private config: GatewayConfig
  private apiProc: ChildProcessWithoutNullStreams | null = null
  private frpProc: ChildProcessWithoutNullStreams | null = null
  private apiRuntime: ServiceRuntime = emptyRuntime()
  private frpRuntime: ServiceRuntime = emptyRuntime()
  private comfyProbe = emptyProbe()
  private localProbe = emptyProbe()
  private publicProbe = emptyProbe()
  readonly logs = new RingLogBuffer()

  constructor() {
    this.config = loadConfig()
    if (!this.config.apiProjectDir) {
      const suggested = suggestApiProjectDir()
      if (suggested) {
        this.config = saveConfig({ apiProjectDir: suggested })
      }
    }
    this.logs.append('system', 'system', 'Comfy Gateway 已启动')
  }

  getConfig(): GatewayConfig {
    return this.config
  }

  saveConfig(partial: Partial<GatewayConfig>): GatewayConfig {
    this.config = saveConfig(partial)
    this.logs.append('system', 'system', '配置已保存')
    return this.config
  }

  async refreshProbes(): Promise<void> {
    const timeout = this.config.requestTimeoutMs
    const [comfy, local, pub] = await Promise.all([
      testComfy(this.config.comfyUrl, timeout),
      testLocalApi(this.config.apiHost, this.config.apiPort, timeout),
      testPublicApi(this.config.publicBaseUrl, timeout)
    ])
    this.comfyProbe = comfy
    this.localProbe = local
    this.publicProbe = pub

    if (!this.apiRuntime.startedByApp) {
      this.apiRuntime = {
        ...this.apiRuntime,
        state: local.ok ? 'running' : 'stopped',
        startedByApp: false
      }
    } else if (this.apiRuntime.state === 'starting' && local.ok) {
      this.apiRuntime = { ...this.apiRuntime, state: 'running' }
    }
  }

  getStatus(): GatewayStatus {
    return {
      api: { ...this.apiRuntime },
      frp: { ...this.frpRuntime },
      comfy: this.comfyProbe,
      localApi: this.localProbe,
      publicApi: this.publicProbe,
      config: this.config,
      resolvedPythonPath: resolvePython(this.config),
      resolvedWorkflowPath: resolveWorkflow(this.config)
    }
  }

  async startApi(): Promise<ActionResult> {
    if (this.apiProc && !this.apiProc.killed) {
      return { ok: true, message: 'API 已在运行（由本应用启动）' }
    }
    if (!this.config.apiProjectDir || !existsSync(this.config.apiProjectDir)) {
      return { ok: false, message: '请先在设置中选择 API 项目目录' }
    }
    const python = resolvePython(this.config)
    if (!python || !existsSync(python)) {
      return {
        ok: false,
        message: '未找到 Python。请配置 pythonPath 或确保项目下存在 .venv\\Scripts\\python.exe'
      }
    }

    this.apiRuntime = {
      state: 'starting',
      startedByApp: true,
      startedAt: new Date().toISOString()
    }
    this.logs.append('api', 'system', `启动 API: ${python} -m uvicorn ...`)

    try {
      const proc = spawn(
        python,
        [
          '-m',
          'uvicorn',
          'app.main:app',
          '--host',
          this.config.apiHost,
          '--port',
          String(this.config.apiPort),
          '--workers',
          '1'
        ],
        {
          cwd: this.config.apiProjectDir,
          windowsHide: true,
          env: { ...process.env }
        }
      )
      this.apiProc = proc
      this.apiRuntime.pid = proc.pid
      attachProcessLogs(proc, 'api', this.logs)

      proc.on('exit', (code, signal) => {
        this.logs.append(
          'api',
          'system',
          `API 进程退出 code=${code ?? 'null'} signal=${signal ?? 'null'}`
        )
        this.apiProc = null
        this.apiRuntime = {
          state: 'stopped',
          startedByApp: false,
          lastError: code && code !== 0 ? `退出码 ${code}` : undefined
        }
      })

      proc.on('error', (err) => {
        this.logs.append('api', 'stderr', `启动失败: ${err.message}`)
        this.apiProc = null
        this.apiRuntime = {
          state: 'error',
          startedByApp: false,
          lastError: err.message
        }
      })

      await new Promise((r) => setTimeout(r, 1200))
      await this.refreshProbes()
      if (this.localProbe.ok) {
        this.apiRuntime = { ...this.apiRuntime, state: 'running', startedByApp: true }
        return { ok: true, message: 'API 已启动并通过健康检查' }
      }
      return {
        ok: true,
        message: 'API 进程已启动，健康检查尚未通过（可稍后重试）'
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.apiRuntime = { state: 'error', startedByApp: false, lastError: message }
      return { ok: false, message }
    }
  }

  async stopApi(): Promise<ActionResult> {
    if (!this.apiProc?.pid) {
      this.apiRuntime = emptyRuntime('stopped')
      return { ok: true, message: '没有由本应用启动的 API 进程' }
    }
    this.apiRuntime = { ...this.apiRuntime, state: 'stopping' }
    const pid = this.apiProc.pid
    this.logs.append('api', 'system', `停止 API PID=${pid}`)
    killTree(pid)
    this.apiProc = null
    await new Promise((r) => setTimeout(r, 500))
    this.apiRuntime = emptyRuntime('stopped')
    await this.refreshProbes()
    return { ok: true, message: '已停止由本应用启动的 API' }
  }

  async startFrp(): Promise<ActionResult> {
    if (this.frpProc && !this.frpProc.killed) {
      return { ok: true, message: 'FRP 已在运行（由本应用启动）' }
    }
    if (!this.config.frpcPath || !existsSync(this.config.frpcPath)) {
      return { ok: false, message: '请先选择 frpc.exe 路径' }
    }
    if (!this.config.frpcConfigPath || !existsSync(this.config.frpcConfigPath)) {
      return { ok: false, message: '请先选择 FRP 配置文件（config.toml）' }
    }

    this.frpRuntime = {
      state: 'starting',
      startedByApp: true,
      startedAt: new Date().toISOString()
    }
    this.logs.append('frp', 'system', `启动 FRP: ${this.config.frpcPath} -c ${this.config.frpcConfigPath}`)

    try {
      const proc = spawn(this.config.frpcPath, ['-c', this.config.frpcConfigPath], {
        windowsHide: true,
        env: { ...process.env }
      })
      this.frpProc = proc
      this.frpRuntime.pid = proc.pid
      this.frpRuntime.state = 'running'
      attachProcessLogs(proc, 'frp', this.logs)

      proc.on('exit', (code, signal) => {
        this.logs.append(
          'frp',
          'system',
          `FRP 进程退出 code=${code ?? 'null'} signal=${signal ?? 'null'}`
        )
        this.frpProc = null
        this.frpRuntime = {
          state: 'stopped',
          startedByApp: false,
          lastError: code && code !== 0 ? `退出码 ${code}` : undefined
        }
      })

      proc.on('error', (err) => {
        this.logs.append('frp', 'stderr', `启动失败: ${err.message}`)
        this.frpProc = null
        this.frpRuntime = {
          state: 'error',
          startedByApp: false,
          lastError: err.message
        }
      })

      return { ok: true, message: 'FRP 客户端已启动' }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.frpRuntime = { state: 'error', startedByApp: false, lastError: message }
      return { ok: false, message }
    }
  }

  async stopFrp(): Promise<ActionResult> {
    if (!this.frpProc?.pid) {
      this.frpRuntime = emptyRuntime('stopped')
      return { ok: true, message: '没有由本应用启动的 FRP 进程' }
    }
    this.frpRuntime = { ...this.frpRuntime, state: 'stopping' }
    const pid = this.frpProc.pid
    this.logs.append('frp', 'system', `停止 FRP PID=${pid}`)
    killTree(pid)
    this.frpProc = null
    await new Promise((r) => setTimeout(r, 400))
    this.frpRuntime = emptyRuntime('stopped')
    return { ok: true, message: '已停止由本应用启动的 FRP' }
  }

  async startAll(): Promise<ActionResult> {
    const api = await this.startApi()
    if (!api.ok) return api
    const frp = await this.startFrp()
    await this.refreshProbes()
    if (!frp.ok) {
      return {
        ok: false,
        message: `API: ${api.message}；FRP: ${frp.message}`
      }
    }
    return { ok: true, message: '已启动 API 与 FRP' }
  }

  async stopAll(): Promise<ActionResult> {
    const frp = await this.stopFrp()
    const api = await this.stopApi()
    return {
      ok: true,
      message: `FRP: ${frp.message}；API: ${api.message}`
    }
  }

  async stopAppOwnedServices(): Promise<void> {
    await this.stopFrp()
    await this.stopApi()
  }

  getApiKeyMasked(): { masked: string; hasKey: boolean; rawLength: number } {
    const key = readApiKeyFromEnv(this.config.apiProjectDir)
    if (!key) return { masked: '', hasKey: false, rawLength: 0 }
    const masked =
      key.length <= 8
        ? '••••••••'
        : `${key.slice(0, 4)}${'•'.repeat(Math.min(key.length - 8, 24))}${key.slice(-4)}`
    return { masked, hasKey: true, rawLength: key.length }
  }

  getApiKeyRaw(): string {
    return readApiKeyFromEnv(this.config.apiProjectDir)
  }

  async updateApiKey(newKey: string, restart: boolean): Promise<ActionResult> {
    const key = newKey.trim()
    if (key.length < 8) {
      return { ok: false, message: 'API Key 至少 8 个字符' }
    }
    if (!this.config.apiProjectDir) {
      return { ok: false, message: '请先配置 API 项目目录' }
    }
    try {
      writeApiKeyToEnv(this.config.apiProjectDir, key)
      this.logs.append('system', 'system', '已更新项目 .env 中的 API_KEY')
      if (restart && this.apiRuntime.startedByApp) {
        await this.stopApi()
        const started = await this.startApi()
        return {
          ok: started.ok,
          message: started.ok ? '密钥已更新并重启 API' : `密钥已写入，但重启失败：${started.message}`,
          restartRequired: !started.ok
        }
      }
      return {
        ok: true,
        message: '密钥已写入 .env，请重启 API 使新密钥生效',
        restartRequired: true
      }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  createRandomApiKey(): string {
    return generateApiKey(32)
  }

  workflowInfo(): {
    path: string
    exists: boolean
    mtime?: string
    size?: number
  } {
    const path = resolveWorkflow(this.config) || ''
    if (!path || !existsSync(path)) {
      return { path, exists: false }
    }
    const st = statSync(path)
    return {
      path,
      exists: true,
      mtime: st.mtime.toISOString(),
      size: st.size
    }
  }
}
