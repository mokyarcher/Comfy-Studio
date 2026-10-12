import { Minus, Square, X } from 'lucide-react'

export function TitleBar() {
  return (
    <header className="titlebar flex h-9 shrink-0 items-center justify-between border-b border-border bg-[#0c0e14] px-3">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="font-semibold text-text">
          Comfy <span className="text-primary">Studio</span>
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button
          className="flex h-7 w-9 items-center justify-center rounded-md text-muted hover:bg-panel-elevated hover:text-text"
          onClick={() => void window.studio.windowMinimize()}
          title="最小化"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          className="flex h-7 w-9 items-center justify-center rounded-md text-muted hover:bg-panel-elevated hover:text-text"
          onClick={() => void window.studio.windowMaximize()}
          title="最大化"
        >
          <Square className="h-3 w-3" />
        </button>
        <button
          className="flex h-7 w-9 items-center justify-center rounded-md text-muted hover:bg-danger/20 hover:text-danger"
          onClick={() => void window.studio.windowClose()}
          title="关闭"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  )
}
