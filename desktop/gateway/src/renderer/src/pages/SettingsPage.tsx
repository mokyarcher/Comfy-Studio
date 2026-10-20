import { useConfigDraft } from '../hooks/useConfigDraft'

export function SettingsPage() {
  const { draft, set, save, browseDir, browseFile } = useConfigDraft()

  if (!draft) {
    return <div className="p-6 text-muted">正在加载配置…</div>
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="page-title">设置</h1>
        <p className="page-desc">路径、健康检查间隔。浏览选择后会自动保存。</p>
      </div>

      <section className="card space-y-4 p-5">
        <h2 className="font-medium">路径</h2>
        <PathField
          label="API 项目目录"
          hint="文件夹：…\comfyUI-api（含 app、.env）"
          value={draft.apiProjectDir}
          onChange={(v) => set('apiProjectDir', v)}
          onBrowse={() => void browseDir('apiProjectDir')}
        />
        <PathField
          label="Python"
          hint="文件：…\.venv\Scripts\python.exe（可留空）"
          value={draft.pythonPath}
          onChange={(v) => set('pythonPath', v)}
          onBrowse={() =>
            void browseFile('pythonPath', [{ name: 'Python', extensions: ['exe'] }])
          }
        />
        <PathField
          label="frpc.exe"
          hint="文件：…\frpc.exe"
          value={draft.frpcPath}
          onChange={(v) => set('frpcPath', v)}
          onBrowse={() => void browseFile('frpcPath', [{ name: 'frpc', extensions: ['exe'] }])}
        />
        <PathField
          label="FRP 配置"
          hint="文件：…\frpc.qwen-image.toml"
          value={draft.frpcConfigPath}
          onChange={(v) => set('frpcConfigPath', v)}
          onBrowse={() =>
            void browseFile('frpcConfigPath', [{ name: 'TOML', extensions: ['toml'] }])
          }
        />
        <PathField
          label="工作流 JSON"
          hint="文件：…\workflow_api.json（可留空用项目默认）"
          value={draft.workflowPath}
          onChange={(v) => set('workflowPath', v)}
          onBrowse={() =>
            void browseFile('workflowPath', [{ name: 'JSON', extensions: ['json'] }])
          }
        />
        <PathField
          label="ComfyUI 目录"
          hint="桌面版：含 main.py；便携版：ComfyUI_windows_portable（或外层安装夹）"
          value={draft.comfyUiDir}
          onChange={(v) => set('comfyUiDir', v)}
          onBrowse={() => void browseDir('comfyUiDir')}
        />
        <div>
          <label className="label">ComfyUI 启动命令</label>
          <p className="mb-1 text-xs text-muted">
            在解析后的目录执行。桌面版用 .venv；便携版用 python_embeded（可留默认，启动时会按目录类型自动校正）。勿写裸 python。
          </p>
          <input
            className="input font-mono text-sm"
            value={draft.comfyUiLaunch}
            onChange={(e) => set('comfyUiLaunch', e.target.value)}
            placeholder=".venv\Scripts\python.exe main.py --listen 127.0.0.1 --port 8188"
          />
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-medium">启动后自动拉起</h2>
        <p className="text-xs text-muted">
          打开 Gateway 时按勾选项启动（ComfyUI → API → FRP）。与「启动全部」无关，可独立勾选。
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-text">
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-primary)]"
              checked={draft.autoStartComfy}
              onChange={(e) => set('autoStartComfy', e.target.checked)}
            />
            ComfyUI
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-primary)]"
              checked={draft.autoStartApi}
              onChange={(e) => set('autoStartApi', e.target.checked)}
            />
            FastAPI
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-primary)]"
              checked={draft.autoStartFrp}
              onChange={(e) => set('autoStartFrp', e.target.checked)}
            />
            FRP
          </label>
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-medium">网络与探测</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label">ComfyUI URL</label>
            <input
              className="input"
              value={draft.comfyUrl}
              onChange={(e) => set('comfyUrl', e.target.value)}
            />
          </div>
          <div>
            <label className="label">公网 Base URL</label>
            <input
              className="input"
              value={draft.publicBaseUrl}
              onChange={(e) => set('publicBaseUrl', e.target.value)}
              placeholder="http://111.229.166.216:8080/qwen-image"
            />
          </div>
          <div>
            <label className="label">健康检查间隔 (ms)</label>
            <input
              className="input"
              type="number"
              min={1000}
              max={60000}
              value={draft.healthIntervalMs}
              onChange={(e) => set('healthIntervalMs', Number(e.target.value) || 3000)}
            />
          </div>
          <div>
            <label className="label">请求超时 (ms)</label>
            <input
              className="input"
              type="number"
              min={1000}
              max={120000}
              value={draft.requestTimeoutMs}
              onChange={(e) => set('requestTimeoutMs', Number(e.target.value) || 8000)}
            />
          </div>
        </div>
      </section>

      <div>
        <button className="btn-primary" onClick={() => void save()}>
          保存全部设置
        </button>
      </div>
    </div>
  )
}

function PathField({
  label,
  hint,
  value,
  onChange,
  onBrowse
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  onBrowse: () => void
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {hint && <p className="mb-1 text-xs text-muted">{hint}</p>}
      <div className="flex gap-2">
        <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />
        <button className="btn-secondary shrink-0" onClick={() => void onBrowse()}>
          浏览
        </button>
      </div>
    </div>
  )
}
