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

export function modeLabel(mode?: string): string {
  switch (mode) {
    case 'image_edit':
      return '图像编辑'
    case 'image_to_video':
      return '图生视频'
    case 'txt2img':
      return '文生图'
    default:
      return mode || '文生图'
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
