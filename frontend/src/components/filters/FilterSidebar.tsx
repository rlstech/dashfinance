import { useFilterStore } from '@/hooks/useFilters'
import { useFilterTree } from '@/hooks/useFinanceiro'
import { MultiSelect } from './MultiSelect'
import { DateRangeSelector } from './DateRangeSelector'
import { Filter, RotateCcw, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FilterSidebarProps {
  showOrigem?: boolean
  showStatus?: boolean
  showVis?: boolean
}

export function FilterSidebar({ showOrigem, showStatus, showVis }: FilterSidebarProps) {
  const filters = useFilterStore()
  const sidebarOpen = useFilterStore((s) => s.sidebarOpen)
  const toggleSidebar = useFilterStore((s) => s.toggleSidebar)
  const { data: tree } = useFilterTree()
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
  const activeFilterCount = filters.empresas.length + filters.obras.length + filters.bancos.length + filters.contas.length
    + filters.origens.length + filters.status_list.length + (filters.vis[0] === 'todos' ? 0 : filters.vis.length)

  const sidebarContent = (
    <>
      <div className="flex items-center justify-between border-b border-line px-4 py-4">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-brand" />
          <div>
            <h2 className="text-sm font-semibold text-dark">Escopo</h2>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Filtros desta visualização</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={filters.resetFilters}
            title="Limpar todos os filtros"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white hover:text-dark"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white hover:text-dark lg:hidden"
            onClick={toggleSidebar}
            title="Fechar"
            aria-label="Fechar filtros"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.12em]">
          <span className="text-muted-foreground">Filtros ativos</span>
          <span className={cn('rounded-full px-2 py-0.5', activeFilterCount > 0 ? 'bg-brand/15 text-brand' : 'bg-white text-muted-foreground')}>
            {activeFilterCount}
          </span>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto overflow-x-hidden p-4">
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
          'filter-surface flex flex-col border-r border-line transition-transform duration-200 ease-out',
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
