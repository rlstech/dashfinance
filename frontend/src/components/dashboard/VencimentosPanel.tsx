import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CalendarClock, ChevronRight } from 'lucide-react'
import { useFilterStore } from '@/hooks/useFilters'
import { formatCompact, formatCurrency, parseDate } from '@/lib/formatters'
import { addDays, startOfToday, sumBy, toISODate } from '@/lib/finance'
import { cn } from '@/lib/utils'
import type { APRecord, ReceitaRecord } from '@/types'

interface VencimentosPanelProps {
  /** Já recortado por empresa/obra/banco/conta, mas **sem** recorte de período. */
  ap: APRecord[]
  receitas: ReceitaRecord[]
  /** Início da janela de sincronização (`status.de`), usado como piso do drill-down "vencido". */
  sincronizadoDe?: string | null
}

interface Faixa {
  id: string
  label: string
  valor: number
  quantidade: number
  tone: 'negative' | 'brand' | 'neutral'
  inicio: string
  fim: string
}

const TONE_TEXT = {
  negative: 'text-negative',
  brand: 'text-brand',
  neutral: 'text-dark',
} as const

const TONE_DOT = {
  negative: 'bg-negative',
  brand: 'bg-brand',
  neutral: 'bg-muted-foreground/40',
} as const

function faixas(
  rows: { valor: number; ref: Date | null }[],
  hoje: Date,
  pisoVencido: string,
): Faixa[] {
  const ontem = addDays(hoje, -1)
  const em7 = addDays(hoje, 7)
  const em30 = addDays(hoje, 30)

  const bucket = (de: Date | null, ate: Date) =>
    rows.filter((r) => r.ref !== null && (de === null || r.ref >= de) && r.ref <= ate)

  const vencidos = bucket(null, ontem)
  const ate7 = bucket(hoje, em7)
  const ate30 = bucket(hoje, em30)

  return [
    {
      id: 'vencido',
      label: 'Vencido',
      valor: sumBy(vencidos, (r) => r.valor),
      quantidade: vencidos.length,
      tone: 'negative',
      inicio: pisoVencido,
      fim: toISODate(ontem),
    },
    {
      id: 'ate7',
      label: 'Vence em até 7 dias',
      valor: sumBy(ate7, (r) => r.valor),
      quantidade: ate7.length,
      tone: 'brand',
      inicio: toISODate(hoje),
      fim: toISODate(em7),
    },
    {
      id: 'ate30',
      label: 'Vence em até 30 dias',
      valor: sumBy(ate30, (r) => r.valor),
      quantidade: ate30.length,
      tone: 'neutral',
      inicio: toISODate(hoje),
      fim: toISODate(em30),
    },
  ]
}

/**
 * Alertas de vencimento a pagar / a receber.
 *
 * Ignora deliberadamente o filtro de período — um título vencido em 2024 precisa aparecer
 * mesmo com o filtro padrão apontando para o ano corrente. Só o escopo de
 * empresa/obra/banco/conta é honrado.
 *
 * Nota de schema: `APRecord` não tem `data_venc`, só `data` — é a mesma convenção que a
 * página Despesas já usa. Receitas usa `data_venc`, como na página Receitas.
 */
export function VencimentosPanel({ ap, receitas, sincronizadoDe }: VencimentosPanelProps) {
  const navigate = useNavigate()
  const filters = useFilterStore()
  const piso = sincronizadoDe || '2020-01-01'

  const { aPagar, aReceber } = useMemo(() => {
    const hoje = startOfToday()
    const pagar = ap
      .filter((r) => r.origem !== 'Pago')
      .map((r) => ({ valor: r.valor, ref: parseDate(r.data) }))
    const receber = receitas
      .filter((r) => r.status === 'A Receber')
      .map((r) => ({ valor: r.valor, ref: parseDate(r.data_venc) }))
    return {
      aPagar: faixas(pagar, hoje, piso),
      aReceber: faixas(receber, hoje, piso),
    }
  }, [ap, receitas, piso])

  function drillDown(faixa: Faixa, destino: 'despesas' | 'receitas') {
    filters.setFilter('dtInicio', faixa.inicio)
    filters.setFilter('dtFim', faixa.fim)
    if (destino === 'despesas') filters.setOrigens(['Emissao', 'A Confirmar'])
    else filters.setStatusList(['A Receber'])
    navigate(`/${destino}`)
  }

  const coluna = (titulo: string, dados: Faixa[], destino: 'despesas' | 'receitas', Icon: typeof AlertTriangle) => (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h4 className="text-sm font-semibold text-dark">{titulo}</h4>
      </div>
      <div className="space-y-1.5">
        {dados.map((faixa) => (
          <button
            key={faixa.id}
            type="button"
            onClick={() => drillDown(faixa, destino)}
            className="flex w-full items-center justify-between gap-3 rounded-md border border-line px-3 py-2.5 text-left transition-colors hover:border-brand hover:bg-secondary/50"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', TONE_DOT[faixa.tone])} />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-dark">{faixa.label}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {faixa.quantidade} {faixa.quantidade === 1 ? 'título' : 'títulos'}
                </span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span
                className={cn('text-sm font-semibold tabular-nums', TONE_TEXT[faixa.tone])}
                title={formatCurrency(faixa.valor)}
              >
                {formatCompact(faixa.valor)}
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
            </span>
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="data-panel p-6 md:p-7">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
        <h3 className="text-lg font-semibold tracking-[-0.02em] text-dark">Vencimentos</h3>
        <p className="text-[11px] text-muted-foreground">
          Independente do período selecionado · clique para abrir o detalhamento
        </p>
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {coluna('A pagar', aPagar, 'despesas', AlertTriangle)}
        {coluna('A receber', aReceber, 'receitas', CalendarClock)}
      </div>
    </div>
  )
}
