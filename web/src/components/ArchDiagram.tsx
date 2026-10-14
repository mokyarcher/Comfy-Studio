import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'

type NodeId = 'studio' | 'nginx' | 'frp' | 'api' | 'comfy' | 'gpu' | 'gateway'

type ArchNode = {
  id: NodeId
  label: string
  sub: string
  detail: string
  x: number
  y: number
}

const NODES: ArchNode[] = [
  {
    id: 'studio',
    label: 'Studio',
    sub: '远程客户端',
    detail: '登录、创作（文生图 / 改图 / 图生视频）、队列、画廊、展馆与提示词库。',
    x: 40,
    y: 40
  },
  {
    id: 'nginx',
    label: 'Nginx',
    sub: '公网 HTTPS',
    detail: '云端入口：TLS 终结与反向代理，不跑推理。',
    x: 220,
    y: 40
  },
  {
    id: 'frp',
    label: 'FRP',
    sub: '隧道',
    detail: '把本机 FastAPI 安全映射到云端，无需暴露局域网端口。',
    x: 400,
    y: 40
  },
  {
    id: 'api',
    label: 'FastAPI',
    sub: '本机 API',
    detail: '任务队列、鉴权、工作流注入、润色代理与展馆。',
    x: 220,
    y: 160
  },
  {
    id: 'comfy',
    label: 'ComfyUI',
    sub: '127.0.0.1:8188',
    detail: '仅本机访问。禁止把 8188 绑到公网。',
    x: 400,
    y: 160
  },
  {
    id: 'gpu',
    label: '本地 GPU',
    sub: '推理',
    detail: '所有生成都在这台机器的显卡上完成。',
    x: 580,
    y: 160
  },
  {
    id: 'gateway',
    label: 'Gateway',
    sub: '本机控制台',
    detail: '启停 API / frpc、用户审核、提示词库运维、本地占用 GPU。',
    x: 40,
    y: 160
  }
]

const EDGES: [NodeId, NodeId][] = [
  ['studio', 'nginx'],
  ['nginx', 'frp'],
  ['frp', 'api'],
  ['gateway', 'api'],
  ['api', 'comfy'],
  ['comfy', 'gpu']
]

function nodeCenter(n: ArchNode) {
  return { x: n.x + 70, y: n.y + 36 }
}

export function ArchDiagram({ autoPlay = true }: { autoPlay?: boolean }) {
  const [active, setActive] = useState<NodeId>('studio')
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (!autoPlay) return
    const order: NodeId[] = ['studio', 'nginx', 'frp', 'api', 'comfy', 'gpu', 'gateway']
    const id = window.setInterval(() => {
      setStep((s) => {
        const next = (s + 1) % order.length
        setActive(order[next])
        return next
      })
    }, 2200)
    return () => window.clearInterval(id)
  }, [autoPlay])

  const current = NODES.find((n) => n.id === active)!

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-panel/80">
      <div className="border-b border-border px-4 py-3 sm:px-5">
        <p className="text-sm font-medium text-text">全链路架构</p>
        <p className="text-xs text-muted">点击节点查看职责 · 推理永不离开本机</p>
      </div>

      <div className="relative hidden overflow-x-auto p-4 md:block">
        <svg viewBox="0 0 720 260" className="mx-auto h-auto w-full max-w-3xl">
          {EDGES.map(([from, to]) => {
            const a = NODES.find((n) => n.id === from)!
            const b = NODES.find((n) => n.id === to)!
            const p1 = nodeCenter(a)
            const p2 = nodeCenter(b)
            const lit = active === from || active === to
            return (
              <line
                key={`${from}-${to}`}
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke={lit ? '#3ddc97' : '#2a313c'}
                strokeWidth={lit ? 2 : 1.5}
                strokeOpacity={lit ? 0.85 : 0.7}
              />
            )
          })}
          {NODES.map((node) => {
            const on = node.id === active
            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                className="cursor-pointer"
                onClick={() => {
                  setActive(node.id)
                  setStep(NODES.findIndex((n) => n.id === node.id))
                }}
              >
                <rect
                  width="140"
                  height="72"
                  rx="8"
                  fill={on ? 'rgba(61,220,151,0.12)' : '#12151a'}
                  stroke={on ? '#3ddc97' : '#2a313c'}
                  strokeWidth={on ? 2 : 1}
                />
                <text x="12" y="30" fill="#e8e6e1" fontSize="14" fontWeight="600">
                  {node.label}
                </text>
                <text x="12" y="50" fill="#9a968c" fontSize="11">
                  {node.sub}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      <div className="flex flex-col gap-2 p-4 md:hidden">
        {NODES.map((node, i) => {
          const on = node.id === active
          return (
            <button
              key={node.id}
              type="button"
              onClick={() => {
                setActive(node.id)
                setStep(i)
              }}
              className={`rounded-lg border px-3 py-2.5 text-left transition ${
                on
                  ? 'border-accent/50 bg-accent/10'
                  : 'border-border bg-bg-elevated hover:border-accent/30'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-text">{node.label}</span>
                <span className="text-[11px] text-muted">{node.sub}</span>
              </div>
            </button>
          )
        })}
      </div>

      <div className="border-t border-border bg-bg-elevated/60 px-4 py-4 sm:px-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={current.id + String(step)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
          >
            <p className="text-sm font-medium text-accent">{current.label}</p>
            <p className="mt-1 text-sm text-muted">{current.detail}</p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
