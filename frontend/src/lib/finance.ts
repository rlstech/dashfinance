import { parseDate } from '@/lib/formatters'
import type { SaldoConfig, SaldoRecord } from '@/types'

/**
 * Helpers de agregação financeira compartilhados pelo Dashboard.
 *
 * As páginas Receitas/Despesas/FluxoCaixa ainda carregam cópias inline destas mesmas
 * regras; migrá-las é um follow-up de baixo risco, mas foi mantido fora do escopo para
 * não mexer em cálculos financeiros já validados em produção.
 */

export interface ScopeFilters {
  empresas: string[]
  obras: string[]
  bancos: string[]
  contas: string[]
}

/** Qualquer registro que carregue as dimensões de escopo. `obra` não existe em SaldoRecord. */
export interface ScopedRecord {
  empresa: string
  obra?: string
  banco?: string
  conta?: string
}

/**
 * Escopo empresa/obra/banco/conta.
 *
 * `strictBanco: false` deixa passar registros com banco/conta vazios — é a semântica usada
 * por Receitas e pelo Fluxo de Caixa, onde uma receita sem banco definido não deve sumir
 * só porque há um filtro de banco ativo. AP usa a semântica estrita (default).
 */
export function matchesScope(
  r: ScopedRecord,
  f: ScopeFilters,
  opts: { strictBanco?: boolean } = {},
): boolean {
  const strict = opts.strictBanco ?? true
  if (f.empresas.length > 0 && !f.empresas.includes(r.empresa)) return false
  if (f.obras.length > 0 && !f.obras.includes(r.obra ?? '')) return false
  if (f.bancos.length > 0) {
    if (strict) {
      if (!f.bancos.includes(r.banco ?? '')) return false
    } else if (r.banco && !f.bancos.includes(r.banco)) return false
  }
  if (f.contas.length > 0) {
    if (strict) {
      if (!f.contas.includes(r.conta ?? '')) return false
    } else if (r.conta && !f.contas.includes(r.conta)) return false
  }
  return true
}

export interface DateBounds {
  d1: Date | null
  d2: Date | null
}

/** Converte o par ISO (`YYYY-MM-DD`) do filtro global em limites de Date, uma vez só. */
export function rangeBounds(dtInicio: string, dtFim: string): DateBounds {
  return {
    d1: dtInicio ? new Date(`${dtInicio}T00:00:00`) : null,
    d2: dtFim ? new Date(`${dtFim}T23:59:59`) : null,
  }
}

/** Testa uma data `DD/MM/YYYY` contra os limites. Registros sem data válida ficam de fora. */
export function inRange(ddmmyyyy: string, { d1, d2 }: DateBounds): boolean {
  if (!d1 && !d2) return true
  const d = parseDate(ddmmyyyy)
  if (!d) return false
  if (d1 && d < d1) return false
  if (d2 && d > d2) return false
  return true
}

export function sumBy<T>(rows: T[], value: (r: T) => number): number {
  return rows.reduce((acc, r) => acc + value(r), 0)
}

export function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export function addDays(base: Date, days: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}

/** `Date` → `YYYY-MM-DD`, formato aceito pelo filter store. */
export function toISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const CHART_PALETTE = [
  'var(--chart-recebida)',
  'var(--chart-receita)',
  'var(--chart-a-receber)',
  'var(--chart-saldo)',
  'var(--chart-despesa)',
  'var(--chart-previsto)',
  'var(--chart-emissao)',
  'var(--chart-pago)',
]

export interface SliceDatum {
  name: string
  value: number
  color: string
}

/**
 * Top-N por valor, com o restante dobrado num bucket "Outros".
 * Unifica as três cópias divergentes que existem hoje (Receitas usa var(--chart-*),
 * Despesas e FluxoCaixa usam hex fixos que não acompanham o tema).
 */
export function topN(
  entries: [string, number][],
  n = 5,
  colors: string[] = CHART_PALETTE,
): SliceDatum[] {
  const sorted = [...entries].sort((a, b) => b[1] - a[1])
  const head = sorted.slice(0, n)
  const resto = sorted.slice(n).reduce((acc, [, v]) => acc + v, 0)
  const final: [string, number][] = resto > 0 ? [...head, ['Outros', resto]] : head
  return final.map(([name, value], i) => ({
    name: name || 'N/A',
    value,
    color: colors[i % colors.length],
  }))
}

export interface FluxoMensalPonto {
  label: string
  entradas: number
  saidas: number
  acumulado: number
}

interface ValorDatado {
  data: string
  valor: number
}

/**
 * Agrupa entradas e saídas por mês e devolve o formato do CashFlowChart.
 *
 * `acumulado` é o **fluxo líquido acumulado dentro do período**, começando em zero — não é
 * saldo bancário. Partir do saldo exigiria replicar a caminhada de timeline dia-a-dia do
 * FluxoCaixa, e um acumulado meio-saldo/meio-fluxo seria ambíguo de ler.
 */
export function fluxoMensal(entradas: ValorDatado[], saidas: ValorDatado[]): FluxoMensalPonto[] {
  const buckets: Record<string, { entradas: number; saidas: number }> = {}

  const acumular = (rows: ValorDatado[], campo: 'entradas' | 'saidas') => {
    for (const r of rows) {
      const d = parseDate(r.data)
      if (!d) continue
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!buckets[key]) buckets[key] = { entradas: 0, saidas: 0 }
      buckets[key][campo] += r.valor
    }
  }

  acumular(entradas, 'entradas')
  acumular(saidas, 'saidas')

  let acumulado = 0
  return Object.keys(buckets)
    .sort()
    .map((key) => {
      const b = buckets[key]
      acumulado += b.entradas - b.saidas
      const [ano, mes] = key.split('-')
      return { label: `${mes}/${ano}`, entradas: b.entradas, saidas: b.saidas, acumulado }
    })
}

export interface SaldoConsolidado {
  total: number
  porEmpresa: Record<string, number>
  contas: number
}

/**
 * Saldo bancário consolidado numa data, replicando a regra de override do FluxoCaixa:
 * uma empresa que tenha **qualquer** conta com `saldo_config.enabled` descarta por completo
 * suas linhas vivas de `saldo_banco` e passa a valer pelos valores configurados.
 *
 * É uma **posição pontual** ("saldo em DD/MM/AAAA"), deliberadamente mais simples que a
 * caminhada de timeline do FluxoCaixa. O KPI "Saldo" daquela página é outra coisa
 * (saldo inicial + entradas − saídas do período) e pode divergir deste número.
 *
 * Saldo bancário não tem dimensão de obra, então o filtro de obras é ignorado aqui —
 * mesmo comportamento do FluxoCaixa.
 */
export function saldoConsolidado(
  saldos: SaldoRecord[],
  configs: SaldoConfig[],
  scope: ScopeFilters,
  aoDia: Date = startOfToday(),
): SaldoConsolidado {
  const escopoConta: ScopeFilters = { ...scope, obras: [] }
  const empresasManuais = new Set(configs.filter((c) => c.enabled).map((c) => c.empresa))
  const ultimo: Record<string, { data: Date; saldo: number; empresa: string }> = {}

  for (const r of saldos) {
    if (empresasManuais.has(r.empresa)) continue
    if (!matchesScope(r, escopoConta)) continue
    const d = parseDate(r.data)
    if (!d || d > aoDia) continue
    const key = `${r.empresa}|${r.banco}|${r.conta}`
    const atual = ultimo[key]
    if (!atual || d > atual.data) ultimo[key] = { data: d, saldo: r.saldo, empresa: r.empresa }
  }

  for (const c of configs) {
    if (!c.enabled) continue
    if (!matchesScope({ empresa: c.empresa, banco: c.banco, conta: c.conta }, escopoConta)) continue
    ultimo[`${c.empresa}|${c.banco}|${c.conta}`] = { data: aoDia, saldo: c.saldo, empresa: c.empresa }
  }

  const porEmpresa: Record<string, number> = {}
  let total = 0
  for (const { empresa, saldo } of Object.values(ultimo)) {
    porEmpresa[empresa] = (porEmpresa[empresa] ?? 0) + saldo
    total += saldo
  }

  return { total, porEmpresa, contas: Object.keys(ultimo).length }
}
