import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { fetchMe, type AuthMe } from '@/lib/api'
import { DashboardPage } from '@/pages/DashboardPage'
import { LoginPage } from '@/pages/LoginPage'
import { UsersPage } from '@/pages/UsersPage'

function RequireAdmin({ children }: { children: (me: AuthMe) => ReactNode }) {
  const [me, setMe] = useState<AuthMe | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    fetchMe()
      .then((r) => {
        if (alive) setMe(r)
      })
      .catch(() => {
        if (alive) setMe(null)
      })
    return () => {
      alive = false
    }
  }, [])

  if (me === undefined) {
    return (
      <div className="flex min-h-full items-center justify-center text-sm text-muted">检测登录…</div>
    )
  }
  if (!me) return <Navigate to="/login" replace />
  return <>{children(me)}</>
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAdmin>
            {(me) => <Layout username={me.username || me.phone_masked || 'admin'} />}
          </RequireAdmin>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="users" element={<UsersPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
