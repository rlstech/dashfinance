import { NavLink, useNavigate } from 'react-router-dom'
import { RefreshCw, Menu, LogOut, ShieldCheck } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useSync, useStatus } from '@/hooks/useFinanceiro'
import { useFilterStore } from '@/hooks/useFilters'
import { useAuthStore } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/receitas', label: 'Receitas' },
  { to: '/despesas', label: 'Despesas' },
  { to: '/fluxo', label: 'Fluxo de Caixa' },
  { to: '/fluxo-obras', label: 'Fluxo Obras' },
  { to: '/config', label: 'Configurações' },
]

export function TopHeader() {
  const { data: status } = useStatus()
  const sync = useSync()
  const toggleSidebar = useFilterStore((s) => s.toggleSidebar)
  const resetFilters = useFilterStore((s) => s.resetFilters)
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  function handleLogout() {
    logout()
    queryClient.clear()
    resetFilters()
    navigate('/login', { replace: true })
  }

  return (
    <header className="px-6 pt-4 pb-0 block-border-b bg-white flex flex-col md:flex-row justify-between items-start md:items-end sticky top-0 z-30 gap-2 md:gap-0">
      <div className="flex items-end gap-10">
        <div className="flex items-center gap-3 mb-3">
          <button
            className="md:hidden p-1 border-2 border-dark text-dark hover:bg-brand hover:text-white transition-colors"
            onClick={toggleSidebar}
          >
            <Menu className="h-4 w-4" />
          </button>
          <h1 className="text-2xl font-black tracking-tighter text-dark uppercase">
            Dashfinance<span className="text-brand">_</span>
          </h1>
        </div>

        <nav className="hidden md:flex gap-6 text-xs">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'font-black uppercase tracking-widest pb-3 transition-colors border-b-4',
                  isActive
                    ? 'text-dark border-brand'
                    : 'text-muted-foreground border-transparent hover:text-dark'
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
          {user?.is_admin && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                cn(
                  'font-black uppercase tracking-widest pb-3 transition-colors border-b-4',
                  isActive
                    ? 'text-dark border-brand'
                    : 'text-muted-foreground border-transparent hover:text-dark'
                )
              }
            >
              Admin
            </NavLink>
          )}
        </nav>
      </div>

      <div className="flex items-center gap-4 mb-3">
        {status?.last_sync && (
          <span className="text-xs text-muted-foreground hidden lg:inline-block font-medium">
            Atualizado {status.last_sync}
          </span>
        )}

        {user?.is_admin && (
          <button
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
            className="bg-dark text-white text-xs font-black uppercase tracking-widest px-4 py-2 hover:bg-brand hover:text-dark transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', sync.isPending && 'animate-spin')} />
            <span className="hidden sm:inline">Sincronizar</span>
          </button>
        )}

        <div className="flex items-center gap-2 border-2 border-dark px-3 py-1.5">
          {user?.is_admin && <ShieldCheck className="h-3.5 w-3.5 text-brand flex-shrink-0" />}
          <span className="text-xs font-black uppercase tracking-widest truncate max-w-[120px]" title={user?.name}>
            {user?.name ?? ''}
          </span>
          <button
            onClick={handleLogout}
            title="Sair"
            className="text-muted-foreground hover:text-brand transition-colors ml-1"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </header>
  )
}
