import {
  execFileSync,
  spawn,
  type ChildProcessWithoutNullStreams
} from 'child_process'
import { existsSync, statSync } from 'fs'
import { join } from 'path'
import type {
  ActionResult,
  GatewayConfig,
  GatewayStatus,
  ProbeResult,
  ServiceRuntime
} from '../shared/types'
import { resolveComfyInstall, resolveComfyLaunch } from './comfyResolve'
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
  source: 'api' | 'frp' | 'comfy',
  logs: RingLogBuffer
): void {
  proc.stdout.setEncoding('utf-8')
  proc.stderr.setEncoding('utf-8')
  proc.stdout.on('data', (chunk: string) => logs.append(source, 'stdout', chunk))
  proc.stderr.on('data', (chunk: string) => logs.append(source, 'stderr', chunk))
}

/** Parse listen port from ComfyUI URL (default 8188). */
function comfyListenPort(comfyUrl: string): number {
  try {
    const u = new URL(comfyUrl)
    if (u.port) return Number(u.port)
    return u.protocol === 'https:' ? 443 : 80
  } catch {
    return 8188
  }
}

function spawnShellCommand(
  command: string,
  cwd: string
): ChildProcessWithoutNullStreams {
  if (process.platform === 'win32') {
    return spawn('cmd.exe', ['/d', '/s', '/c', command], {
      cwd,
      windowsHide: true,
      env: { ...process.env }
    })
  }
  return spawn('bash', ['-lc', command], {
    cwd,
    env: { ...process.env }
  })
}

function killTree(pid: number): void {
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore'
      })
    } catch {
      /* already gone */
    }
  } else {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* ignore */
    }
  }
}

/** PIDs with a TCP LISTENING socket on the given port (Windows / Unix). */
function findListeningPids(port: number): number[] {
  const pids = new Set<number>()
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], {
        encoding: 'utf8',
        windowsHide: true
      })
      for (const line of out.split(/\r?\n/)) {
        if (!/LISTENING/i.test(line)) continue
        const parts = line.trim().split(/\s+/)
        if (parts.length < 4) continue
        const local = parts[1] || ''
        const m = local.match(/:(\d+)$/)
        if (!m || Number(m[1]) !== port) continue
        const pid = Number(parts[parts.length - 1])
        if (Number.isFinite(pid) && pid > 0) pids.add(pid)
      }
    } else {
      const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
        encoding: 'utf8'
      })
      for (const line of out.split(/\n/)) {
        const pid = Number(line.trim())
        if (Number.isFinite(pid) && pid > 0) pids.add(pid)
      }
    }
  } catch {
    /* none / tool missing */
  }
  return Array.from(pids)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export class ServiceManager {
  private config: GatewayConfig
  private apiProc: ChildProcessWithoutNullStreams | null = null
  private frpProc: ChildProcessWithoutNullStreams | null = null
  private comfyProc: ChildProcessWithoutNullStreams | null = null
  private apiRuntime: ServiceRuntime = emptyRuntime()
  private frpRuntime: ServiceRuntime = emptyRuntime()
  private comfyRuntime: ServiceRuntime = emptyRuntime()
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

    if (!this.comfyRuntime.startedByApp) {
      this.comfyRuntime = {
        ...this.comfyRuntime,
        state: comfy.ok ? 'running' : 'stopped',
        startedByApp: false
      }
    } else if (this.comfyRuntime.state === 'starting' && comfy.ok) {
      this.comfyRuntime = { ...this.comfyRuntime, state: 'running' }
    }
  }

  getStatus(): GatewayStatus {
    return {
      api: { ...this.apiRuntime },
      frp: { ...this.frpRuntime },
      comfyRuntime: { ...this.comfyRuntime },
      comfy: this.comfyProbe,
      localApi: this.localProbe,
      publicApi: this.publicProbe,
      config: this.config,
      resolvedPythonPath: resolvePython(this.config),
      resolvedWorkflowPath: resolveWorkflow(this.config)
    }
  }

  async startComfy(): Promise<ActionResult> {
    if (this.comfyProc && !this.comfyProc.killed) {
      return { ok: true, message: 'ComfyUI 已在运行（由本应用启动）' }
    }

    await this.refreshProbes()
    if (this.comfyProbe.ok) {
      const port = comfyListenPort(this.config.comfyUrl)
      const listeners = findListeningPids(port)
      this.comfyRuntime = {
        state: 'running',
        startedByApp: false,
        pid: listeners[0]
      }
      return {
        ok: true,
        message: `ComfyUI 已在线（${this.config.comfyUrl}），无需重复启动`
      }
    }

    const rawDir = this.config.comfyUiDir.trim()
    const install = resolveComfyInstall(rawDir)
    if (!install) {
      return {
        ok: false,
        message:
          '请先在设置中填写 ComfyUI 目录：桌面版选含 main.py 的文件夹；便携版可选 ComfyUI_windows_portable（或外层安装夹）'
      }
    }

    const configuredLaunch = (this.config.comfyUiLaunch || '').trim()
    const resolved = resolveComfyLaunch(install, configuredLaunch)
    let launch = resolved.launch
    if (resolved.rewrittenFrom !== undefined) {
      this.logs.append(
        'comfy',
        'system',
        `已按${install.kind === 'portable' ? '便携版' : '桌面版'}校正启动命令：${launch}`
      )
    }
    if (!launch) {
      return { ok: false, message: '请先配置 ComfyUI 启动命令' }
    }

    const dir = install.cwd

    const port = comfyListenPort(this.config.comfyUrl)
    const listeners = findListeningPids(port)
    if (listeners.length > 0) {
      return {
        ok: false,
        message: `端口 ${port} 已被占用（PID ${listeners.join(', ')}），但健康检查未通过。请先「强制停止」再启动。`
      }
    }

    this.comfyRuntime = {
      state: 'starting',
      startedByApp: true,
      startedAt: new Date().toISOString()
    }
    this.logs.append(
      'comfy',
      'system',
      `启动 ComfyUI（${install.kind}）：cwd=${dir} · ${launch}`
    )

    try {
      const proc = spawnShellCommand(launch, dir)
      this.comfyProc = proc
      this.comfyRuntime.pid = proc.pid
      attachProcessLogs(proc, 'comfy', this.logs)

      proc.on('exit', (code, signal) => {
        this.logs.append(
          'comfy',
          'system',
          `ComfyUI 进程退出 code=${code ?? 'null'} signal=${signal ?? 'null'}`
        )
        this.comfyProc = null
        this.comfyRuntime = {
          state: 'stopped',
          startedByApp: false,
          lastError: code && code !== 0 ? `退出码 ${code}` : undefined
        }
      })

      proc.on('error', (err) => {
        this.logs.append('comfy', 'stderr', `启动失败: ${err.message}`)
        this.comfyProc = null
        this.comfyRuntime = {
          state: 'error',
          startedByApp: false,
          lastError: err.message
        }
      })

      const ready = await this.waitComfyReady(90_000)
      if (ready) {
        this.comfyRuntime = { ...this.comfyRuntime, state: 'running', startedByApp: true }
        return { ok: true, message: 'ComfyUI 已启动并通过健康检查' }
      }
      return {
        ok: true,
        message: 'ComfyUI 进程已启动，健康检查尚未通过（模型加载较慢时可稍后点「检测」）'
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.comfyRuntime = { state: 'error', startedByApp: false, lastError: message }
      return { ok: false, message }
    }
  }

  private async waitComfyReady(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await this.refreshProbes()
      if (this.comfyProbe.ok) return true
      if (!this.comfyProc || this.comfyProc.killed) return false
      await sleep(2000)
    }
    await this.refreshProbes()
    return this.comfyProbe.ok
  }

  async stopComfy(): Promise<ActionResult> {
    return this.stopComfyInternal(false)
  }

  async forceStopComfy(): Promise<ActionResult> {
    return this.stopComfyInternal(true)
  }

  private async stopComfyInternal(forceByPort: boolean): Promise<ActionResult> {
    const port = comfyListenPort(this.config.comfyUrl)
    this.comfyRuntime = { ...this.comfyRuntime, state: 'stopping' }
    const killed = new Set<number>()

    if (this.comfyProc?.pid) {
      this.logs.append('comfy', 'system', `停止本应用启动的 ComfyUI PID=${this.comfyProc.pid}`)
      killTree(this.comfyProc.pid)
      killed.add(this.comfyProc.pid)
      this.comfyProc = null
    }

    const listeners = findListeningPids(port)
    if (listeners.length === 0 && killed.size === 0) {
      this.comfyRuntime = emptyRuntime('stopped')
      await this.refreshProbes()
      return {
        ok: true,
        message: forceByPort
          ? `端口 ${port} 上没有监听进程`
          : '没有由本应用启动的 ComfyUI，且端口空闲'
      }
    }

    for (const pid of listeners) {
      if (killed.has(pid)) continue
      this.logs.append('comfy', 'system', `按端口 ${port} 结束占用进程 PID=${pid}`)
      killTree(pid)
      killed.add(pid)
    }

    await sleep(800)
    const still = findListeningPids(port)
    if (still.length > 0 && forceByPort) {
      for (const pid of still) {
        this.logs.append('comfy', 'system', `再次强制结束 PID=${pid}`)
        killTree(pid)
      }
      await sleep(500)
    }

    this.comfyRuntime = emptyRuntime('stopped')
    await this.refreshProbes()
    const left = findListeningPids(port)
    if (left.length > 0) {
      return {
        ok: false,
        message: `已尝试停止，但端口 ${port} 仍被占用（PID ${left.join(', ')}）`
      }
    }
    return {
      ok: true,
      message: `已停止 ComfyUI（结束 PID ${Array.from(killed).join(', ')}，端口 ${port} 已释放）`
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

    const port = this.config.apiPort
    const listeners = findListeningPids(port)
    if (listeners.length > 0) {
      await this.refreshProbes()
      if (this.localProbe.ok) {
        this.apiRuntime = {
          state: 'running',
          startedByApp: false,
          pid: listeners[0]
        }
        return {
          ok: false,
          message: `端口 ${port} 已被占用（PID ${listeners.join(', ')}）。请先点「停止」或「强制停止」。`
        }
      }
      return {
        ok: false,
        message: `端口 ${port} 已被占用（PID ${listeners.join(', ')}），且健康检查未通过。请先「强制停止」再启动。`
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
    return this.stopApiInternal(false)
  }

  /** Kill tracked child and any process listening on the configured API port. */
  async forceStopApi(): Promise<ActionResult> {
    return this.stopApiInternal(true)
  }

  private async stopApiInternal(forceByPort: boolean): Promise<ActionResult> {
    const port = this.config.apiPort
    this.apiRuntime = { ...this.apiRuntime, state: 'stopping' }
    const killed = new Set<number>()

    if (this.apiProc?.pid) {
      this.logs.append('api', 'system', `停止本应用启动的 API PID=${this.apiProc.pid}`)
      killTree(this.apiProc.pid)
      killed.add(this.apiProc.pid)
      this.apiProc = null
    }

    const listeners = findListeningPids(port)
    if (listeners.length === 0 && killed.size === 0) {
      this.apiRuntime = emptyRuntime('stopped')
      await this.refreshProbes()
      return {
        ok: true,
        message: forceByPort
          ? `端口 ${port} 上没有监听进程`
          : '没有由本应用启动的 API，且端口空闲'
      }
    }

    // Always clear port listeners on stop (covers Gateway restart orphans).
    for (const pid of listeners) {
      if (killed.has(pid)) continue
      this.logs.append('api', 'system', `按端口 ${port} 结束占用进程 PID=${pid}`)
      killTree(pid)
      killed.add(pid)
    }

    await sleep(600)
    const still = findListeningPids(port)
    if (still.length > 0 && forceByPort) {
      for (const pid of still) {
        this.logs.append('api', 'system', `再次强制结束 PID=${pid}`)
        killTree(pid)
      }
      await sleep(400)
    }

    this.apiRuntime = emptyRuntime('stopped')
    await this.refreshProbes()
    const left = findListeningPids(port)
    if (left.length > 0) {
      return {
        ok: false,
        message: `已尝试停止，但端口 ${port} 仍被占用（PID ${left.join(', ')}）`
      }
    }
    return {
      ok: true,
      message: `已停止 API（结束 PID ${Array.from(killed).join(', ')}，端口 ${port} 已释放）`
    }
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

  /**
   * Respect per-service auto-start flags (Gateway launch / 开机自启).
   * Order: ComfyUI → API → FRP. Unchecked services are skipped.
   */
  async startOnLaunch(): Promise<ActionResult> {
    const { autoStartComfy, autoStartApi, autoStartFrp } = this.config
    if (!autoStartComfy && !autoStartApi && !autoStartFrp) {
      this.logs.append('system', 'system', '开机自启：未勾选任何服务，跳过')
      return { ok: true, message: '未勾选开机自启服务' }
    }

    const parts: string[] = []
    this.logs.append(
      'system',
      'system',
      `开机自启开始：ComfyUI=${autoStartComfy} API=${autoStartApi} FRP=${autoStartFrp}`
    )

    if (autoStartComfy) {
      const r = await this.startComfy()
      parts.push(`ComfyUI: ${r.message}`)
      if (!r.ok) {
        this.logs.append('system', 'system', `开机自启中断：${parts.join('；')}`)
        return { ok: false, message: parts.join('；') }
      }
    }
    if (autoStartApi) {
      const r = await this.startApi()
      parts.push(`API: ${r.message}`)
      if (!r.ok) {
        this.logs.append('system', 'system', `开机自启中断：${parts.join('；')}`)
        return { ok: false, message: parts.join('；') }
      }
    }
    if (autoStartFrp) {
      const r = await this.startFrp()
      parts.push(`FRP: ${r.message}`)
      if (!r.ok) {
        this.logs.append('system', 'system', `开机自启中断：${parts.join('；')}`)
        return { ok: false, message: parts.join('；') }
      }
    }

    await this.refreshProbes()
    const message = parts.join('；')
    this.logs.append('system', 'system', `开机自启完成：${message}`)
    return { ok: true, message }
  }

  async startAll(): Promise<ActionResult> {
    const comfy = await this.startComfy()
    if (!comfy.ok) return { ok: false, message: `ComfyUI: ${comfy.message}` }
    const api = await this.startApi()
    if (!api.ok) {
      return { ok: false, message: `ComfyUI: ${comfy.message}；API: ${api.message}` }
    }
    const frp = await this.startFrp()
    await this.refreshProbes()
    if (!frp.ok) {
      return {
        ok: false,
        message: `ComfyUI: ${comfy.message}；API: ${api.message}；FRP: ${frp.message}`
      }
    }
    return {
      ok: true,
      message: `ComfyUI / API / FRP 已启动（${comfy.message}）`
    }
  }

  async stopAll(): Promise<ActionResult> {
    const frp = await this.stopFrp()
    const api = await this.stopApi()
    const comfy = await this.stopComfy()
    return {
      ok: true,
      message: `FRP: ${frp.message}；API: ${api.message}；ComfyUI: ${comfy.message}`
    }
  }

  async stopAppOwnedServices(): Promise<void> {
    await this.stopFrp()
    await this.stopApi()
    await this.stopComfy()
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
