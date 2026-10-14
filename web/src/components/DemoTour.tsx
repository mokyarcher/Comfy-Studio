import { motion } from 'motion/react'

const STEPS = [
  {
    title: 'Studio · 创作',
    body: '文生图、图编辑、图生视频。提示词可走网关 AI 润色，密钥只留服务端。'
  },
  {
    title: '队列与进度',
    body: '提交后拿到 task_id，客户端轮询状态；历史记录可带回画廊缩略图。'
  },
  {
    title: '画廊',
    body: '本机作品库：预览、收藏、复用参数、分享到展馆。'
  },
  {
    title: '展馆',
    body: '浏览账号下公开分享的作品，一键复用提示词与尺寸。'
  },
  {
    title: 'Gateway · 运维',
    body: '本机启停 FastAPI / frpc、用户审核、官方提示词库、本地占用 GPU。'
  }
]

export function DemoTour() {
  return (
    <ol className="space-y-4">
      {STEPS.map((step, i) => (
        <motion.li
          key={step.title}
          initial={{ opacity: 0, x: -12 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: '-30px' }}
          transition={{ delay: i * 0.05, duration: 0.4 }}
          className="flex gap-4 rounded-xl border border-border bg-panel/60 p-4"
        >
          <span className="display flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-accent/30 bg-accent/10 text-sm text-accent">
            {String(i + 1).padStart(2, '0')}
          </span>
          <div>
            <h3 className="text-base font-medium text-text">{step.title}</h3>
            <p className="mt-1 text-sm text-muted">{step.body}</p>
          </div>
        </motion.li>
      ))}
    </ol>
  )
}
