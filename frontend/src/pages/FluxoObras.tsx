import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Pencil, Upload, X } from 'lucide-react'
import {
  useCreateGrupo,
  useDeleteGrupo,
  useFilterTree,
  useFluxoObrasTodas,
  useGruposObras,
  useImportarPlanilhaObras,
  useSavePlanejamento,
  useUpdateGrupo,
} from '@/hooks/useFinanceiro'
import { formatCurrency } from '@/lib/formatters'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { MultiSelect } from '@/components/filters/MultiSelect'
import type { FluxoMesRow, FluxoPlanejamentoResponse, GrupoObras, UpsertPlanejamentoIn } from '@/types'

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

// ── Modal de gerenciamento de grupos ─────────────────────────────────────────

interface GrupoModalProps {
  grupos: GrupoObras[]
  todasObras: string[]
  onClose: () => void
}

function GrupoModal({ grupos, todasObras, onClose }: GrupoModalProps) {
  const [editando, setEditando] = useState<GrupoObras | null>(null)
  const [criando, setCriando] = useState(false)
  const [nome, setNome] = useState('')
  const [descricao, setDescricao] = useState('')
  const [obrasSel, setObrasSel] = useState<string[]>([])

  const createGrupo = useCreateGrupo()
  const updateGrupo = useUpdateGrupo()
  const deleteGrupo = useDeleteGrupo()
  const isPending = createGrupo.isPending || updateGrupo.isPending || deleteGrupo.isPending

  function startCreate() {
    setEditando(null)
    setNome('')
    setDescricao('')
    setObrasSel([])
    setCriando(true)
  }

  function startEdit(g: GrupoObras) {
    setCriando(false)
    setNome(g.nome)
    setDescricao(g.descricao ?? '')
    setObrasSel(g.obras)
    setEditando(g)
  }

  function cancelForm() {
    setCriando(false)
    setEditando(null)
  }

  function saveForm() {
    if (!nome.trim()) return
    if (editando) {
      updateGrupo.mutate(
        { id: editando.id, nome: nome.trim(), descricao: descricao || undefined, obras: obrasSel },
        { onSuccess: () => setEditando(null) },
      )
    } else {
      createGrupo.mutate(
        { nome: nome.trim(), descricao: descricao || undefined, obras: obrasSel },
        { onSuccess: () => { setCriando(false); setNome(''); setDescricao(''); setObrasSel([]) } },
      )
    }
  }

  function handleDelete(g: GrupoObras) {
    if (!confirm(`Excluir o grupo "${g.nome}"?`)) return
    deleteGrupo.mutate(g.id)
  }

  const showForm = criando || editando !== null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white w-full max-w-2xl max-h-[90vh] flex flex-col block-border shadow-hard">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-dark text-white">
          <h2 className="text-sm font-black uppercase tracking-widest">Grupos de Análise</h2>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Conteúdo */}
        <div className="overflow-y-auto flex-1 p-6 space-y-3">
          {grupos.length === 0 && !showForm && (
            <p className="text-sm text-muted-foreground">Nenhum grupo criado. Clique em <strong>+ Novo Grupo</strong>.</p>
          )}

          {grupos.map((g) => (
            <div
              key={g.id}
              className={cn(
                'border-2 p-3 flex items-start justify-between gap-4',
                editando?.id === g.id ? 'border-brand' : 'border-grid',
              )}
            >
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-widest truncate">{g.nome}</p>
                {g.descricao && <p className="text-xs text-muted-foreground mt-0.5">{g.descricao}</p>}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {g.obras.length} obra(s){g.obras.length > 0 ? ': ' + g.obras.slice(0, 4).join(', ') + (g.obras.length > 4 ? '…' : '') : ''}
                </p>
              </div>
              <div className="flex gap-3 flex-shrink-0">
                <button
                  onClick={() => startEdit(g)}
                  disabled={isPending}
                  className="text-xs font-bold text-brand hover:underline disabled:opacity-50"
                >
                  Editar
                </button>
                <button
                  onClick={() => handleDelete(g)}
                  disabled={isPending}
                  className="text-xs font-bold text-red-500 hover:underline disabled:opacity-50"
                >
                  Excluir
                </button>
              </div>
            </div>
          ))}

          {showForm && (
            <div className="border-2 border-brand p-4 space-y-3">
              <p className="text-xs font-black uppercase tracking-widest">
                {editando ? 'Editar Grupo' : 'Novo Grupo'}
              </p>
              <input
                className="w-full text-xs border-2 border-dark px-3 py-2 focus:outline-none focus:border-brand"
                placeholder="Nome do grupo *"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveForm() }}
              />
              <input
                className="w-full text-xs border-2 border-grid px-3 py-2 focus:outline-none focus:border-brand"
                placeholder="Descrição (opcional)"
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
              />
              <MultiSelect
                label="Obras"
                options={todasObras}
                selected={obrasSel}
                onChange={setObrasSel}
                allLabel="Todas"
              />
              {(createGrupo.isError || updateGrupo.isError) && (
                <p className="text-xs font-bold text-red-600">
                  {(createGrupo.error ?? updateGrupo.error)?.message}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={saveForm}
                  disabled={!nome.trim() || isPending}
                  className="text-xs font-black uppercase tracking-widest bg-dark text-white px-4 py-2 hover:bg-brand hover:text-dark disabled:opacity-50 transition-colors"
                >
                  {isPending ? 'Salvando…' : 'Salvar'}
                </button>
                <button
                  onClick={cancelForm}
                  className="text-xs font-bold uppercase text-muted-foreground hover:text-dark px-4 py-2 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!showForm && (
          <div className="px-6 py-4 border-t-2 border-grid">
            <button
              onClick={startCreate}
              className="text-xs font-black uppercase tracking-widest bg-dark text-white px-4 py-2 hover:bg-brand hover:text-dark transition-colors"
            >
              + Novo Grupo
            </button>
          </div>
        )}
      </div>
    </div>
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
  const [obrasSelecionadas, setObrasSelecionadas] = useState<string[]>([])
  const [grupoSelecionado, setGrupoSelecionado] = useState<number | null>(null)
  const [modalGrupos, setModalGrupos] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: tree } = useFilterTree()
  const { data: todasObras, isLoading } = useFluxoObrasTodas(ano)
  const { data: grupos = [] } = useGruposObras()
  const savePlanejamento = useSavePlanejamento()
  const importarPlanilha = useImportarPlanilhaObras()

  const empresas = tree?.empresas ?? []

  const obrasDisponiveis = useMemo(() => {
    const fonte = empresaFiltro.length > 0 ? empresaFiltro : (tree?.empresas ?? [])
    return fonte.flatMap((e) => tree?.obras_por_empresa?.[e] ?? []).sort()
  }, [tree, empresaFiltro])

  const todasObrasDisponiveis = useMemo(() => {
    return Object.values(tree?.obras_por_empresa ?? {}).flat().sort()
  }, [tree])

  const obrasFiltradas = useMemo(() => {
    if (!todasObras) return []

    if (grupoSelecionado !== null) {
      const grupo = grupos.find((g) => g.id === grupoSelecionado)
      if (grupo) {
        const setObras = new Set(grupo.obras)
        return todasObras.filter((o) => setObras.has(o.obra_codigo))
      }
    }

    let result = todasObras

    if (empresaFiltro.length > 0) {
      const obrasDasEmpresas = new Set(
        empresaFiltro.flatMap((e) => tree?.obras_por_empresa?.[e] ?? []),
      )
      result = result.filter((o) => obrasDasEmpresas.has(o.obra_codigo))
    }

    if (obrasSelecionadas.length > 0) {
      const setObras = new Set(obrasSelecionadas)
      result = result.filter((o) => setObras.has(o.obra_codigo))
    }

    return result
  }, [todasObras, tree, empresaFiltro, obrasSelecionadas, grupoSelecionado, grupos])

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
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <h1 className="text-xl md:text-2xl font-black uppercase tracking-tight text-dark">
            Fluxo de Caixa Gerencial de Obras
          </h1>

          <div className="flex flex-col gap-3 items-end">
            {/* Linha 1: grupo de análise */}
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  Grupo de Análise
                </span>
                <select
                  className={cn(
                    'text-xs font-bold uppercase tracking-widest border-2 px-3 py-2 bg-white focus:outline-none transition-colors',
                    grupoSelecionado !== null ? 'border-brand text-brand' : 'border-dark',
                  )}
                  value={grupoSelecionado ?? ''}
                  onChange={(e) => {
                    const val = e.target.value
                    if (val === '') {
                      setGrupoSelecionado(null)
                    } else {
                      setGrupoSelecionado(Number(val))
                      setEmpresaFiltro([])
                      setObrasSelecionadas([])
                    }
                  }}
                >
                  <option value="">Todas as obras</option>
                  {grupos.map((g) => (
                    <option key={g.id} value={g.id}>{g.nome}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={() => setModalGrupos(true)}
                className="text-xs font-black uppercase tracking-widest border-2 border-dark px-3 py-2 bg-white hover:bg-brand hover:border-brand hover:text-dark transition-colors flex items-center gap-1.5"
              >
                <Pencil className="h-3 w-3" />
                Gerenciar Grupos
              </button>
            </div>

            {/* Linha 2: filtros */}
            <div className="flex flex-wrap items-end gap-3">
              <div className={cn('flex flex-wrap items-end gap-3', grupoSelecionado !== null && 'opacity-40 pointer-events-none')}>
                <MultiSelect
                  label="Empresa"
                  options={empresas}
                  selected={empresaFiltro}
                  onChange={(val) => { setEmpresaFiltro(val); setObrasSelecionadas([]) }}
                  allLabel="Todas"
                />

                <MultiSelect
                  label="Obra"
                  options={obrasDisponiveis}
                  selected={obrasSelecionadas}
                  onChange={setObrasSelecionadas}
                  allLabel="Todas"
                />
              </div>

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
        </div>

        {/* Modal de grupos */}
        {modalGrupos && (
          <GrupoModal
            grupos={grupos}
            todasObras={todasObrasDisponiveis}
            onClose={() => setModalGrupos(false)}
          />
        )}

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
              : 'Nenhuma obra para os filtros selecionados.'}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {grupoSelecionado !== null && (
                <span className="inline-flex items-center gap-1 mr-2 px-2 py-0.5 bg-brand/10 text-brand font-bold border border-brand/30">
                  {grupos.find((g) => g.id === grupoSelecionado)?.nome}
                  <button
                    onClick={() => setGrupoSelecionado(null)}
                    className="hover:text-dark"
                    title="Limpar grupo"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
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
