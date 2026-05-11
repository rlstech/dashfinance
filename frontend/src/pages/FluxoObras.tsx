import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Upload } from 'lucide-react'
import {
  useFilterTree,
  useFluxoObrasTodas,
  useImportarPlanilhaObras,
  useSavePlanejamento,
} from '@/hooks/useFinanceiro'
import { formatCurrency } from '@/lib/formatters'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { FluxoMesRow, FluxoPlanejamentoResponse, UpsertPlanejamentoIn } from '@/types'

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

const currentYear = new Date().getFullYear()
const ANOS = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1]

// ── Célula editável inline ────────────────────────────────────────────────────

interface EditableCellProps {
  value: number
  onSave: (v: number) => void
  disabled?: boolean
}

function EditableCell({ value, onSave, disabled }: EditableCellProps) {
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function startEdit() {
    if (disabled) return
    setRaw(value === 0 ? '' : String(value))
    setEditing(true)
  }

  function commit() {
    const parsed = parseFloat(raw.replace(',', '.'))
    onSave(isNaN(parsed) ? 0 : parsed)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="w-full text-right tabular-nums text-xs bg-white border-2 border-brand px-1 py-0.5 outline-none min-w-[80px]"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
      />
    )
  }

  return (
    <span
      className={cn(
        'block w-full text-right tabular-nums text-xs px-1 py-0.5',
        disabled ? 'cursor-default' : 'cursor-pointer hover:bg-brand/10',
        value === 0 ? 'text-muted-foreground/30' : 'text-dark',
      )}
      onClick={startEdit}
      title={disabled ? undefined : 'Clique para editar'}
    >
      {value === 0 ? '—' : formatCurrency(value)}
    </span>
  )
}

// ── Célula somente leitura com cor ────────────────────────────────────────────

function ValueCell({ value, bold }: { value: number; bold?: boolean }) {
  const colorCls =
    value < 0 ? 'text-red-500' : value > 0 ? 'text-teal-600' : 'text-muted-foreground/30'
  return (
    <span className={cn('block w-full text-right tabular-nums text-xs px-1 py-0.5', colorCls, bold && 'font-black')}>
      {value === 0 ? '—' : formatCurrency(value)}
    </span>
  )
}

// ── Seção de uma obra ─────────────────────────────────────────────────────────

interface ObraSectionProps {
  data: FluxoPlanejamentoResponse
  ano: number
  savePending: boolean
  onSave: (payload: UpsertPlanejamentoIn) => void
  defaultCollapsed: boolean
}

function ObraSection({ data, ano, savePending, onSave, defaultCollapsed }: ObraSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  const meses: FluxoMesRow[] = data.meses

  // Totais anuais para o header
  const totalCustoPrev = meses.reduce((s, m) => s + m.custo_previsto, 0)
  const totalRecPrev = meses.reduce((s, m) => s + m.receita_prevista, 0)
  const saldoPrev = totalRecPrev - totalCustoPrev

  // Fluxo acumulado
  let accPlan = 0
  let accReal = 0
  const acumuladoPlanejado = meses.map((m) => {
    accPlan += m.receita_prevista - m.custo_previsto
    return accPlan
  })
  const acumuladoReal = meses.map((m) => {
    accReal += m.receita_realizada - m.custo_real
    return accReal
  })

  function handleSave(mes: number, field: 'custo_previsto' | 'receita_prevista', value: number) {
    const current = meses[mes - 1]
    onSave({
      obra_codigo: data.obra_codigo,
      ano,
      mes,
      custo_previsto: field === 'custo_previsto' ? value : current.custo_previsto,
      receita_prevista: field === 'receita_prevista' ? value : current.receita_prevista,
    })
  }

  type RowDef =
    | { label: string; kind: 'editable'; field: 'custo_previsto' | 'receita_prevista'; values: number[] }
    | { label: string; kind: 'readonly' | 'accumulated'; values: number[] }

  const rowDefs: RowDef[] = [
    { label: 'Custo Previsto', kind: 'editable', field: 'custo_previsto', values: meses.map((m) => m.custo_previsto) },
    { label: 'Custo Real', kind: 'readonly', values: meses.map((m) => m.custo_real) },
    { label: 'Receita Prevista', kind: 'editable', field: 'receita_prevista', values: meses.map((m) => m.receita_prevista) },
    { label: 'Receita Realizada', kind: 'readonly', values: meses.map((m) => m.receita_realizada) },
    { label: 'Fluxo Acumulado Planejado', kind: 'accumulated', values: acumuladoPlanejado },
    { label: 'Fluxo Acumulado Real', kind: 'accumulated', values: acumuladoReal },
  ]

  return (
    <div className="bg-white block-border shadow-hard">
      {/* Header colapsável */}
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 bg-dark text-white hover:bg-dark/90 transition-colors"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-3">
          {collapsed
            ? <ChevronRight className="h-4 w-4 flex-shrink-0" />
            : <ChevronDown className="h-4 w-4 flex-shrink-0" />}
          <span className="text-xs font-black uppercase tracking-widest text-left">
            {data.obra_codigo}
          </span>
        </div>
        <div className="flex items-center gap-6 text-xs tabular-nums">
          <span className="hidden sm:inline text-white/60">
            Custo Prev: <span className="text-white font-bold">{formatCurrency(totalCustoPrev)}</span>
          </span>
          <span className="hidden sm:inline text-white/60">
            Rec Prev: <span className="text-white font-bold">{formatCurrency(totalRecPrev)}</span>
          </span>
          <span className={cn('font-black', saldoPrev >= 0 ? 'text-teal-300' : 'text-red-400')}>
            Saldo: {formatCurrency(saldoPrev)}
          </span>
        </div>
      </button>

      {/* Tabela */}
      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse" style={{ minWidth: '900px' }}>
            <thead>
              <tr className="bg-bgBase border-b-2 border-dark">
                <th className="text-left font-black uppercase tracking-widest px-4 py-2 sticky left-0 bg-bgBase z-10 w-52 border-r-2 border-grid">
                  Métrica
                </th>
                {MESES.map((m) => (
                  <th key={m} className="text-right font-black uppercase tracking-widest px-2 py-2 w-20">
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowDefs.map((row, rowIdx) => {
                const isAccumulated = row.kind === 'accumulated'
                const rowBg = isAccumulated ? 'bg-bgBase' : 'bg-white'
                return (
                  <tr
                    key={row.label}
                    className={cn('border-b border-grid hover:bg-brand/5 transition-colors', rowBg)}
                  >
                    <td
                      className={cn(
                        'px-4 py-1.5 font-bold uppercase tracking-wide text-xs sticky left-0 z-10 border-r-2 border-grid',
                        isAccumulated ? 'bg-bgBase font-black' : rowBg,
                      )}
                    >
                      {row.label}
                    </td>
                    {row.values.map((val, mesIdx) => (
                      <td key={mesIdx} className="px-1 py-1">
                        {row.kind === 'editable' ? (
                          <EditableCell
                            value={val}
                            disabled={savePending}
                            onSave={(v) => handleSave(mesIdx + 1, (row as { field: 'custo_previsto' | 'receita_prevista' }).field, v)}
                          />
                        ) : (
                          <ValueCell value={val} bold={isAccumulated} />
                        )}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function FluxoObras() {
  useEffect(() => {
    document.title = 'Fluxo de Obras | DashFinance'
  }, [])

  const [ano, setAno] = useState(currentYear)
  const [empresaFiltro, setEmpresaFiltro] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: tree } = useFilterTree()
  const { data: todasObras, isLoading } = useFluxoObrasTodas(ano)
  const savePlanejamento = useSavePlanejamento()
  const importarPlanilha = useImportarPlanilhaObras()

  const empresas = tree?.empresas ?? []

  const obrasFiltradas = useMemo(() => {
    if (!todasObras) return []
    if (empresaFiltro.length === 0) return todasObras
    const obrasDasEmpresas = new Set(
      empresaFiltro.flatMap((e) => tree?.obras_por_empresa?.[e] ?? []),
    )
    return todasObras.filter((o) => obrasDasEmpresas.has(o.obra_codigo))
  }, [todasObras, tree, empresaFiltro])

  // Colapsar por padrão quando há muitas obras
  const defaultCollapsed = (todasObras?.length ?? 0) > 5

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    importarPlanilha.mutate(file, {
      onSuccess: (result) => {
        const msg = `Importados: ${result.imported} registro(s).${
          result.errors.length ? '\n\nErros:\n' + result.errors.join('\n') : ''
        }`
        alert(msg)
      },
      onError: (err) => alert(`Erro na importação: ${err.message}`),
    })
    e.target.value = ''
  }

  return (
    <div className="flex h-full">
      <div className="p-6 md:p-8 overflow-auto flex-1">

        {/* Cabeçalho */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <h1 className="text-xl md:text-2xl font-black uppercase tracking-tight text-dark">
            Fluxo de Caixa Gerencial de Obras
          </h1>

          <div className="flex flex-wrap items-center gap-3">
            {/* Filtro de empresa */}
            <select
              className="text-xs font-bold uppercase tracking-widest border-2 border-dark px-3 py-2 bg-white focus:outline-none focus:border-brand max-w-[180px]"
              value={empresaFiltro[0] ?? ''}
              onChange={(e) => setEmpresaFiltro(e.target.value ? [e.target.value] : [])}
            >
              <option value="">Todas as Empresas</option>
              {empresas.map((emp) => (
                <option key={emp} value={emp}>{emp}</option>
              ))}
            </select>

            {/* Seletor de ano */}
            <select
              className="text-xs font-bold uppercase tracking-widest border-2 border-dark px-3 py-2 bg-white focus:outline-none focus:border-brand"
              value={ano}
              onChange={(e) => setAno(Number(e.target.value))}
            >
              {ANOS.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>

            {/* Botão importar */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importarPlanilha.isPending}
              className="bg-dark text-white text-xs font-black uppercase tracking-widest px-4 py-2 hover:bg-brand hover:text-dark transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              <Upload className="h-3.5 w-3.5" />
              {importarPlanilha.isPending ? 'Importando…' : 'Importar Planilha'}
            </button>
          </div>
        </div>

        {/* Conteúdo */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : obrasFiltradas.length === 0 ? (
          <div className="bg-white block-border shadow-hard p-12 text-center text-muted-foreground text-sm font-bold">
            {todasObras?.length === 0
              ? 'Nenhuma obra encontrada. Execute uma sincronização para carregar os dados.'
              : 'Nenhuma obra para a empresa selecionada.'}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {obrasFiltradas.length} obra(s) · Clique no cabeçalho de cada obra para expandir/colapsar ·
              Clique nas células de <strong>Custo Previsto</strong> ou <strong>Receita Prevista</strong> para editar
            </p>
            {obrasFiltradas.map((obra) => (
              <ObraSection
                key={obra.obra_codigo}
                data={obra}
                ano={ano}
                savePending={savePlanejamento.isPending}
                onSave={(payload) => savePlanejamento.mutate(payload)}
                defaultCollapsed={defaultCollapsed}
              />
            ))}
          </div>
        )}

        {savePlanejamento.isError && (
          <p className="mt-3 text-xs font-bold text-red-600">
            Erro ao salvar: {savePlanejamento.error?.message}
          </p>
        )}
      </div>
    </div>
  )
}
