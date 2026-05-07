import { NavLink } from 'react-router-dom'
import { useFilterStore } from '@/hooks/useFilters'
import { useFilterTree } from '@/hooks/useFinanceiro'
import { useAuthStore } from '@/hooks/useAuth'
import { MultiSelect } from './MultiSelect'
import { DateRangeSelector } from './DateRangeSelector'
import { RotateCcw, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FilterSidebarProps {
  showOrigem?: boolean
  showStatus?: boolean
  showVis?: boolean
}

const navItems = [
  { to: '/receitas', label: 'Receitas' },
  { to: '/despesas', label: 'Despesas' },
  { to: '/fluxo', label: 'Fluxo de Caixa' },
  { to: '/config', label: 'Configurações' },
]

export function FilterSidebar({ showOrigem, showStatus, showVis }: FilterSidebarProps) {
  const filters = useFilterStore()
  const sidebarOpen = useFilterStore((s) => s.sidebarOpen)
  const toggleSidebar = useFilterStore((s) => s.toggleSidebar)
  const { data: tree } = useFilterTree()
  const { user } = useAuthStore()
  const handleNavClick = () => {
    if (window.innerWidth < 1024) {
      toggleSidebar()
    }
  }

  const empresas = tree?.empresas ?? []

  const obras = filters.empresas.length > 0
    ? filters.empresas.flatMap(emp => tree?.obras_por_empresa?.[emp] ?? [])
    : tree?.empresas.flatMap(emp => tree?.obras_por_empresa?.[emp] ?? []) ?? []

  const bancos = filters.empresas.length > 0
    ? filters.empresas.flatMap(emp => tree?.bancos_por_empresa?.[emp] ?? [])
    : tree?.empresas.flatMap(emp => tree?.bancos_por_empresa?.[emp] ?? []) ?? []

  const empresasParaContas = filters.empresas.length > 0 ? filters.empresas : (tree?.empresas ?? [])
  const contas = empresasParaContas.flatMap(emp => {
    if (filters.bancos.length > 0 && tree?.contas_por_empresa_banco?.[emp]) {
      return filters.bancos.flatMap(b => tree.contas_por_empresa_banco?.[emp]?.[b] ?? [])
    }
    return tree?.contas_por_empresa?.[emp] ?? []
  })

  const uniqueObras = [...new Set(obras)].sort()
  const uniqueBancos = [...new Set(bancos)].sort()
  const uniqueContas = [...new Set(contas)].sort()

  const origens = ['Emissao', 'A Confirmar', 'Pago']
  const statusList = ['A Receber', 'Recebida']
  const visList = ['realizado', 'projetado']

  const sidebarContent = (
    <>
      <div className="p-4 block-border-b flex items-center justify-between">
        <h2 className="text-xs font-black uppercase tracking-widest text-dark">Filtros</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={filters.resetFilters}
            title="Limpar todos os filtros"
            className="p-1.5 text-muted-foreground hover:text-dark hover:bg-bgBase transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            className="p-1.5 text-muted-foreground hover:text-dark hover:bg-bgBase transition-colors lg:hidden"
            onClick={toggleSidebar}
            title="Fechar"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="lg:hidden p-4 block-border-b space-y-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={handleNavClick}
            className={({ isActive }) =>
              cn(
                'block text-sm font-black uppercase tracking-widest py-2 px-3 transition-colors',
                isActive
                  ? 'bg-dark text-white'
                  : 'text-muted-foreground hover:bg-bgBase hover:text-dark'
              )
            }
          >
            {item.label}
          </NavLink>
        ))}
        {user?.is_admin && (
          <NavLink
            to="/admin"
            onClick={handleNavClick}
            className={({ isActive }) =>
              cn(
                'block text-sm font-black uppercase tracking-widest py-2 px-3 transition-colors',
                isActive
                  ? 'bg-dark text-white'
                  : 'text-muted-foreground hover:bg-bgBase hover:text-dark'
              )
            }
          >
            Admin
          </NavLink>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-5">
        <DateRangeSelector
          startDate={filters.dtInicio}
          endDate={filters.dtFim}
          onStartDateChange={(val) => filters.setFilter('dtInicio', val)}
          onEndDateChange={(val) => filters.setFilter('dtFim', val)}
        />
        <div className="block-border-b pb-5">
          <MultiSelect label="Empresas" options={empresas} selected={filters.empresas} onChange={filters.setEmpresas} allLabel="Todas as Empresas" />
        </div>
        <div className="block-border-b pb-5">
          <MultiSelect label="Obras" options={uniqueObras} selected={filters.obras} onChange={filters.setObras} allLabel="Todas as Obras" />
        </div>
        {showOrigem && (
          <div className="block-border-b pb-5">
            <MultiSelect label="Origem" options={origens} selected={filters.origens} onChange={filters.setOrigens} allLabel="Todas as Origens" />
          </div>
        )}
        {showStatus && (
          <div className="block-border-b pb-5">
            <MultiSelect label="Status" options={statusList} selected={filters.status_list} onChange={filters.setStatusList} allLabel="Todos os Status" />
          </div>
        )}
        {showVis && (
          <div className="block-border-b pb-5">
            <MultiSelect label="Visualização" options={visList} selected={filters.vis} onChange={filters.setVis} allLabel="Todos (Realizado + Projetado)" />
          </div>
        )}
        <div className="block-border-b pb-5">
          <MultiSelect label="Bancos" options={uniqueBancos} selected={filters.bancos} onChange={filters.setBancos} allLabel="Todos os Bancos" />
        </div>
        <MultiSelect label="Contas" options={uniqueContas} selected={filters.contas} onChange={filters.setContas} allLabel="Todas as Contas" />
      </div>
    </>
  )

  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={toggleSidebar}
        />
      )}

      <aside
        className={cn(
          'flex flex-col bg-white block-border-r transition-transform duration-300 ease-in-out',
          'lg:relative lg:translate-x-0 lg:w-[280px] lg:min-w-[280px] lg:h-full',
          'fixed inset-y-0 left-0 z-50 w-[280px] h-full lg:static',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {sidebarContent}
      </aside>
    </>
  )
}
