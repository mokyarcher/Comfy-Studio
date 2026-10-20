import { create } from 'zustand'
import { maskApiKey } from '@/lib/url'

const SESSION_KEY = 'comfy-studio-web-session'
const REMEMBER_KEY = 'comfy-studio-web-remember'
const BASE_URL_KEY = 'comfy-studio-web-base-hint'

export type SessionUser = {
  apiKey: string
  username: string
  name?: string
  userId?: string
  email?: string
}

type SessionState = {
  user: SessionUser | null
  remember: boolean
  hydrated: boolean
  hydrate: () => void
  login: (user: SessionUser, remember: boolean) => void
  patchUser: (p: Partial<SessionUser>) => void
  logout: () => void
  setRemember: (v: boolean) => void
}

function readStored(): SessionUser | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(REMEMBER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SessionUser
    if (!parsed?.apiKey) return null
    return parsed
  } catch {
    return null
  }
}

function persistUser(user: SessionUser, remember: boolean) {
  const payload = JSON.stringify(user)
  sessionStorage.setItem(SESSION_KEY, payload)
  if (remember) localStorage.setItem(REMEMBER_KEY, payload)
  else localStorage.removeItem(REMEMBER_KEY)
}

export const useSession = create<SessionState>((set, get) => ({
  user: null,
  remember: Boolean(localStorage.getItem(REMEMBER_KEY)),
  hydrated: false,
  hydrate: () => {
    set({ user: readStored(), remember: Boolean(localStorage.getItem(REMEMBER_KEY)), hydrated: true })
  },
  login: (user, remember) => {
    persistUser(user, remember)
    set({ user, remember })
  },
  patchUser: (p) => {
    const cur = get().user
    if (!cur) return
    const next = { ...cur, ...p }
    persistUser(next, get().remember)
    set({ user: next })
  },
  logout: () => {
    sessionStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(REMEMBER_KEY)
    set({ user: null, remember: false })
  },
  setRemember: (v) => set({ remember: v })
}))

export function maskedKey(user: SessionUser | null): string {
  return user ? maskApiKey(user.apiKey) : ''
}

export function rememberBaseHint(url: string) {
  try {
    localStorage.setItem(BASE_URL_KEY, url)
  } catch {
    /* ignore */
  }
}
