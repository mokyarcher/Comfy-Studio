import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Clapperboard,
  Images,
  Library,
  ListOrdered,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
  Wand2
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  comfyClearQueue,
  comfyFreeMemory,
  comfyInterrupt,
  fetchComfyCooldowns,
  fetchGpuStatus,
  fetchHostMetrics,
  formatHostMetricsChips,
  testConnection,
  type ComfyControlAction,
  type ComfyControlResult
} from '@/lib/api'
import { preloadBackground } from '@/lib/backgrounds'
import { useServerLimits } from '@/store/serverLimits'
import { useSession } from '@/store/session'
import { useSettings } from '@/store/settings'
import { useToast } from '@/store/toast'
import { ToastHost } from './ToastHost'
import { WorkspaceBackground } from './WorkspaceBackground'

const SIDEBAR_KEY = 'comfy-studio-web-sidebar-collapsed'

const nav = [
  { to: '/create', label: '开始创作', icon: Wand2 },
  { to: '/queue', label: '任务队列', icon: ListOrdered },
  { to: '/gallery', label: '作品画廊', icon: Images },
  { to: '/showcase', label: '作品展馆', icon: Clapperboard },
  { to: '/prompts', label: '提示词库', icon: Library },
  { to: '/settings', label: '参数设置', icon: Settings }
]

type PillBox = { top: number; left: number; width: number; height: number }

type ComfyActionId = 'interrupt' | 'clearQueue' | 'freeMemory'

type ComfyConfirm = {
  id: ComfyActionId
  title: string
  detail: string
  run: () => Promise<ComfyControlResult>
}

const EMPTY_COOLDOWNS: Record<ComfyActionId, number> = {
  interrupt: 0,
  clearQueue: 0,
  freeMemory: 0
}

const SERVER_TO_ACTION: Record<ComfyControlAction, ComfyActionId> = {
  interrupt: 'interrupt',
  clear_queue: 'clearQueue',
  free: 'freeMemory'
}

function untilFromRemaining(remainingSeconds: number): number {
  if (remainingSeconds <= 0) return 0
  return Date.now() + remainingSeconds * 1000
}

function untilFromIso(iso: string | null | undefined, remainingSeconds?: number): number {
  if (iso) {
    const t = Date.parse(iso)
    if (!Number.isNaN(t)) return t
  }
  return untilFromRemaining(remainingSeconds ?? 0)
}

function readPillBox(navEl: HTMLElement, itemEl: HTMLElement): PillBox {
  const navBox = navEl.getBoundingClientRect()
  const box = itemEl.getBoundingClientRect()
  return {
    top: box.top - navBox.top,
    left: box.left - navBox.left,
    width: box.width,
    height: box.height
  }
}

function applyPillBox(el: HTMLDivElement, box: PillBox) {
  el.style.top = `${box.top}px`
  el.style.left = `${box.left}px`
  el.style.width = `${box.width}px`
  el.style.height = `${box.height}px`
  el.style.transform = 'scale(1)'
}

export function Layout() {
  const user = useSession((s) => s.user)!
  const backgroundId = useSettings((s) => s.backgroundId)
  const setFromHealth = useServerLimits((s) => s.setFromHealth)
  const pushToast = useToast((s) => s.push)
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const asideRef = useRef<HTMLElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const indicatorRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef(new Map<string, HTMLAnchorElement>())
  const pillReadyRef = useRef(false)
  const pillAnimRef = useRef<Animation | null>(null)
  const [gpu, setGpu] = useState('—')
  const [hostChips, setHostChips] = useState<string[]>([])
  const [health, setHealth] = useState('检测中…')
  const [connected, setConnected] = useState(false)
  const [bgHint, setBgHint] = useState(false)
  const [comfyBusy, setComfyBusy] = useState(false)
  const [comfyConfirm, setComfyConfirm] = useState<ComfyConfirm | null>(null)
  const [comfyCooldownUntil, setComfyCooldownUntil] = useState(EMPTY_COOLDOWNS)
  const [comfyNow, setComfyNow] = useState(() => Date.now())
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0 })
  }, [location.pathname])

  // Remembered sessions skip /login — warm only the active full-res background.
  useEffect(() => {
    void preloadBackground(backgroundId)
  }, [backgroundId])

  const syncNavPill = (animate: boolean) => {
    const navEl = navRef.current
    const ind = indicatorRef.current
    if (!navEl || !ind) return

    const activePath = nav.find(
      (n) => location.pathname === n.to || location.pathname.startsWith(`${n.to}/`)
    )?.to
    const itemEl = activePath ? itemRefs.current.get(activePath) : undefined
    if (!itemEl) {
      ind.style.opacity = '0'
      return
    }
    ind.style.opacity = '1'

    const next = readPillBox(navEl, itemEl)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    pillAnimRef.current?.cancel()
    pillAnimRef.current = null

    if (!animate || !pillReadyRef.current || reduceMotion) {
      applyPillBox(ind, next)
      pillReadyRef.current = true
      return
    }

    const from: PillBox = {
      top: parseFloat(ind.style.top) || next.top,
      left: parseFloat(ind.style.left) || next.left,
      width: parseFloat(ind.style.width) || next.width,
      height: parseFloat(ind.style.height) || next.height
    }

    const same =
      Math.abs(from.top - next.top) < 0.5 &&
      Math.abs(from.left - next.left) < 0.5 &&
      Math.abs(from.width - next.width) < 0.5 &&
      Math.abs(from.height - next.height) < 0.5
    if (same) {
      applyPillBox(ind, next)
      return
    }

    const mid: PillBox = {
      top: (from.top + next.top) / 2,
      left: (from.left + next.left) / 2,
      width: (from.width + next.width) / 2,
      height: (from.height + next.height) / 2
    }
    // Collapsed icon rail is smaller — shrink more so the hop reads clearly
    const midScale = collapsed ? 0.58 : 0.72

    const anim = ind.animate(
      [
        {
          top: `${from.top}px`,
          left: `${from.left}px`,
          width: `${from.width}px`,
          height: `${from.height}px`,
          transform: 'scale(1)'
        },
        {
          top: `${mid.top}px`,
          left: `${mid.left}px`,
          width: `${mid.width}px`,
          height: `${mid.height}px`,
          transform: `scale(${midScale})`,
          offset: 0.48
        },
        {
          top: `${next.top}px`,
          left: `${next.left}px`,
          width: `${next.width}px`,
          height: `${next.height}px`,
          transform: 'scale(1)'
        }
      ],
      {
        duration: collapsed ? 480 : 460,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'forwards'
      }
    )
    pillAnimRef.current = anim
    anim.finished
      .then(() => {
        applyPillBox(ind, next)
        anim.cancel()
        if (pillAnimRef.current === anim) pillAnimRef.current = null
      })
      .catch(() => undefined)
  }

  // Route change: animate pill (expanded + collapsed icon rail)
  useLayoutEffect(() => {
    syncNavPill(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pathname hop only; collapse snaps separately
  }, [location.pathname])

  // Collapse/expand: width CSS-transitions; snap pill during + after so it never overflows
  useLayoutEffect(() => {
    const aside = asideRef.current
    syncNavPill(false)

    let raf = 0
    const tick = (start: number) => {
      syncNavPill(false)
      if (performance.now() - start < 240) {
        raf = requestAnimationFrame(() => tick(start))
      }
    }
    raf = requestAnimationFrame(() => tick(performance.now()))

    const onEnd = (e: TransitionEvent) => {
      if (e.target !== aside) return
      if (e.propertyName !== 'width') return
      syncNavPill(false)
    }
    aside?.addEventListener('transitionend', onEnd)
    return () => {
      cancelAnimationFrame(raf)
      aside?.removeEventListener('transitionend', onEnd)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed])

  useEffect(() => {
    const navEl = navRef.current
    if (!navEl || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      // Don't cancel an in-flight route hop (was snapping instantly, worse when collapsed)
      if (pillAnimRef.current) return
      syncNavPill(false)
    })
    ro.observe(navEl)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [collapsed])

  useEffect(() => {
    let alive = true
    const applySharedCd = async () => {
      const cd = await fetchComfyCooldowns({ apiKey: user.apiKey })
      if (!alive || !cd) return
      setComfyCooldownUntil({
        interrupt: untilFromIso(
          cd.actions.interrupt.cooldownUntil,
          cd.actions.interrupt.remainingSeconds
        ),
        clearQueue: untilFromIso(
          cd.actions.clear_queue.cooldownUntil,
          cd.actions.clear_queue.remainingSeconds
        ),
        freeMemory: untilFromIso(cd.actions.free.cooldownUntil, cd.actions.free.remainingSeconds)
      })
      setComfyNow(Date.now())
    }
    const tick = async () => {
      const [h, g, m] = await Promise.all([
        testConnection({ timeoutMs: 10_000 }),
        fetchGpuStatus({ apiKey: user.apiKey }),
        fetchHostMetrics({ apiKey: user.apiKey })
      ])
      if (!alive) return
      setConnected(h.ok)
      setHealth(h.ok ? `已连接 · ${h.latencyMs} ms` : h.message)
      setGpu(g.ok ? (g.state === 'idle' ? 'GPU 空闲' : 'GPU 繁忙') : g.message)
      setHostChips(formatHostMetricsChips(m))
      if (h.ok) {
        setFromHealth({
          maxSteps: h.maxSteps,
          maxWidth: h.maxWidth,
          maxHeight: h.maxHeight
        })
        void applySharedCd()
      }
    }
    tick()
    const id = window.setInterval(tick, 5_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [user.apiKey, setFromHealth])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') setBgHint(true)
      else setBgHint(false)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const comfyCdLeft = (id: ComfyActionId): number =>
    Math.max(0, Math.ceil((comfyCooldownUntil[id] - comfyNow) / 1000))

  useEffect(() => {
    const active = Object.values(comfyCooldownUntil).some((t) => t > Date.now())
    if (!active) return
    const tick = window.setInterval(() => setComfyNow(Date.now()), 250)
    return () => window.clearInterval(tick)
  }, [comfyCooldownUntil])

  const askComfyControl = (confirm: ComfyConfirm) => {
    if (comfyBusy || !connected || comfyCdLeft(confirm.id) > 0) return
    setComfyConfirm(confirm)
  }

  const applyResultCooldown = (res: ComfyControlResult, fallbackId: ComfyActionId) => {
    const actionId =
      res.action && res.action in SERVER_TO_ACTION
        ? SERVER_TO_ACTION[res.action as ComfyControlAction]
        : fallbackId
    const until = untilFromIso(res.cooldownUntil, res.cooldownRemainingSeconds)
    if (until <= 0 && res.ok) {
      // Server may omit fields on older API — fall back to 90s local estimate.
      setComfyCooldownUntil((prev) => ({ ...prev, [actionId]: Date.now() + 90_000 }))
    } else if (until > 0) {
      setComfyCooldownUntil((prev) => ({ ...prev, [actionId]: until }))
    }
    setComfyNow(Date.now())
  }

  const runComfyControl = async () => {
    if (!comfyConfirm || comfyBusy) return
    const pending = comfyConfirm
    if (comfyCdLeft(pending.id) > 0) {
      setComfyConfirm(null)
      return
    }
    setComfyConfirm(null)
    setComfyBusy(true)
    try {
      const res = await pending.run()
      pushToast(res.message || pending.title, res.ok ? 'success' : 'error')
      // Shared host CD from GPU API (all users). Also sync on 429.
      applyResultCooldown(res, pending.id)
    } finally {
      setComfyBusy(false)
    }
  }

  const interruptCd = comfyCdLeft('interrupt')
  const clearCd = comfyCdLeft('clearQueue')
  const freeCd = comfyCdLeft('freeMemory')

  return (
    <div
      className="workspace-shell flex h-full min-h-0"
      data-sidebar-collapsed={collapsed ? '1' : '0'}
      style={{ ['--sidebar-w' as string]: collapsed ? '3.5rem' : '13rem' }}
    >
      <WorkspaceBackground backgroundId={backgroundId} />
      <aside
        ref={asideRef}
        className={`glass-panel flex shrink-0 flex-col border-r border-white/10 transition-[width] duration-200 ${
          collapsed ? 'w-14' : 'w-52'
        }`}
      >
        <div
          className={`flex select-none items-center border-b border-border ${
            collapsed ? 'h-[4.5rem] flex-col justify-center gap-0.5 px-1 py-1' : 'h-12 gap-2 px-3'
          }`}
        >
          {!collapsed ? (
            <>
              <Link
                to="/home"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg outline-none transition hover:opacity-90 focus-visible:ring-1 focus-visible:ring-white/30"
                title="欢迎页"
                aria-label="Comfy Studio 欢迎页"
              >
                <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                <p className="truncate text-sm font-semibold text-text">
                  Comfy <span className="text-primary">Studio</span>
                </p>
              </Link>
              <button
                type="button"
                className="btn-ghost !h-7 !w-7 !p-0"
                title="收起"
                aria-label="收起导航"
                onClick={() => setCollapsed(true)}
              >
                <PanelLeftClose className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <>
              <Link
                to="/home"
                className="btn-ghost !h-8 !w-8 !p-0"
                title="欢迎页"
                aria-label="Comfy Studio 欢迎页"
              >
                <Sparkles className="h-4 w-4 text-primary" />
              </Link>
              <button
                type="button"
                className="btn-ghost !h-7 !w-7 !p-0"
                title="展开导航"
                aria-label="展开导航"
                onClick={() => setCollapsed(false)}
              >
                <PanelLeftOpen className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>

        <nav
          ref={navRef}
          className={`nav-rail flex flex-1 flex-col gap-1.5 py-3 ${collapsed ? 'px-1.5' : 'px-2.5'}`}
        >
          <div ref={indicatorRef} className="nav-pill-indicator" aria-hidden />
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              title={collapsed ? item.label : undefined}
              ref={(el) => {
                if (el) itemRefs.current.set(item.to, el)
                else itemRefs.current.delete(item.to)
              }}
              className={({ isActive }) =>
                `nav-pill ${isActive ? 'nav-pill-active' : ''} ${
                  collapsed ? 'justify-center px-0' : 'justify-center gap-2.5 px-3'
                }`
              }
            >
              <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
              {!collapsed ? <span className="truncate">{item.label}</span> : null}
            </NavLink>
          ))}
        </nav>

        {!collapsed ? (
          <div className="border-t border-border p-2">
            <p className="truncate px-2 py-1.5 text-[11px] text-muted">{user.name || user.username}</p>
          </div>
        ) : null}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass-panel flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 px-4 py-2 sm:px-5">
          <span className={`status-chip ${connected ? 'status-chip-ok' : ''}`}>{health}</span>
          <span className="status-chip">{gpu}</span>
          {hostChips.map((chip) => (
            <span key={chip} className="status-chip" title="本机 LibreHardwareMonitor">
              {chip}
            </span>
          ))}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              className="glass-cta-btn glass-cta-btn-sm"
              disabled={comfyBusy || !connected || interruptCd > 0}
              title={interruptCd > 0 ? `冷却中 ${interruptCd}s` : '打断 ComfyUI 当前任务'}
              onClick={() =>
                askComfyControl({
                  id: 'interrupt',
                  title: '打断当前任务？',
                  detail: '将请求打断 ComfyUI 正在执行的工作流。无任务在跑时通常无影响。',
                  run: () => comfyInterrupt({ apiKey: user.apiKey })
                })
              }
            >
              <span className="glass-cta-btn-label">
                {interruptCd > 0 ? `打断 ${interruptCd}s` : '打断'}
              </span>
            </button>
            <button
              type="button"
              className="glass-cta-btn glass-cta-btn-sm"
              disabled={comfyBusy || !connected || clearCd > 0}
              title={clearCd > 0 ? `冷却中 ${clearCd}s` : '清空 ComfyUI 等待队列'}
              onClick={() =>
                askComfyControl({
                  id: 'clearQueue',
                  title: '清空等待队列？',
                  detail: '将清空 ComfyUI 中尚未开始的排队任务，不影响已完成记录。',
                  run: () => comfyClearQueue({ apiKey: user.apiKey })
                })
              }
            >
              <span className="glass-cta-btn-label">
                {clearCd > 0 ? `清队列 ${clearCd}s` : '清队列'}
              </span>
            </button>
            <button
              type="button"
              className="glass-cta-btn glass-cta-btn-sm"
              disabled={comfyBusy || !connected || freeCd > 0}
              title={freeCd > 0 ? `冷却中 ${freeCd}s` : '卸载模型并清理执行缓存（释放显存）'}
              onClick={() =>
                askComfyControl({
                  id: 'freeMemory',
                  title: '清理显存？',
                  detail: '将卸载已加载模型并清理执行缓存。下次出图需重新加载，会稍慢。',
                  run: () =>
                    comfyFreeMemory({
                      apiKey: user.apiKey,
                      unloadModels: true,
                      freeMemory: true
                    })
                })
              }
            >
              <span className="glass-cta-btn-label">
                {freeCd > 0 ? `清显存 ${freeCd}s` : '清显存'}
              </span>
            </button>
          </div>
          {bgHint ? (
            <span className="status-chip border-warning/40 bg-warning/10 text-warning">
              标签页在后台时轮询可能变慢
            </span>
          ) : null}
        </header>
        <main ref={mainRef} className="workspace-main">
          <div key={location.pathname} className="page-enter">
            <div className="page-enter-veil" aria-hidden />
            <div className="page-enter-body">
              <Outlet />
            </div>
          </div>
        </main>
      </div>
      {comfyConfirm
        ? createPortal(
            <div
              className="glass-confirm-overlay"
              role="presentation"
              onClick={() => !comfyBusy && setComfyConfirm(null)}
            >
              <div
                className="glass-confirm"
                role="dialog"
                aria-modal="true"
                aria-labelledby="comfy-confirm-title"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 id="comfy-confirm-title" className="glass-confirm-title">
                  {comfyConfirm.title}
                </h2>
                <p className="glass-confirm-detail">{comfyConfirm.detail}</p>
                <div className="glass-confirm-actions">
                  <button
                    type="button"
                    className="glass-confirm-cancel"
                    disabled={comfyBusy}
                    onClick={() => setComfyConfirm(null)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="glass-confirm-ok"
                    disabled={comfyBusy}
                    onClick={() => void runComfyControl()}
                  >
                    确认
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      <ToastHost />
    </div>
  )
}
