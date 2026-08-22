import { useLocation, useNavigate } from 'react-router-dom'
import { LogOut, Menu, RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useSync, useStatus } from '@/hooks/useFinanceiro'
import { useFilterStore } from '@/hooks/useFilters'
import { useAuthStore } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'
import { ThemeToggle } from './ThemeToggle'

interface TopHeaderProps {
  onOpenNav: () => void
}

const pageMeta: Record<string, { title: string; section: string }> = {
  '/': { title: 'Dashboard', section: 'Visão geral' },
  '/receitas': { title: 'Receitas', section: 'Operação' },
  '/despesas': { title: 'Despesas', section: 'Operação' },
  '/fluxo': { title: 'Fluxo de Caixa', section: 'Operação' },
  '/fluxo-obras': { title: 'Fluxo Obras', section: 'Obras' },
  '/config': { title: 'Configurações', section: 'Sistema' },
  '/admin': { title: 'Administração', section: 'Acesso' },
}

function formatDateRange(start: string, end: string) {
  if (!start || !end) return 'Período completo'
  const fmt = (value: string) => value.split('-').reverse().join('/')
  return `${fmt(start)} a ${fmt(end)}`
}

export function TopHeader({ onOpenNav }: TopHeaderProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const sync = useSync()
  const { data: status } = useStatus()
  const filters = useFilterStore()
  const { user, logout } = useAuthStore()
  const queryClient = useQueryClient()
  const meta = pageMeta[location.pathname] ?? { title: 'DashFinance', section: 'Sistema' }

  function handleLogout() {
    logout()
    queryClient.clear()
    filters.resetFilters()
    navigate('/login', { replace: true })
  }

  const scope = filters.empresas.length > 0 ? filters.empresas.join(', ') : 'Todas as empresas'

  return (
    <header className="sticky top-0 z-30 flex min-h-[72px] items-center justify-between gap-4 border-b border-line bg-card/95 px-4 backdrop-blur md:px-7">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          aria-label="Abrir navegação"
          className="rounded-md border border-line p-2 text-muted-foreground transition-colors hover:border-brand hover:text-dark md:hidden"
          onClick={onOpenNav}
        >
          <Menu className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
            <span>{meta.section}</span>
            <span className="text-line">/</span>
            <span className="text-brand">Escopo ativo</span>
          </div>
          <h1 className="truncate text-[16px] font-semibold tracking-[-0.02em] text-dark md:text-[18px]">{meta.title}</h1>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 md:gap-4">
        <div className="hidden min-w-0 text-right lg:block">
          <p className="max-w-[260px] truncate text-xs font-semibold text-dark" title={scope}>{scope}</p>
          <p className="text-[10px] text-muted-foreground">{formatDateRange(filters.dtInicio, filters.dtFim)}</p>
        </div>

        <div className="hidden items-center gap-2 text-[10px] text-muted-foreground xl:flex">
          <span className={cn('h-2 w-2 rounded-full', status?.last_sync ? 'bg-positive' : 'bg-muted-foreground/40')} />
          <span>{status?.last_sync ? `Atualizado ${status.last_sync}` : 'Sem sincronização'}</span>
        </div>

        <ThemeToggle />

        {user?.is_admin && (
          <button
            type="button"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
            className="hidden items-center gap-2 rounded-md bg-dark px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand hover:text-dark disabled:opacity-50 sm:flex"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', sync.isPending && 'animate-spin')} />
            <span>{sync.isPending ? 'Sincronizando' : 'Sincronizar'}</span>
          </button>
        )}

        <div className="flex items-center gap-2 border-l border-line pl-2 md:pl-4">
          <span className="hidden max-w-[120px] truncate text-xs font-semibold text-dark sm:inline" title={user?.name}>
            {user?.name ?? ''}
          </span>
          <button
            type="button"
            onClick={handleLogout}
            title="Sair"
            aria-label="Sair"
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-red-50 hover:text-negative"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  )
}
