import type { ReactNode } from 'react'
import { FilterBar } from '@/components/filters/FilterBar'

interface FilteredPageProps {
  showOrigem?: boolean
  showStatus?: boolean
  showVis?: boolean
  children: ReactNode
}

/**
 * Esqueleto das páginas financeiras: barra de filtros fixa no topo e conteúdo rolável abaixo.
 * A barra é irmã do container de rolagem, então permanece visível sem `sticky`.
 */
export function FilteredPage({ showOrigem, showStatus, showVis, children }: FilteredPageProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <FilterBar showOrigem={showOrigem} showStatus={showStatus} showVis={showVis} />
      <div className="min-w-0 flex-1 overflow-auto p-5 md:p-7">{children}</div>
    </div>
  )
}
