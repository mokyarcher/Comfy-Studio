import { useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { Toast } from './components/Toast'
import { TopBar } from './components/TopBar'
import { ApiKeyPage } from './pages/ApiKeyPage'
import { LogsPage } from './pages/LogsPage'
import { OverviewPage } from './pages/OverviewPage'
import { PromptLibraryPage } from './pages/PromptLibraryPage'
import { PublicPage } from './pages/PublicPage'
import { ServicesPage } from './pages/ServicesPage'
import { SettingsPage } from './pages/SettingsPage'
import { ShowcasePage } from './pages/ShowcasePage'
import { UsersPage } from './pages/UsersPage'
import { WorkflowPage } from './pages/WorkflowPage'
import { useAppStore } from './stores/appStore'

export default function App() {
  const page = useAppStore((s) => s.page)
  const refreshStatus = useAppStore((s) => s.refreshStatus)
  const refreshLogs = useAppStore((s) => s.refreshLogs)
  const status = useAppStore((s) => s.status)
  const interval = status?.config.healthIntervalMs ?? 3000

  useEffect(() => {
    void refreshStatus()
    void refreshLogs()
  }, [refreshStatus, refreshLogs])

  useEffect(() => {
    let timer: number | undefined

    const tick = () => {
      if (document.visibilityState === 'visible') {
        void refreshStatus()
      }
    }

    timer = window.setInterval(tick, interval)

    const onFocus = () => void refreshStatus()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)

    return () => {
      if (timer) window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [refreshStatus, interval])

  return (
    <div className="flex h-full bg-bg text-text" style={{ backgroundColor: '#0f1419' }}>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col" style={{ backgroundColor: '#0f1419' }}>
        <TopBar />
        <main key={page} className="page-surface min-h-0 flex-1 overflow-auto p-5">
          {page === 'overview' && <OverviewPage />}
          {page === 'services' && <ServicesPage />}
          {page === 'users' && <UsersPage />}
          {page === 'showcase' && <ShowcasePage />}
          {page === 'prompts' && <PromptLibraryPage />}
          {page === 'workflow' && <WorkflowPage />}
          {page === 'public' && <PublicPage />}
          {page === 'apikey' && <ApiKeyPage />}
          {page === 'logs' && <LogsPage />}
          {page === 'settings' && <SettingsPage />}
        </main>
      </div>
      <Toast />
    </div>
  )
}
