import { Link, NavLink } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { Activity, ArrowDownLeft, ArrowUpRight, Building2, LayoutDashboard, Settings2, ShieldCheck, X } from 'lucide-react'
import { useAuthStore } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'

interface AppSidebarProps {
  open: boolean
  onClose: () => void
}

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Casa exata da rota — necessário para '/', que é prefixo de todas as demais. */
  end?: boolean
}

const groups: { label: string; items: NavItem[] }[] = [
  {
    label: 'Visão geral',
    // `end` é obrigatório aqui: sem ele o NavLink de '/' fica ativo em todas as rotas.
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    label: 'Operação',
    items: [
      { to: '/receitas', label: 'Receitas', icon: ArrowDownLeft },
      { to: '/despesas', label: 'Despesas', icon: ArrowUpRight },
      { to: '/fluxo', label: 'Fluxo de Caixa', icon: Activity },
    ],
  },
  {
    label: 'Obras',
    items: [{ to: '/fluxo-obras', label: 'Fluxo Obras', icon: Building2 }],
  },
  {
    label: 'Sistema',
    items: [{ to: '/config', label: 'Configurações', icon: Settings2 }],
  },
]

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

export function AppSidebar({ open, onClose }: AppSidebarProps) {
  const { user } = useAuthStore()

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Fechar navegação"
          className="fixed inset-0 z-40 bg-dark/45 md:hidden"
          onClick={onClose}
        />
      )}

      <aside
        aria-label="Navegação principal"
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[240px] -translate-x-full flex-col bg-sidebar text-white transition-transform duration-200 ease-out md:sticky md:top-0 md:h-screen md:translate-x-0',
          open && 'translate-x-0'
        )}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-5">
          <div>
            <Link
              to="/"
              onClick={onClose}
              className="block rounded-sm text-[17px] font-bold tracking-[-0.03em] transition-colors hover:text-brand"
            >
              Dashfinance<span className="text-brand">.</span>
            </Link>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">
              Sala de controle
            </p>
          </div>
          <button
            type="button"
            aria-label="Fechar navegação"
            className="rounded-md p-1.5 text-white/55 transition-colors hover:bg-white/10 hover:text-white md:hidden"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5" onClick={onClose}>
          {groups.map((group) => (
            <div key={group.label} className="mb-6 last:mb-0">
              <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/38">
                {group.label}
              </p>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) => cn(
                        'group flex items-center gap-3 rounded-md px-3 py-2.5 text-[13px] font-medium transition-colors',
                        isActive
                          ? 'bg-white text-dark shadow-sm'
                          : 'text-white/68 hover:bg-white/10 hover:text-white'
                      )}
                    >
                      {({ isActive }) => (
                        <>
                          <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-brand' : 'text-white/45 group-hover:text-white/80')} />
                          <span>{item.label}</span>
                        </>
                      )}
                    </NavLink>
                  )
                })}
              </div>
            </div>
          ))}

          {user?.is_admin && (
            <div className="mb-6">
              <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/38">Acesso</p>
              <NavLink
                to="/admin"
                className={({ isActive }) => cn(
                  'group flex items-center gap-3 rounded-md px-3 py-2.5 text-[13px] font-medium transition-colors',
                  isActive ? 'bg-white text-dark shadow-sm' : 'text-white/68 hover:bg-white/10 hover:text-white'
                )}
              >
                {({ isActive }) => (
                  <>
                    <ShieldCheck className={cn('h-4 w-4 shrink-0', isActive ? 'text-brand' : 'text-white/45 group-hover:text-white/80')} />
                    <span>Administração</span>
                  </>
                )}
              </NavLink>
            </div>
          )}
        </nav>

        <div className="border-t border-white/10 px-4 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-dark">
              {initials(user?.name ?? '?')}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-white">{user?.name ?? 'Usuário'}</p>
              <p className="truncate text-[10px] text-white/45">
                {user?.is_admin ? 'Administrador' : `${user?.empresas.length ?? 0} empresa(s)`}
              </p>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
