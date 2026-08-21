import { useFilterStore } from '@/hooks/useFilters'
import { useFilterTree } from '@/hooks/useFinanceiro'

export const VIS_LABEL = (v: string) => (v === 'realizado' ? 'Realizado' : v === 'projetado' ? 'Projetado' : v)

export interface FilterChip {
  key: string
  grupo: string
  valor: string
  remove: () => void
}

export function useFilterOptions() {
  const filters = useFilterStore()
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

  const visAtivo = filters.vis[0] === 'todos' ? [] : filters.vis

  const activeFilterCount = filters.empresas.length + filters.obras.length + filters.bancos.length
    + filters.contas.length + filters.origens.length + filters.status_list.length + visAtivo.length

  const chipsDe = (
    grupo: string,
    valores: string[],
    onChange: (next: string[]) => void,
    label: (v: string) => string = (v) => v,
  ): FilterChip[] => valores.map((valor) => ({
    key: `${grupo}:${valor}`,
    grupo,
    valor: label(valor),
    remove: () => onChange(valores.filter((v) => v !== valor)),
  }))

  const activeChips: FilterChip[] = [
    ...chipsDe('Empresas', filters.empresas, filters.setEmpresas),
    ...chipsDe('Obras', filters.obras, filters.setObras),
    ...chipsDe('Origem', filters.origens, filters.setOrigens),
    ...chipsDe('Status', filters.status_list, filters.setStatusList),
    ...chipsDe('Visualização', visAtivo, (next) => filters.setVis(next.length > 0 ? next : ['todos']), VIS_LABEL),
    ...chipsDe('Bancos', filters.bancos, filters.setBancos),
    ...chipsDe('Contas', filters.contas, filters.setContas),
  ]

  return {
    empresas,
    obras: uniqueObras,
    bancos: uniqueBancos,
    contas: uniqueContas,
    activeFilterCount,
    activeChips,
  }
}
