import { Outlet, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { AppSidebar } from './AppSidebar'
import { TopHeader } from './TopHeader'
import { ErrorBoundary } from './ErrorBoundary'

export function MainLayout() {
  const [navOpen, setNavOpen] = useState(false)
  const location = useLocation()

  return (
    <div className="app-shell flex min-h-screen">
      <AppSidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <TopHeader onOpenNav={() => setNavOpen(true)} />
        <main className="min-h-0 flex-1 overflow-hidden">
          {/* key força remontar o boundary (limpando o erro) a cada troca de rota */}
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}
