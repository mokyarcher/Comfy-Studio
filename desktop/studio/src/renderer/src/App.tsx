import { useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { Toast } from './components/Toast'
import { TopBar } from './components/TopBar'
import { AuthPage } from './pages/AuthPage'
import { ConnectionPage } from './pages/ConnectionPage'
import { CreatePage } from './pages/CreatePage'
import { GalleryPage } from './pages/GalleryPage'
import { ShowcasePage } from './pages/ShowcasePage'
import { PromptsPage } from './pages/PromptsPage'
import { QueuePage } from './pages/QueuePage'
import { SettingsPage } from './pages/SettingsPage'
import { useAppStore } from './stores/appStore'

export default function App() {
  const page = useAppStore((s) => s.page)
  const loadBootstrap = useAppStore((s) => s.loadBootstrap)
  const bootstrapped = useAppStore((s) => s.bootstrapped)
  const isLoggedIn = useAppStore((s) => s.isLoggedIn)

  useEffect(() => {
    void loadBootstrap()
  }, [loadBootstrap])

  if (!bootstrapped) {
    return (
      <div className="flex h-full flex-col bg-bg text-text" style={{ backgroundColor: '#12141a' }}>
        <TitleBar />
        <div className="flex flex-1 items-center justify-center text-sm text-muted">加载中…</div>
        <Toast />
      </div>
    )
  }

  if (!isLoggedIn) {
    return (
      <div className="flex h-full flex-col bg-bg text-text" style={{ backgroundColor: '#12141a' }}>
        <TitleBar />
        <AuthPage />
        <Toast />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-bg text-text" style={{ backgroundColor: '#12141a' }}>
      <TitleBar />
      <div className="flex min-h-0 flex-1" style={{ backgroundColor: '#12141a' }}>
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col" style={{ backgroundColor: '#12141a' }}>
          <TopBar />
          <main key={page} className="page-surface min-h-0 flex-1 overflow-hidden">
            {page === 'create' && <CreatePage />}
            {page === 'queue' && <QueuePage />}
            {page === 'gallery' && <GalleryPage />}
            {page === 'showcase' && <ShowcasePage />}
            {page === 'prompts' && <PromptsPage />}
            {page === 'connection' && <ConnectionPage />}
            {page === 'settings' && <SettingsPage />}
          </main>
        </div>
      </div>
      <Toast />
    </div>
  )
}
