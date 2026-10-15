import { create } from 'zustand'
import { DEFAULT_SERVER_LIMITS, type ServerLimits } from '@/lib/limits'

type State = ServerLimits & {
  setFromHealth: (partial: Partial<ServerLimits>) => void
}

export const useServerLimits = create<State>((set, get) => ({
  ...DEFAULT_SERVER_LIMITS,
  setFromHealth: (partial) => {
    set({
      maxSteps: partial.maxSteps ?? get().maxSteps,
      maxWidth: partial.maxWidth ?? get().maxWidth,
      maxHeight: partial.maxHeight ?? get().maxHeight
    })
  }
}))
