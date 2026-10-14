import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { AuthPage } from '@/pages/AuthPage'
import { CreatePage } from '@/pages/CreatePage'
import { GalleryPage } from '@/pages/GalleryPage'
import { PromptsPage } from '@/pages/PromptsPage'
import { QueuePage } from '@/pages/QueuePage'
import { SettingsPage } from '@/pages/SettingsPage'
import { ShowcasePage } from '@/pages/ShowcasePage'
import { useQueue } from '@/store/queue'
import { useSession } from '@/store/session'
import { useSettings } from '@/store/settings'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = useSession((s) => s.user)
  const hydrated = useSession((s) => s.hydrated)
  if (!hydrated) return null
  if (!user) return <Navigate to="/login" replace />
  return children
}

export function App() {
  const hydrateSession = useSession((s) => s.hydrate)
  const hydrateQueue = useQueue((s) => s.hydrate)
  const hydrateSettings = useSettings((s) => s.hydrate)

  useEffect(() => {
    hydrateSession()
    hydrateQueue()
    hydrateSettings()
  }, [hydrateSession, hydrateQueue, hydrateSettings])

  useEffect(() => {
    const raw = sessionStorage.getItem('comfy-studio-web-apply-prompt')
    if (!raw) return
    /* CreatePage reads this on mount via storage event / first visit */
  }, [])

  return (
    <Routes>
      <Route path="/login" element={<AuthPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/create" replace />} />
        <Route path="create" element={<CreatePage />} />
        <Route path="queue" element={<QueuePage />} />
        <Route path="gallery" element={<GalleryPage />} />
        <Route path="showcase" element={<ShowcasePage />} />
        <Route path="prompts" element={<PromptsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
