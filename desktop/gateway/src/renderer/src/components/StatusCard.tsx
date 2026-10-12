import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { ProbeResult, ServiceRuntime } from '../../../shared/types'

function stateText(runtime?: ServiceRuntime, probe?: ProbeResult): string {
  if (runtime?.state === 'starting') return '启动中'
  if (runtime?.state === 'stopping') return '正在停止'
  if (runtime?.state === 'error') return '异常'
  if (runtime?.state === 'running') return '运行中'
  if (probe?.ok) return '可达'
  if (probe?.state === 'down') return '不可达'
  if (runtime?.state === 'unconfigured') return '未配置'
  if (runtime?.state === 'stopped') return '已停止'
  return '状态未知'
}

function stateColor(runtime?: ServiceRuntime, probe?: ProbeResult): string {
  if (runtime?.state === 'error' || probe?.state === 'error') return 'text-danger'
  if (runtime?.state === 'starting' || runtime?.state === 'stopping') return 'text-warning'
  if (runtime?.state === 'running' || probe?.ok) return 'text-success'
  if (probe?.state === 'down') return 'text-danger'
  return 'text-muted'
}

interface Props {
  title: string
  icon: LucideIcon
  runtime?: ServiceRuntime
  probe?: ProbeResult
  detail: string
  actions?: ReactNode
}

export function StatusCard({ title, icon: Icon, runtime, probe, detail, actions }: Props) {
  const label = stateText(runtime, probe)
  const color = stateColor(runtime, probe)

  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <div className="font-medium text-text">{title}</div>
            <div className={`text-sm ${color}`}>{label}</div>
          </div>
        </div>
        {probe?.latencyMs != null && (
          <span className="text-xs text-muted">{probe.latencyMs} ms</span>
        )}
      </div>
      <p className="text-xs leading-relaxed text-muted">{detail}</p>
      {probe?.message && (
        <p className="truncate font-mono text-[11px] text-muted/80">{probe.message}</p>
      )}
      {actions && <div className="mt-auto flex flex-wrap gap-2 pt-1">{actions}</div>}
    </div>
  )
}
