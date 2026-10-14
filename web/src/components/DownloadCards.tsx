import { motion } from 'motion/react'
import type { ReleasesManifest } from '../data/releases'

const GH = 'https://github.com/mokyarcher/Comfy-Studio/releases'

type Props = {
  releases: ReleasesManifest
}

export function DownloadCards({ releases }: Props) {
  const apps = [
    {
      key: 'studio' as const,
      name: 'Comfy Studio',
      blurb: '远程创作客户端：文生图、改图、图生视频、画廊与展馆。',
      req: 'Windows 10/11 · 需可访问的 Gateway / API'
    },
    {
      key: 'gateway' as const,
      name: 'Comfy Gateway',
      blurb: '本机控制台：启停 FastAPI / frpc、用户与监控、提示词库。',
      req: 'Windows 10/11 · 本机需已配置 ComfyUI 与 API'
    }
  ]

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {apps.map((app, i) => {
        const asset = releases.apps[app.key]
        const hasFile = Boolean(asset?.url)
        return (
          <motion.article
            key={app.key}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.45 }}
            className="flex flex-col rounded-xl border border-border bg-panel/70 p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="display text-2xl text-text">{app.name}</h2>
              <span className="rounded-md border border-border bg-bg-elevated px-2 py-0.5 font-mono text-xs text-accent">
                {asset?.version || releases.tag || 'latest'}
              </span>
            </div>
            <p className="mt-3 text-sm text-muted">{app.blurb}</p>
            <p className="mt-2 text-xs text-muted">{app.req}</p>
            {asset?.name ? (
              <p className="mt-3 truncate font-mono text-[11px] text-muted/80">{asset.name}</p>
            ) : null}
            <div className="mt-auto flex flex-wrap gap-2 pt-6">
              {hasFile ? (
                <motion.a
                  href={asset!.url}
                  className="btn-primary"
                  whileTap={{ scale: 0.98 }}
                  whileHover={{ y: -1 }}
                >
                  下载 Windows 包
                </motion.a>
              ) : (
                <a href={GH} className="btn-primary" target="_blank" rel="noopener noreferrer">
                  前往 GitHub Releases
                </a>
              )}
              <a href={GH} className="btn-secondary" target="_blank" rel="noopener noreferrer">
                全部版本
              </a>
            </div>
          </motion.article>
        )
      })}
    </div>
  )
}
