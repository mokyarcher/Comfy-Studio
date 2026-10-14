import { motion, useScroll, useTransform } from 'motion/react'
import { useRef } from 'react'
import { withBase } from '../lib/paths'

export function Hero() {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start start', 'end start']
  })
  const y = useTransform(scrollYProgress, [0, 1], [0, 80])
  const opacity = useTransform(scrollYProgress, [0, 0.85], [1, 0.35])

  return (
    <section ref={ref} className="relative min-h-[min(92vh,900px)] overflow-hidden">
      <motion.div style={{ y, opacity }} className="absolute inset-0">
        <HeroVisual />
      </motion.div>

      <div className="container-page relative flex min-h-[min(92vh,900px)] flex-col justify-end pb-16 pt-28 sm:justify-center sm:pb-24 sm:pt-20">
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-2xl"
        >
          <p className="eyebrow mb-4">Comfy Studio</p>
          <h1 className="display text-[clamp(2.75rem,7vw,4.75rem)] text-text">
            本地算力
            <br />
            <span className="text-accent">远程创作</span>
          </h1>
          <p className="mt-5 max-w-lg text-base text-muted sm:text-lg">
            Studio 远程创作，Gateway 管本机服务。推理始终在你的 GPU 上完成，云端只做入口与转发。
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={withBase('download')} className="btn-primary">
              下载客户端
            </a>
            <a href={withBase('deploy')} className="btn-secondary">
              看部署架构
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

function HeroVisual() {
  return (
    <div className="absolute inset-0" aria-hidden="true">
      <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/40 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-bg via-transparent to-bg/80" />
      <svg
        className="absolute right-[-8%] top-[8%] h-[85%] w-[70%] max-w-none opacity-90"
        viewBox="0 0 720 520"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#161a21" />
            <stop offset="100%" stopColor="#0f1217" />
          </linearGradient>
          <linearGradient id="glow" x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stopColor="#3ddc97" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#3ddc97" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x="40" y="40" width="640" height="420" rx="12" fill="url(#panel)" stroke="#2a313c" />
        <rect x="40" y="40" width="160" height="420" rx="12" fill="#12151a" stroke="#2a313c" />
        <rect x="64" y="72" width="112" height="10" rx="2" fill="#2a313c" />
        <rect x="64" y="100" width="88" height="8" rx="2" fill="#3ddc97" fillOpacity="0.55" />
        <rect x="64" y="124" width="96" height="8" rx="2" fill="#2a313c" />
        <rect x="64" y="148" width="72" height="8" rx="2" fill="#2a313c" />
        <rect x="64" y="172" width="100" height="8" rx="2" fill="#2a313c" />
        <rect x="220" y="72" width="420" height="28" rx="4" fill="#12151a" stroke="#2a313c" />
        <rect x="220" y="120" width="200" height="160" rx="6" fill="#0b0d10" stroke="#2a313c" />
        <rect x="440" y="120" width="200" height="160" rx="6" fill="#0b0d10" stroke="#2a313c" />
        <rect x="220" y="120" width="200" height="160" rx="6" fill="url(#glow)" />
        <rect x="220" y="300" width="420" height="120" rx="6" fill="#12151a" stroke="#2a313c" />
        <rect x="240" y="324" width="280" height="8" rx="2" fill="#2a313c" />
        <rect x="240" y="348" width="360" height="8" rx="2" fill="#2a313c" />
        <rect x="240" y="372" width="200" height="8" rx="2" fill="#3ddc97" fillOpacity="0.35" />
        <circle cx="620" cy="86" r="5" fill="#3ddc97" />
      </svg>
    </div>
  )
}
