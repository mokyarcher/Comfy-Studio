import { create } from 'zustand'
import type { LocalTask } from '@/lib/types'

const QUEUE_KEY = 'comfy-studio-web-queue'

type QueueState = {
  tasks: LocalTask[]
  hydrate: () => void
  upsert: (task: LocalTask) => void
  remove: (id: string) => void
  clearFinished: () => void
}

function persist(tasks: LocalTask[]) {
  try {
    const slim = tasks.slice(0, 40).map((t) => {
      const rest = { ...t }
      delete rest.previewUrl
      return rest
    })
    sessionStorage.setItem(QUEUE_KEY, JSON.stringify(slim))
  } catch {
    /* ignore */
  }
}

export const useQueue = create<QueueState>((set, get) => ({
  tasks: [],
  hydrate: () => {
    try {
      const raw = sessionStorage.getItem(QUEUE_KEY)
      if (!raw) return
      const tasks = JSON.parse(raw) as LocalTask[]
      set({ tasks: Array.isArray(tasks) ? tasks : [] })
    } catch {
      set({ tasks: [] })
    }
  },
  upsert: (task) => {
    const prev = get().tasks
    const i = prev.findIndex((t) => t.id === task.id)
    const tasks = i >= 0 ? prev.map((t, idx) => (idx === i ? task : t)) : [task, ...prev]
    persist(tasks)
    set({ tasks })
  },
  remove: (id) => {
    const tasks = get().tasks.filter((t) => t.id !== id)
    persist(tasks)
    set({ tasks })
  },
  clearFinished: () => {
    const tasks = get().tasks.filter((t) => t.status === 'queued' || t.status === 'running' || t.status === 'submitting' || t.status === 'waiting')
    persist(tasks)
    set({ tasks })
  }
}))
