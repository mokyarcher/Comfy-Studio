import { motion } from 'motion/react'
import type { ShowcaseItem } from '../data/showcase'
import { withBase } from '../lib/paths'
import { ShowcaseMarquee } from './ShowcaseMarquee'

type Props = {
  items?: ShowcaseItem[]
}

/** Standalone welcome hero — brand left, scrolling showcase right. */
export function Hero({ items = [] }: Props) {
  return (
    <section className="relative flex min-h-[calc(100vh-4rem)] flex-col justify-center overflow-hidden py-6 sm:py-8">
      <div className="container-welcome relative grid items-center gap-8 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-10 xl:gap-14">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 max-w-xl"
        >
          <p className="eyebrow mb-3">Comfy Studio</p>
          <h1 className="hero-glass-title display text-[clamp(2.5rem,6vw,4.25rem)]">
            本地算力
            <br />
            <span className="hero-glass-title-accent">远程创作</span>
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-muted sm:text-lg">
            通过本机 GPU 实现的远程创作。
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={withBase('intro')} className="btn-glass-liquid !px-7 !py-3.5 !text-base">
              了解产品
            </a>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          className="relative w-full lg:pl-2"
        >
          <ShowcaseMarquee items={items} />
        </motion.div>
      </div>
    </section>
  )
}
