import { Outlet } from 'react-router-dom'
import { useState } from 'react'
import { AppSidebar } from './AppSidebar'
import { TopHeader } from './TopHeader'

export function MainLayout() {
  const [navOpen, setNavOpen] = useState(false)

  return (
    <div className="app-shell flex min-h-screen">
      <AppSidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <TopHeader onOpenNav={() => setNavOpen(true)} />
        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
