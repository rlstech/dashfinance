import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCompact, formatCurrency } from '@/lib/formatters'

type Tone = 'neutral' | 'positive' | 'negative'

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'text-dark',
  positive: 'text-positive',
  negative: 'text-negative',
}

export interface KpiBreakdownItem {
  label: string
  value: number
  /** Cor do marcador (ex.: EMPRESA_COLORS). Sem cor, mostra só o rótulo. */
  color?: string
}

interface KpiCardProps {
  label: string
  value: number
  to: string
  /** Frase curta abaixo do valor — contexto ou data de referência. */
  hint?: string
  tone?: Tone
  breakdown?: KpiBreakdownItem[]
  progresso?: { pct: number; label: string }
}

/**
 * Tile de KPI clicável. É um `Link` para manter foco/teclado e abrir em nova aba,
 * levando à página detalhada com o mesmo escopo de filtros já aplicado.
 */
export function KpiCard({ label, value, to, hint, tone = 'neutral', breakdown, progresso }: KpiCardProps) {
  return (
    <Link
      to={to}
      className="data-panel group flex flex-col gap-3 p-5 transition-colors hover:border-brand focus-visible:border-brand"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="section-label">{label}</p>
        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-brand" />
      </div>

      <div>
        <p
          className={cn('text-[26px] font-semibold leading-none tracking-[-0.03em] tabular-nums', TONE_CLASS[tone])}
          title={formatCurrency(value)}
        >
          {formatCompact(value)}
        </p>
        {hint && <p className="mt-1.5 text-[11px] text-muted-foreground">{hint}</p>}
      </div>

      {progresso && (
        <div>
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-positive transition-all"
              style={{ width: `${Math.min(100, Math.max(0, progresso.pct))}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">{progresso.label}</p>
        </div>
      )}

      {breakdown && breakdown.length > 0 && (
        <div className="mt-auto space-y-1 border-t border-line pt-2.5">
          {breakdown.map((item) => (
            <div key={item.label} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                {item.color && (
                  <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
                )}
                <span className="truncate">{item.label}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-dark" title={formatCurrency(item.value)}>
                {formatCompact(item.value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Link>
  )
}
