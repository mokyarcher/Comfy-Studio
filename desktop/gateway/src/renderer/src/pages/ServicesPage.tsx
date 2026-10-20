import { useConfigDraft } from '../hooks/useConfigDraft'
import { useAppStore } from '../stores/appStore'

export function ServicesPage() {
  const busy = useAppStore((s) => s.busy)
  const runAction = useAppStore((s) => s.runAction)
  const { draft, set, save, browseDir, browseFile, status } = useConfigDraft()

  if (!draft) {
    return <div className="p-6 text-muted">正在加载配置…</div>
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div>
        <h1 className="page-title">服务管理</h1>
        <p className="page-desc">配置路径并分别启停 ComfyUI / FastAPI / FRP（仅管理本应用启动的进程）</p>
      </div>

      <div className="rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm text-muted">
        <p className="font-medium text-accent">路径要选到哪一级？</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <b>ComfyUI 目录</b>：桌面版选含 <code className="text-text">main.py</code>；便携版选{' '}
            <code className="text-text">ComfyUI_windows_portable</code>（内有{' '}
            <code className="text-text">python_embeded</code> /{' '}
            <code className="text-text">run_nvidia_gpu.bat</code>），也可选外层安装夹
          </li>
          <li>
            <b>API 项目目录</b>：选到含 <code className="text-text">app</code> 文件夹的那一层，例如{' '}
            <code className="text-text">D:\projects\comfyUI-api</code>（里面应有 app、.env、workflow_api.json）
          </li>
          <li>
            <b>Python</b>：选具体文件{' '}
            <code className="text-text">...\comfyUI-api\.venv\Scripts\python.exe</code>（可留空自动找）
          </li>
          <li>
            <b>frpc.exe</b>：选具体文件，例如{' '}
            <code className="text-text">C:\...\frp_0.71.0_windows_amd64\frpc.exe</code>
          </li>
          <li>
            <b>FRP 配置</b>：选具体 toml 文件，例如{' '}
            <code className="text-text">...\frpc.qwen-image.toml</code>
          </li>
        </ul>
        <p className="mt-2 text-xs">用「浏览」选择后会自动保存；手动改文字后请点「保存配置」。</p>
      </div>

      <section className="card space-y-4 p-5">
        <h2 className="font-medium text-text">ComfyUI</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Field
            label="ComfyUI 目录"
            hint="桌面版含 main.py；便携版选 portable 根目录"
            value={draft.comfyUiDir}
            onChange={(v) => set('comfyUiDir', v)}
            onBrowse={() => void browseDir('comfyUiDir')}
          />
          <div className="md:col-span-2">
            <label className="label">启动命令</label>
            <p className="mb-1 text-xs text-muted">
              桌面版用 .venv；便携版用 python_embeded（可留默认，启动时自动校正），勿用系统 python
            </p>
            <input
              className="input font-mono text-sm"
              value={draft.comfyUiLaunch}
              onChange={(e) => set('comfyUiLaunch', e.target.value)}
              placeholder=".venv\Scripts\python.exe main.py --listen 127.0.0.1 --port 8188"
            />
          </div>
          <div>
            <label className="label">探测 URL</label>
            <input
              className="input"
              value={draft.comfyUrl}
              onChange={(e) => set('comfyUrl', e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => void save()}>
            保存配置
          </button>
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => void runAction(() => window.gateway.startComfy())}
          >
            启动 ComfyUI
          </button>
          <button
            className="btn-secondary"
            disabled={busy}
            onClick={() => void runAction(() => window.gateway.stopComfy())}
          >
            停止
          </button>
          <button
            className="btn-danger"
            disabled={busy}
            onClick={() => void runAction(() => window.gateway.forceStopComfy())}
          >
            强制停止
          </button>
          <button
            className="btn-accent"
            onClick={() =>
              void runAction(() =>
                window.gateway.testComfy().then((r) => ({ ok: r.ok, message: r.message }))
              )
            }
          >
            健康检查
          </button>
        </div>
        <StatusLine
          label="状态"
          value={`${status?.comfyRuntime?.state ?? 'unknown'} · PID ${
            status?.comfyRuntime?.pid ?? '-'
          } · ${status?.comfyRuntime?.startedByApp ? '本应用启动' : '外部/未知'} · 探测 ${
            status?.comfy?.ok ? '在线' : '不可达'
          }`}
        />
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-medium text-text">FastAPI</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Field
            label="API 项目目录"
            hint="选文件夹：comfyUI-api（不是 app 里面）"
            value={draft.apiProjectDir}
            onChange={(v) => set('apiProjectDir', v)}
            onBrowse={() => void browseDir('apiProjectDir')}
          />
          <Field
            label="Python 路径"
            hint="选文件：python.exe（可留空）"
            value={draft.pythonPath}
            placeholder={status?.resolvedPythonPath || '.venv\\Scripts\\python.exe'}
            onChange={(v) => set('pythonPath', v)}
            onBrowse={() =>
              void browseFile('pythonPath', [
                { name: 'Python', extensions: ['exe'] },
                { name: 'All', extensions: ['*'] }
              ])
            }
          />
          <div>
            <label className="label">Host</label>
            <input
              className="input"
              value={draft.apiHost}
              onChange={(e) => set('apiHost', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Port</label>
            <input
              className="input"
              type="number"
              value={draft.apiPort}
              onChange={(e) => set('apiPort', Number(e.target.value) || 8000)}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => void save()}>
            保存配置
          </button>
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => void runAction(() => window.gateway.startApi())}
          >
            启动 API
          </button>
          <button
            className="btn-secondary"
            disabled={busy}
            onClick={() => void runAction(() => window.gateway.stopApi())}
          >
            停止 API
          </button>
          <button
            className="btn-danger"
            disabled={busy}
            title="结束占用 API 端口的进程（含 Gateway 重启后残留）"
            onClick={() => void runAction(() => window.gateway.forceStopApi())}
          >
            强制停止
          </button>
          <button
            className="btn-accent"
            onClick={() =>
              void runAction(() =>
                window.gateway.testLocalApi().then((r) => ({ ok: r.ok, message: r.message }))
              )
            }
          >
            健康检查
          </button>
        </div>
        <StatusLine
          label="状态"
          value={`${status?.api.state ?? 'unknown'} · PID ${status?.api.pid ?? '-'} · ${
            status?.api.startedByApp ? '本应用启动' : '外部/未知'
          }`}
        />
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-medium text-text">FRP 客户端</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Field
            label="frpc.exe"
            hint="选文件：frpc.exe"
            value={draft.frpcPath}
            onChange={(v) => set('frpcPath', v)}
            onBrowse={() =>
              void browseFile('frpcPath', [
                { name: 'frpc', extensions: ['exe'] },
                { name: 'All', extensions: ['*'] }
              ])
            }
          />
          <Field
            label="配置文件（toml）"
            hint="选文件：frpc.qwen-image.toml"
            value={draft.frpcConfigPath}
            onChange={(v) => set('frpcConfigPath', v)}
            onBrowse={() =>
              void browseFile('frpcConfigPath', [
                { name: 'TOML', extensions: ['toml'] },
                { name: 'All', extensions: ['*'] }
              ])
            }
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => void save()}>
            保存配置
          </button>
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => void runAction(() => window.gateway.startFrp())}
          >
            启动 FRP
          </button>
          <button
            className="btn-danger"
            disabled={busy}
            onClick={() => void runAction(() => window.gateway.stopFrp())}
          >
            停止 FRP
          </button>
        </div>
        <StatusLine
          label="状态"
          value={`${status?.frp.state ?? 'unknown'} · PID ${status?.frp.pid ?? '-'} · ${
            status?.frp.startedByApp ? '本应用启动' : '未由本应用启动'
          }`}
        />
      </section>
    </div>
  )
}

function Field({
  label,
  hint,
  value,
  onChange,
  onBrowse,
  placeholder
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  onBrowse?: () => void
  placeholder?: string
}) {
  return (
    <div className="md:col-span-2">
      <label className="label">{label}</label>
      {hint && <p className="mb-1 text-xs text-muted">{hint}</p>}
      <div className="flex gap-2">
        <input
          className="input"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        {onBrowse && (
          <button className="btn-secondary shrink-0" onClick={() => void onBrowse()}>
            浏览
          </button>
        )}
      </div>
    </div>
  )
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg-deep px-3 py-2 text-xs text-muted">
      <span className="text-accent">{label}：</span>
      {value}
    </div>
  )
}
