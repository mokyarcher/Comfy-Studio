import { useNavigate } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { GlassButton } from '@/components/GlassButton'
import { useSession } from '@/store/session'

export function HomePage() {
  const navigate = useNavigate()
  const user = useSession((s) => s.user)
  const name = user?.name || user?.username || '创作者'

  return (
    <div className="page-fill flex flex-col">
      <section className="welcome-hero card relative flex flex-1 overflow-hidden px-6 py-12 sm:px-12 sm:py-16">
        <div className="welcome-hero-glow" aria-hidden />
        <div className="relative z-[1] mx-auto flex w-full max-w-2xl flex-col items-center justify-center text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/20 shadow-[0_0_0_1px_rgba(255,255,255,0.18)_inset]">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <p className="text-sm text-muted">欢迎回来，{name}</p>
          <h1 className="mt-2 text-[clamp(1.85rem,4.5vw,2.85rem)] font-semibold tracking-tight text-text">
            Comfy <span className="text-primary">Studio</span> Web
          </h1>
          <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted sm:text-[15px]">
            跨系统远程创作工作空间。推理仍在本机 GPU，浏览器只负责连接、创作与管理作品。
          </p>
          <ul className="welcome-intro mt-8 w-full max-w-md space-y-3 text-left text-[13px] leading-relaxed text-muted sm:text-sm">
            <li>
              <span className="text-text/90">创作</span>
              — 文生图、图编辑、图生视频；提示词可走网关 AI 润色。
            </li>
            <li>
              <span className="text-text/90">队列与画廊</span>
              — 任务进度可查，结果保存在本机浏览器。
            </li>
            <li>
              <span className="text-text/90">展馆与提示词库</span>
              — 浏览共享作品，复用官方 / 本地 / 共享模板。
            </li>
          </ul>
          <div className="mt-10 w-full max-w-sm">
            <GlassButton className="!min-h-[3.25rem] !text-base !font-semibold" onClick={() => navigate('/create')}>
              立即开始
            </GlassButton>
          </div>
        </div>
      </section>
    </div>
  )
}
