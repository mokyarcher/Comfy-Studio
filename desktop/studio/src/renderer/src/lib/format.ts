export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (m <= 0) return `${s} 秒`
  return `${m} 分 ${s.toString().padStart(2, '0')} 秒`
}

export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'waiting':
      return '等待中'
    case 'submitting':
      return '已提交'
    case 'queued':
      return '排队中'
    case 'running':
      return '生成中'
    case 'succeeded':
      return '完成'
    case 'failed':
      return '失败'
    case 'cancelled':
      return '已取消'
    default:
      return status
  }
}

export function phaseText(status: string, phase?: string): string {
  if (phase === 'waiting') return '等待中…'
  if (phase === 'submitted') return '已提交，准备轮询…'
  if (phase === 'polling') {
    if (status === 'queued') return '远端排队中（GPU 一次只跑一人）…'
    if (status === 'running') return '轮到你了 · 正在生成…'
    return '轮询任务状态…'
  }
  if (phase === 'downloading') return '正在下载图片…'
  if (phase === 'done') return '完成'
  if (phase === 'failed') return '失败'
  switch (status) {
    case 'waiting':
      return '等待中…'
    case 'submitting':
      return '正在向服务器提交任务…'
    case 'queued':
      return '任务已入队，等待 GPU…'
    case 'running':
      return 'ComfyUI 正在生成…'
    case 'succeeded':
      return '生成完成'
    case 'failed':
      return '生成失败'
    default:
      return '处理中…'
  }
}
