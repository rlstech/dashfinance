import { useState } from 'react'
import { useFilterStore } from '@/hooks/useFilters'
import { useFilterOptions } from '@/hooks/useFilterOptions'
import { MultiSelect } from './MultiSelect'
import { PeriodoDropdown } from './PeriodoDropdown'
import { ChevronDown, Filter, RotateCcw, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FilterBarProps {
  showOrigem?: boolean
  showStatus?: boolean
  showVis?: boolean
}

const ORIGENS = ['Emissao', 'A Confirmar', 'Pago']
const STATUS_LIST = ['A Receber', 'Recebida']
const VIS_LIST = ['realizado', 'projetado']

export function FilterBar({ showOrigem, showStatus, showVis }: FilterBarProps) {
  // Abaixo de `lg` os controles ficam recolhidos para não empurrarem o conteúdo
  // para fora da tela; a partir de `lg` a barra está sempre aberta.
  const [aberto, setAberto] = useState(false)
  const filters = useFilterStore()
  const { empresas, obras, bancos, contas, activeFilterCount, activeChips } = useFilterOptions()

  const identidade = (
    <>
      <Filter className="h-4 w-4 shrink-0 text-brand" />
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Escopo</span>
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-[10px] font-semibold',
          activeFilterCount > 0 ? 'bg-brand/15 text-brand' : 'bg-white text-muted-foreground'
        )}
      >
        {activeFilterCount}
      </span>
    </>
  )

  return (
    <div className="filter-surface shrink-0 border-b border-line px-5 py-2.5 md:px-7">
      <div className="flex items-center gap-2 lg:hidden">
        {identidade}
        <button
          type="button"
          onClick={() => setAberto(!aberto)}
          aria-expanded={aberto}
          className="ml-auto flex h-9 items-center gap-1.5 rounded-md border border-line bg-white px-3 text-xs font-medium text-dark transition-colors hover:border-brand"
        >
          <span>{aberto ? 'Ocultar filtros' : 'Filtrar'}</span>
          <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform duration-200', aberto && 'rotate-180')} />
        </button>
      </div>

      <div className={cn('flex-wrap items-center gap-2 lg:flex', aberto ? 'mt-2 flex lg:mt-0' : 'hidden')}>
        <div className="mr-1 hidden shrink-0 items-center gap-2 lg:flex">
          {identidade}
          <button
            type="button"
            onClick={filters.resetFilters}
            title="Limpar todos os filtros"
            className="flex h-9 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-white hover:text-dark"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Limpar</span>
          </button>
        </div>

        <PeriodoDropdown
          startDate={filters.dtInicio}
          endDate={filters.dtFim}
          onStartDateChange={(val) => filters.setFilter('dtInicio', val)}
          onEndDateChange={(val) => filters.setFilter('dtFim', val)}
        />

        <MultiSelect inline label="Empresas" options={empresas} selected={filters.empresas} onChange={filters.setEmpresas} allLabel="Todas as Empresas" />
        <MultiSelect inline label="Obras" options={obras} selected={filters.obras} onChange={filters.setObras} allLabel="Todas as Obras" />
        {showOrigem && (
          <MultiSelect inline label="Origem" options={ORIGENS} selected={filters.origens} onChange={filters.setOrigens} allLabel="Todas as Origens" />
        )}
        {showStatus && (
          <MultiSelect inline label="Status" options={STATUS_LIST} selected={filters.status_list} onChange={filters.setStatusList} allLabel="Todos os Status" />
        )}
        {showVis && (
          <MultiSelect inline label="Visualização" options={VIS_LIST} selected={filters.vis} onChange={filters.setVis} allLabel="Todos (Realizado + Projetado)" />
        )}
        <MultiSelect inline label="Bancos" options={bancos} selected={filters.bancos} onChange={filters.setBancos} allLabel="Todos os Bancos" />
        <MultiSelect inline label="Contas" options={contas} selected={filters.contas} onChange={filters.setContas} allLabel="Todas as Contas" />

        <button
          type="button"
          onClick={filters.resetFilters}
          className="flex h-9 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-white hover:text-dark lg:hidden"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>Limpar</span>
        </button>
      </div>

      {activeChips.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {activeChips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-medium text-brand"
            >
              <span className="max-w-[180px] truncate" title={`${chip.grupo}: ${chip.valor}`}>{chip.valor}</span>
              <button
                type="button"
                onClick={chip.remove}
                aria-label={`Remover filtro ${chip.grupo}: ${chip.valor}`}
                className="rounded-full transition-colors hover:text-dark"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
