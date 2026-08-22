import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { FilteredPage } from '@/components/layout/FilteredPage'
import { CashFlowChart } from '@/components/charts/CashFlowChart'
import { DonutChart } from '@/components/charts/DonutChart'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { VencimentosPanel } from '@/components/dashboard/VencimentosPanel'
import { ObrasResumoPanel } from '@/components/dashboard/ObrasResumoPanel'
import { useAP, useReceitas, useSaldoBanco, useSaldoConfig, useStatus, useSync } from '@/hooks/useFinanceiro'
import { useFilterStore } from '@/hooks/useFilters'
import { useAuthStore } from '@/hooks/useAuth'
import { formatCompact, formatCurrency } from '@/lib/formatters'
import {
  fluxoMensal,
  inRange,
  matchesScope,
  rangeBounds,
  saldoConsolidado,
  startOfToday,
  sumBy,
  type ScopeFilters,
} from '@/lib/finance'
import { cn } from '@/lib/utils'
import { EMPRESA_COLORS, type Periodo } from '@/types'

type FluxoModo = 'realizado' | 'todos'
type DonutModo = 'entradas' | 'saidas'

function Pill({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
        ativo ? 'bg-dark text-white' : 'border border-line text-muted-foreground hover:border-brand hover:text-dark',
      )}
    >
      {children}
    </button>
  )
}

export default function Dashboard() {
  useEffect(() => {
    document.title = 'Dashboard | DashFinance'
  }, [])

  const { data: apData, isLoading: apLoading } = useAP()
  const { data: recData, isLoading: recLoading } = useReceitas()
  const { data: saldoData, isLoading: saldoLoading } = useSaldoBanco()
  const { data: saldoConfigs } = useSaldoConfig()
  const { data: status } = useStatus()
  const filters = useFilterStore()
  const { user } = useAuthStore()
  const sync = useSync()

  const isLoading = apLoading || recLoading || saldoLoading

  const [fluxoModo, setFluxoModo] = useState<FluxoModo>('realizado')
  const [donutModo, setDonutModo] = useState<DonutModo>('entradas')

  const scope = useMemo<ScopeFilters>(
    () => ({
      empresas: filters.empresas,
      obras: filters.obras,
      bancos: filters.bancos,
      contas: filters.contas,
    }),
    [filters.empresas, filters.obras, filters.bancos, filters.contas],
  )

  const bounds = useMemo(() => rangeBounds(filters.dtInicio, filters.dtFim), [filters.dtInicio, filters.dtFim])

  // Escopo sem recorte de período — base do painel de Vencimentos.
  const apEscopo = useMemo(() => (apData ?? []).filter((r) => matchesScope(r, scope)), [apData, scope])
  const recEscopo = useMemo(
    () => (recData ?? []).filter((r) => matchesScope(r, scope, { strictBanco: false })),
    [recData, scope],
  )

  const ap = useMemo(() => apEscopo.filter((r) => inRange(r.data, bounds)), [apEscopo, bounds])
  const receitas = useMemo(() => recEscopo.filter((r) => inRange(r.data, bounds)), [recEscopo, bounds])

  const kpis = useMemo(() => {
    const recebido = sumBy(
      receitas.filter((r) => r.status === 'Recebida'),
      (r) => r.valor,
    )
    const aReceber = sumBy(
      receitas.filter((r) => r.status === 'A Receber'),
      (r) => r.valor,
    )
    const pago = sumBy(
      ap.filter((r) => r.origem === 'Pago'),
      (r) => r.valor,
    )
    const emissao = sumBy(
      ap.filter((r) => r.origem === 'Emissao'),
      (r) => r.valor,
    )
    const aConfirmar = sumBy(
      ap.filter((r) => r.origem === 'A Confirmar'),
      (r) => r.valor,
    )
    const receitasTotal = recebido + aReceber
    const despesasTotal = pago + emissao + aConfirmar
    return {
      recebido,
      aReceber,
      pago,
      emissao,
      aConfirmar,
      receitasTotal,
      despesasTotal,
      resultado: recebido - pago,
      projecao: aReceber - (emissao + aConfirmar),
      taxaRecebimento: receitasTotal > 0 ? (recebido / receitasTotal) * 100 : 0,
    }
  }, [ap, receitas])

  const hoje = useMemo(() => startOfToday(), [])
  const saldo = useMemo(
    () => saldoConsolidado(saldoData ?? [], saldoConfigs ?? [], scope, hoje),
    [saldoData, saldoConfigs, scope, hoje],
  )

  const saldoPorEmpresa = useMemo(
    () =>
      Object.entries(saldo.porEmpresa)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([empresa, valor]) => ({
          label: empresa,
          value: valor,
          color: EMPRESA_COLORS[empresa] ?? '#6b7280',
        })),
    [saldo],
  )

  const fluxoData = useMemo(() => {
    const entradas = receitas
      .filter((r) => fluxoModo === 'todos' || r.status === 'Recebida')
      .map((r) => ({ data: r.data, valor: r.valor }))
    const saidas = ap
      .filter((r) => fluxoModo === 'todos' || r.origem === 'Pago')
      .map((r) => ({ data: r.data, valor: r.valor }))
    return fluxoMensal(entradas, saidas)
  }, [ap, receitas, fluxoModo])

  const donutData = useMemo(() => {
    const porEmpresa: Record<string, number> = {}
    const fonte = donutModo === 'entradas' ? receitas : ap
    for (const r of fonte) {
      const nome = r.empresa || 'N/A'
      porEmpresa[nome] = (porEmpresa[nome] ?? 0) + r.valor
    }
    return Object.entries(porEmpresa)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value, color: EMPRESA_COLORS[name] ?? '#6b7280' }))
  }, [ap, receitas, donutModo])

  const donutTotal = useMemo(() => donutData.reduce((s, d) => s + d.value, 0), [donutData])

  const periodo = useMemo<Periodo>(() => {
    const anoAtual = new Date().getFullYear()
    const [ai, mi] = filters.dtInicio ? filters.dtInicio.split('-').map(Number) : [anoAtual, 1]
    const [af, mf] = filters.dtFim ? filters.dtFim.split('-').map(Number) : [anoAtual, 12]
    return { anoInicio: ai, mesInicio: mi, anoFim: af, mesFim: mf }
  }, [filters.dtInicio, filters.dtFim])

  const dataReferencia = hoje.toLocaleDateString('pt-BR')
  const registrosNoEscopo = ap.length + receitas.length
  const semDados = !isLoading && apEscopo.length === 0 && recEscopo.length === 0

  if (isLoading) {
    return (
      <FilteredPage>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <div className="data-panel h-44 animate-pulse lg:col-span-12" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="data-panel h-40 animate-pulse lg:col-span-3" />
          ))}
          <div className="data-panel h-80 animate-pulse lg:col-span-8" />
          <div className="data-panel h-80 animate-pulse lg:col-span-4" />
          <div className="data-panel h-56 animate-pulse lg:col-span-12" />
        </div>
      </FilteredPage>
    )
  }

  return (
    <FilteredPage>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Hero — resultado realizado do período */}
        <div className="data-panel flex flex-col justify-between gap-7 p-6 md:p-7 lg:col-span-12 xl:flex-row">
          <div>
            <p className="section-label text-brand">Visão geral</p>
            <p className="mt-4 text-sm font-medium text-muted-foreground">
              Resultado realizado do período
              <span className="ml-2 font-semibold text-brand">{registrosNoEscopo} registros no escopo</span>
            </p>
            <h2
              className={cn('hero-metric mt-2', kpis.resultado >= 0 ? 'text-positive' : 'text-negative')}
              title={formatCurrency(kpis.resultado)}
            >
              {formatCompact(kpis.resultado)}
            </h2>
            <p className="mt-2 text-xs font-medium text-muted-foreground">
              {kpis.resultado >= 0 ? 'Superávit' : 'Déficit'} — recebido menos pago no período selecionado
            </p>
            <p className="mt-4 text-[11px] text-muted-foreground">
              {status?.last_sync ? `Dados sincronizados em ${status.last_sync}` : 'Sem sincronização registrada'}
            </p>
          </div>
          <div className="grid w-full grid-cols-1 divide-y divide-line border-t border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:border-t-0 xl:max-w-xl">
            <div className="metric-cell px-0 pt-4 sm:pt-3">
              <p className="section-label text-positive">Recebido</p>
              <p className="mt-2 text-2xl font-semibold text-positive" title={formatCurrency(kpis.recebido)}>
                {formatCompact(kpis.recebido)}
              </p>
            </div>
            <div className="metric-cell px-0 pt-4 sm:pl-5 sm:pt-3">
              <p className="section-label text-negative">Pago</p>
              <p className="mt-2 text-2xl font-semibold text-negative" title={formatCurrency(kpis.pago)}>
                {formatCompact(kpis.pago)}
              </p>
            </div>
            <div className="metric-cell px-0 pt-4 sm:pl-5 sm:pt-3">
              <p className="section-label">Saldo bancário</p>
              <p className="mt-2 text-2xl font-semibold text-dark" title={formatCurrency(saldo.total)}>
                {formatCompact(saldo.total)}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">em {dataReferencia}</p>
            </div>
          </div>
        </div>

        {semDados && (
          <div className="data-panel flex flex-col items-center gap-3 p-10 text-center lg:col-span-12">
            <p className="text-sm font-semibold text-dark">Nenhum dado disponível no escopo atual</p>
            <p className="max-w-md text-xs text-muted-foreground">
              O cache pode estar vazio ou os filtros ativos podem não corresponder a nenhum registro.
              Ajuste o escopo na barra de filtros{user?.is_admin ? ' ou sincronize os dados.' : '.'}
            </p>
            {user?.is_admin && (
              <button
                type="button"
                onClick={() => sync.mutate()}
                disabled={sync.isPending}
                className="mt-1 flex items-center gap-2 rounded-md bg-dark px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand hover:text-dark disabled:opacity-50"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', sync.isPending && 'animate-spin')} />
                {sync.isPending ? 'Sincronizando' : 'Sincronizar agora'}
              </button>
            )}
          </div>
        )}

        {/* KPIs */}
        <div className="lg:col-span-3">
          <KpiCard
            label="Receitas do período"
            value={kpis.receitasTotal}
            to="/receitas"
            progresso={{
              pct: kpis.taxaRecebimento,
              label: `${kpis.taxaRecebimento.toFixed(1)}% recebido`,
            }}
            breakdown={[
              { label: 'Recebida', value: kpis.recebido },
              { label: 'A receber', value: kpis.aReceber },
            ]}
          />
        </div>
        <div className="lg:col-span-3">
          <KpiCard
            label="Despesas do período"
            value={kpis.despesasTotal}
            to="/despesas"
            breakdown={[
              { label: 'Pago', value: kpis.pago },
              { label: 'Emissão', value: kpis.emissao },
              { label: 'A confirmar', value: kpis.aConfirmar },
            ]}
          />
        </div>
        <div className="lg:col-span-3">
          <KpiCard
            label="Saldo bancário consolidado"
            value={saldo.total}
            to="/fluxo"
            tone={saldo.total >= 0 ? 'neutral' : 'negative'}
            hint={`Posição em ${dataReferencia} · ${saldo.contas} conta(s)`}
            breakdown={saldoPorEmpresa}
          />
        </div>
        <div className="lg:col-span-3">
          <KpiCard
            label="Projeção do período"
            value={kpis.projecao}
            to="/fluxo"
            tone={kpis.projecao >= 0 ? 'positive' : 'negative'}
            hint="A receber menos a pagar ainda em aberto"
            breakdown={[
              { label: 'A receber', value: kpis.aReceber },
              { label: 'A pagar', value: kpis.emissao + kpis.aConfirmar },
            ]}
          />
        </div>

        {/* Fluxo mensal */}
        <div className="data-panel flex flex-col p-6 md:p-7 lg:col-span-8">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold tracking-[-0.02em] text-dark">Fluxo de caixa mensal</h3>
              <p className="mt-1 text-[11px] text-muted-foreground">
                A linha é o fluxo líquido acumulado no período, não o saldo bancário.
              </p>
            </div>
            <div className="flex gap-2">
              <Pill ativo={fluxoModo === 'realizado'} onClick={() => setFluxoModo('realizado')}>
                Realizado
              </Pill>
              <Pill ativo={fluxoModo === 'todos'} onClick={() => setFluxoModo('todos')}>
                Realizado + projetado
              </Pill>
            </div>
          </div>
          <div className="flex-1">
            {fluxoData.length > 0 ? (
              <CashFlowChart data={fluxoData} height={330} />
            ) : (
              <div className="flex h-[330px] items-center justify-center text-xs font-medium text-muted-foreground">
                Nenhum lançamento no período selecionado
              </div>
            )}
          </div>
        </div>

        {/* Composição por empresa */}
        <div className="data-panel flex flex-col p-6 lg:col-span-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-dark">Por empresa</h3>
            <div className="flex gap-1.5">
              <Pill ativo={donutModo === 'entradas'} onClick={() => setDonutModo('entradas')}>
                Entradas
              </Pill>
              <Pill ativo={donutModo === 'saidas'} onClick={() => setDonutModo('saidas')}>
                Saídas
              </Pill>
            </div>
          </div>
          {donutData.length > 0 ? (
            <>
              <DonutChart
                data={donutData}
                height={180}
                centerLabel="Total"
                centerValue={formatCompact(donutTotal)}
                onSliceClick={(nome) => {
                  if (nome && nome !== 'N/A') filters.setEmpresas([nome])
                }}
              />
              <p className="mt-3 text-[10px] text-muted-foreground">
                Clique numa empresa para aplicar o filtro em todas as páginas.
              </p>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-xs font-medium text-muted-foreground">
              Sem dados no período
            </div>
          )}
        </div>

        {/* Vencimentos */}
        <div className="lg:col-span-12">
          <VencimentosPanel ap={apEscopo} receitas={recEscopo} sincronizadoDe={status?.de} />
        </div>

        {/* Obras */}
        <div className="lg:col-span-12">
          <ObrasResumoPanel periodo={periodo} />
        </div>
      </div>
    </FilteredPage>
  )
}
