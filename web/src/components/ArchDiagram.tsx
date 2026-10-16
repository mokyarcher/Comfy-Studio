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

const NODE_W = 140
const NODE_H = 72

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

type Pt = { x: number; y: number }
type Side = 'left' | 'right' | 'top' | 'bottom'

function portPoint(n: ArchNode, side: Side): Pt {
  const cx = n.x + NODE_W / 2
  const cy = n.y + NODE_H / 2
  switch (side) {
    case 'left':
      return { x: n.x, y: cy }
    case 'right':
      return { x: n.x + NODE_W, y: cy }
    case 'top':
      return { x: cx, y: n.y }
    case 'bottom':
      return { x: cx, y: n.y + NODE_H }
  }
}

/** Pick Comfy-like output → input sides from relative layout. */
function edgePorts(a: ArchNode, b: ArchNode): { from: Pt; to: Pt; fromSide: Side; toSide: Side } {
  const ac = { x: a.x + NODE_W / 2, y: a.y + NODE_H / 2 }
  const bc = { x: b.x + NODE_W / 2, y: b.y + NODE_H / 2 }
  const dx = bc.x - ac.x
  const dy = bc.y - ac.y

  let fromSide: Side
  let toSide: Side
  if (Math.abs(dx) >= Math.abs(dy) * 0.85) {
    fromSide = dx >= 0 ? 'right' : 'left'
    toSide = dx >= 0 ? 'left' : 'right'
  } else {
    fromSide = dy >= 0 ? 'bottom' : 'top'
    toSide = dy >= 0 ? 'top' : 'bottom'
  }

  return {
    from: portPoint(a, fromSide),
    to: portPoint(b, toSide),
    fromSide,
    toSide
  }
}

/** Cubic Bézier “noodle” — same idea as ComfyUI link curves. */
function noodlePath(from: Pt, to: Pt, fromSide: Side, toSide: Side) {
  const dist = Math.hypot(to.x - from.x, to.y - from.y)
  const pull = Math.max(dist * 0.45, 48)

  const ctrl = (p: Pt, side: Side, amount: number): Pt => {
    switch (side) {
      case 'left':
        return { x: p.x - amount, y: p.y }
      case 'right':
        return { x: p.x + amount, y: p.y }
      case 'top':
        return { x: p.x, y: p.y - amount }
      case 'bottom':
        return { x: p.x, y: p.y + amount }
    }
  }

  const c1 = ctrl(from, fromSide, pull)
  const c2 = ctrl(to, toSide, pull)
  return `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`
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
    <div className="glass-panel overflow-hidden rounded-xl">
      <div className="border-b border-white/10 px-4 py-3 sm:px-5">
        <p className="text-sm font-medium text-text">全链路架构</p>
        <p className="text-xs text-muted">点击节点查看职责 · 推理永不离开本机</p>
      </div>

      <div className="relative hidden overflow-x-auto p-4 md:block">
        <svg viewBox="0 0 720 260" className="mx-auto h-auto w-full max-w-3xl">
          <defs>
            <filter id="noodle-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {EDGES.map(([fromId, toId]) => {
            const a = NODES.find((n) => n.id === fromId)!
            const b = NODES.find((n) => n.id === toId)!
            const { from, to, fromSide, toSide } = edgePorts(a, b)
            const d = noodlePath(from, to, fromSide, toSide)
            const lit = active === fromId || active === toId
            return (
              <g key={`${fromId}-${toId}`}>
                {lit ? (
                  <path
                    d={d}
                    fill="none"
                    stroke="#3ddc97"
                    strokeWidth={6}
                    strokeOpacity={0.22}
                    strokeLinecap="round"
                  />
                ) : null}
                <path
                  d={d}
                  fill="none"
                  stroke={lit ? '#3ddc97' : '#3a4450'}
                  strokeWidth={lit ? 3 : 2.25}
                  strokeOpacity={lit ? 0.95 : 0.75}
                  strokeLinecap="round"
                  filter={lit ? 'url(#noodle-glow)' : undefined}
                />
                <circle
                  cx={from.x}
                  cy={from.y}
                  r={lit ? 4.5 : 3.5}
                  fill={lit ? '#3ddc97' : '#1a1f26'}
                  stroke={lit ? '#9AF5C8' : '#4a5562'}
                  strokeWidth={1.5}
                />
                <circle
                  cx={to.x}
                  cy={to.y}
                  r={lit ? 4.5 : 3.5}
                  fill={lit ? '#3ddc97' : '#1a1f26'}
                  stroke={lit ? '#9AF5C8' : '#4a5562'}
                  strokeWidth={1.5}
                />
              </g>
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
                  width={NODE_W}
                  height={NODE_H}
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
              className={`rounded-lg px-3 py-2.5 text-left transition ${
                on
                  ? 'bg-accent/15 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_45%,transparent)]'
                  : 'bg-white/[0.06] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] hover:bg-white/10'
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

      <div className="border-t border-white/10 bg-white/[0.04] px-4 py-4 sm:px-5">
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
