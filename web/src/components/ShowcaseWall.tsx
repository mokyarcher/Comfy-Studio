import { motion } from 'motion/react'
import type { ShowcaseItem } from '../data/showcase'

type Props = {
  items: ShowcaseItem[]
}

export function ShowcaseWall({ items }: Props) {
  if (!items.length) {
    return (
      <div className="rounded-xl border border-dashed border-border px-6 py-16 text-center text-sm text-muted">
        样例作品即将上架。可先查看演示导览或部署自己的展馆。
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {items.map((item, i) => (
        <motion.figure
          key={item.id}
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-20px' }}
          transition={{ delay: Math.min(i * 0.04, 0.3), duration: 0.4 }}
          className="group overflow-hidden rounded-lg border border-border bg-panel"
        >
          <div className="aspect-square overflow-hidden bg-bg-elevated">
            {item.image ? (
              <img
                src={item.image}
                alt={item.prompt || '样例作品'}
                loading="lazy"
                className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
              />
            ) : (
              <div
                className="flex h-full w-full items-end p-3"
                style={{
                  background: `linear-gradient(145deg, ${item.tint || '#1a3d2e'}, #0b0d10 70%)`
                }}
              >
                <span className="text-[11px] text-muted">{item.modeLabel}</span>
              </div>
            )}
          </div>
          <figcaption className="space-y-1 p-3">
            <p className="line-clamp-2 text-xs text-text">{item.prompt}</p>
            <p className="text-[11px] text-muted">{item.modeLabel}</p>
          </figcaption>
        </motion.figure>
      ))}
    </div>
  )
}
