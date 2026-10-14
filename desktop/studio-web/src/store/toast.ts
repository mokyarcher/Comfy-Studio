import { create } from 'zustand'

type Toast = { id: string; message: string; tone?: 'info' | 'error' | 'success' }

type ToastState = {
  items: Toast[]
  push: (message: string, tone?: Toast['tone']) => void
  dismiss: (id: string) => void
}

export const useToast = create<ToastState>((set) => ({
  items: [],
  push: (message, tone = 'info') => {
    const id = crypto.randomUUID()
    set((s) => ({ items: [...s.items, { id, message, tone }] }))
    window.setTimeout(() => {
      set((s) => ({ items: s.items.filter((t) => t.id !== id) }))
    }, 4200)
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) }))
}))
