import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Building2, ChevronRight } from 'lucide-react'
import { useGruposObras, useGruposTotaisPrevistos, useGruposTotaisReais } from '@/hooks/useFinanceiro'
import { formatCompact, formatCurrency, formatDateTime } from '@/lib/formatters'
import { cn } from '@/lib/utils'

interface LinhaGrupo {
  id: number
  nome: string
  custoPrev: number
  custoReal: number
  receitaPrev: number
  receitaReal: number
  atualizadoEm: string | null
}

const MAX_LINHAS = 6

function Barra({
  titulo,
  real,
  previsto,
  cor,
}: {
  titulo: string
  real: number
  previsto: number
  cor: string
}) {
  const pct = previsto > 0 ? (real / previsto) * 100 : 0
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-muted-foreground">{titulo}</span>
        <span className="tabular-nums text-muted-foreground">
          <span className="font-semibold text-dark" title={formatCurrency(real)}>
            {formatCompact(real)}
          </span>
          {' de '}
          <span title={formatCurrency(previsto)}>{formatCompact(previsto)}</span>
          {previsto > 0 && <span className="ml-1.5 font-semibold text-dark">{pct.toFixed(0)}%</span>}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: cor }}
        />
      </div>
    </div>
  )
}

/**
 * Previsto × real por grupo de obras.
 *
 * Cada grupo usa o próprio período configurado nele (periodo_padrao) — não o filtro de
 * período da tela; a ausência de um grupo em `reais` significa "nunca foi calculado", não zero.
 */
export function ObrasResumoPanel() {
  const { data: grupos, isLoading: gruposLoading } = useGruposObras()
  const { data: previstos } = useGruposTotaisPrevistos()
  const { data: reais } = useGruposTotaisReais()

  const linhas = useMemo<LinhaGrupo[]>(() => {
    if (!grupos) return []
    return grupos
      .map((g) => {
        // As respostas chegam com chaves string apesar da anotação dict[int, ...] no backend.
        const prev = previstos?.[String(g.id)]
        const real = reais?.[String(g.id)]
        return {
          id: g.id,
          nome: g.nome,
          custoPrev: prev?.custo_prev ?? 0,
          custoReal: real?.custo_real ?? 0,
          receitaPrev: prev?.receita_prev ?? 0,
          receitaReal: real?.receita_realizada ?? 0,
          atualizadoEm: real?.updated_at ?? null,
        }
      })
      .sort((a, b) => b.custoPrev - a.custoPrev)
  }, [grupos, previstos, reais])

  const visiveis = linhas.slice(0, MAX_LINHAS)

  return (
    <div className="data-panel p-6 md:p-7">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
        <h3 className="text-lg font-semibold tracking-[-0.02em] text-dark">Obras: previsto × real</h3>
        <Link
          to="/fluxo-obras"
          className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-brand"
        >
          Abrir Fluxo Obras
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {gruposLoading && <div className="h-32 animate-pulse rounded-md bg-secondary" />}

      {!gruposLoading && visiveis.length === 0 && (
        <div className="rounded-md border border-dashed border-line px-4 py-8 text-center">
          <Building2 className="mx-auto h-5 w-5 text-muted-foreground/50" />
          <p className="mt-2 text-[13px] font-medium text-dark">Nenhum grupo de obras disponível</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Crie um grupo em Fluxo Obras para acompanhar planejamento e realizado por aqui.
          </p>
        </div>
      )}

      {visiveis.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {visiveis.map((linha) => {
            const semSnapshot = linha.atualizadoEm === null
            return (
              <Link
                key={linha.id}
                to="/fluxo-obras"
                className="group rounded-md border border-line p-4 transition-colors hover:border-brand"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate text-[13px] font-semibold text-dark">{linha.nome}</span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                      semSnapshot ? 'bg-secondary text-muted-foreground' : 'bg-positive/12 text-positive',
                    )}
                  >
                    {semSnapshot ? 'Sem snapshot' : 'Realizado'}
                  </span>
                </div>
                <div className="space-y-2.5">
                  <Barra titulo="Custo" real={linha.custoReal} previsto={linha.custoPrev} cor="var(--chart-despesa)" />
                  <Barra
                    titulo="Receita"
                    real={linha.receitaReal}
                    previsto={linha.receitaPrev}
                    cor="var(--chart-recebida)"
                  />
                </div>
                <p className="mt-3 text-[10px] text-muted-foreground">
                  {semSnapshot
                    ? 'O realizado ainda não foi calculado para este grupo.'
                    : `Realizado atualizado em ${formatDateTime(linha.atualizadoEm!)}`}
                </p>
              </Link>
            )
          })}
        </div>
      )}

      <div className="mt-4 space-y-1">
        {linhas.length > MAX_LINHAS && (
          <p className="text-[11px] text-muted-foreground">
            Mostrando {MAX_LINHAS} de {linhas.length} grupos, por maior custo previsto.
          </p>
        )}
      </div>
    </div>
  )
}
