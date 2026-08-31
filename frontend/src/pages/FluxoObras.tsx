import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type RefObject } from 'react'
import { ArrowLeft, ChevronDown, ChevronRight, EyeOff, FileDown, GripVertical, History, Lock, Pencil, Plus, RefreshCw, Search, Settings2, Share2, Trash2, X } from 'lucide-react'
import {
  useAtualizarFluxoReal,
  useCreateGrupo,
  useCreateCustoFinanceiroCategoria,
  useCreateCustoFinanceiroRegraPar,
  useCustoFinanceiro,
  useCustoFinanceiroCategorias,
  useCustoFinanceiroLancamentos,
  useCustoFinanceiroLancamentosSuprimidos,
  useCustoFinanceiroRegrasPar,
  useCustoFinanceiroTransferenciasContas,
  useDeleteCustoFinanceiroCategoria,
  useDeleteCustoFinanceiroRegraPar,
  useDeleteGrupo,
  useFilterTree,
  useFluxoObrasTodas,
  useFluxoRealCache,
  useGruposObras,
  useGruposTotaisPrevistos,
  useGruposTotaisReais,
  useObraLogs,
  useSaveObraPlanejamento,
  useSavePeriodoGrupo,
  useSetLancamentoCategoria,
  useReorderCustoFinanceiroCategorias,
  useUpdateCustoFinanceiroCategoria,
  useUpdateCustoFinanceiroRegraPar,
  useUpdateGrupo,
  useUsers,
} from '@/hooks/useFinanceiro'
import { useAuthStore } from '@/hooks/useAuth'
import { formatCurrency, formatDateTime, formatBRLThousands, parseBRLInput } from '@/lib/formatters'
import { exportFluxoObrasPDF } from '@/lib/exportFluxoObras'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import type { FluxoMesRow, FluxoPlanejamentoResponse, GrupoObras, GrupoShareItem, GrupoTotaisReais, PlanejamentoLogEntry, SaveObraPlanejamentoIn, Periodo, CustoFinanceiroResponse, CustoFinanceiroCategoria, LancamentoConta, LancamentoDetalhe, LancamentoSuprimido, RegraParTransferencia } from '@/types'
import { PeriodoMesesSelector } from '@/components/filters/PeriodoMesesSelector'

const CATEGORIA_NAO_CLASSIFICADA = 0

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

const currentYear = new Date().getFullYear()
const CUR_YEAR = new Date().getFullYear()
const CUR_MONTH = new Date().getMonth() + 1
// Mês atual em diante (usado pela projeção do Fluxo Acumulado Real)
function isMesProjetado(ano: number, mes: number): boolean {
  return ano > CUR_YEAR || (ano === CUR_YEAR && mes >= CUR_MONTH)
}

// ── Input de valor monetário com separador de milhar em tempo real ──────────

function MoneyInput({
  raw, onRawChange, onCommit, onCancel, className, inputRef,
}: {
  raw: string
  onRawChange: (raw: string) => void
  onCommit: () => void
  onCancel: () => void
  className?: string
  inputRef: RefObject<HTMLInputElement | null>
}) {
  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const el = e.target
    const caret = el.selectionStart ?? el.value.length
    const digitsBeforeCaret = el.value.slice(0, caret).replace(/[^\d,]/g, '').length
    const formatted = formatBRLThousands(el.value)
    onRawChange(formatted)
    requestAnimationFrame(() => {
      if (!inputRef.current) return
      let count = 0
      let pos = 0
      for (; pos < formatted.length; pos++) {
        if (/[\d,]/.test(formatted[pos])) count++
        if (count >= digitsBeforeCaret) { pos++; break }
      }
      inputRef.current.setSelectionRange(pos, pos)
    })
  }

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={raw}
      onChange={handleChange}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit()
        if (e.key === 'Escape') onCancel()
      }}
      className={className}
    />
  )
}

// ── Célula editável inline ────────────────────────────────────────────────────

interface EditableCellProps {
  value: number
  onSave: (v: number) => void
  disabled?: boolean
  colorCls?: string
  locked?: boolean
  lockedMessage?: string
}

function EditableCell({ value, onSave, disabled, colorCls, locked, lockedMessage }: EditableCellProps) {
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function startEdit() {
    if (disabled) return
    if (locked) {
      window.alert(lockedMessage ?? 'Informe primeiro o valor global.')
      return
    }
    setRaw(value === 0 ? '' : String(value))
    setEditing(true)
  }

  function commit() {
    onSave(parseBRLInput(raw))
    setEditing(false)
  }

  if (editing) {
    return (
      <MoneyInput
        raw={raw}
        onRawChange={setRaw}
        onCommit={commit}
        onCancel={() => setEditing(false)}
        inputRef={inputRef}
        className="w-full text-right tabular-nums text-xs bg-white border-2 border-brand px-1 py-0.5 outline-none min-w-[80px]"
      />
    )
  }

  return (
    <span
      className={cn(
        'block w-full text-right tabular-nums text-xs px-1 py-0.5',
        disabled ? 'cursor-default' : 'cursor-pointer hover:bg-brand/10',
        value === 0 ? 'text-muted-foreground/30' : (colorCls ?? 'text-dark'),
      )}
      onClick={startEdit}
      title={disabled ? undefined : (locked ? lockedMessage : 'Clique para editar')}
    >
      {value === 0 ? '—' : formatCurrency(value)}
    </span>
  )
}

// ── Célula somente leitura com cor ────────────────────────────────────────────

function ValueCell({ value, bold, colorCls, projected }: { value: number; bold?: boolean; colorCls?: string; projected?: boolean }) {
  const autoCls =
    value < 0 ? 'text-red-500' : value > 0 ? 'text-teal-600' : 'text-muted-foreground/30'
  const cls = value === 0 ? 'text-muted-foreground/30' : (colorCls ?? autoCls)
  return (
    <span className={cn(
      'block w-full text-right tabular-nums text-xs px-1 py-0.5',
      cls,
      bold && 'font-black',
      projected && 'italic bg-violet-50 text-violet-700',
    )}>
      {value === 0 ? '—' : formatCurrency(value)}
    </span>
  )
}

// ── Modal de gerenciamento de grupos ─────────────────────────────────────────

interface GrupoModalProps {
  grupos: GrupoObras[]
  obrasPorEmpresa: Record<string, string[]>
  onClose: () => void
  initialEditando?: GrupoObras
  startInCreate?: boolean
}

function GrupoModal({ grupos, obrasPorEmpresa, onClose, initialEditando, startInCreate }: GrupoModalProps) {
  const currentUser = useAuthStore((s) => s.user)
  const [editando, setEditando] = useState<GrupoObras | null>(initialEditando ?? null)
  const [criando, setCriando] = useState(startInCreate ?? false)
  const [nome, setNome] = useState(initialEditando?.nome ?? '')
  const [descricao, setDescricao] = useState(initialEditando?.descricao ?? '')
  const [obrasSel, setObrasSel] = useState<string[]>(initialEditando?.obras ?? [])
  const [percentuais, setPercentuais] = useState<Record<string, number>>(initialEditando?.percentuais ?? {})
  const [obraEspecial, setObraEspecial] = useState<string>(initialEditando?.obra_especial ?? '')
  const [empresaFiltro, setEmpresaFiltro] = useState<string | null>(null)
  const [buscaObra, setBuscaObra] = useState('')
  const [shares, setShares] = useState<GrupoShareItem[]>(initialEditando?.shared_with ?? [])
  const [empresasGreedy, setEmpresasGreedy] = useState<string[]>(initialEditando?.empresas_greedy ?? [])
  const [incluirCustoFinanceiro, setIncluirCustoFinanceiro] = useState<boolean>(initialEditando?.incluir_custo_financeiro ?? false)
  const [custoFinanceiroEmpresas, setCustoFinanceiroEmpresas] = useState<string[]>(initialEditando?.custo_financeiro_empresas ?? [])
  const [custoFinanceiroContas, setCustoFinanceiroContas] = useState<LancamentoConta[]>(initialEditando?.custo_financeiro_contas ?? [])

  const { data: transferenciasContas = [] } = useCustoFinanceiroTransferenciasContas(incluirCustoFinanceiro)

  const createGrupo = useCreateGrupo()
  const updateGrupo = useUpdateGrupo()
  const deleteGrupo = useDeleteGrupo()
  const { data: allUsers = [] } = useUsers()
  const isPending = createGrupo.isPending || updateGrupo.isPending || deleteGrupo.isPending

  const otherUsers = useMemo(
    () => allUsers.filter((u) => u.id !== currentUser?.id),
    [allUsers, currentUser],
  )

  const empresas = useMemo(() => Object.keys(obrasPorEmpresa).sort(), [obrasPorEmpresa])

  const obrasVisiveis = useMemo(() => {
    const fonte = empresaFiltro
      ? (obrasPorEmpresa[empresaFiltro] ?? [])
      : Object.values(obrasPorEmpresa).flat()
    const termo = buscaObra.trim().toLowerCase()
    const unicas = [...new Set(fonte)].sort()
    return termo ? unicas.filter((o) => o.toLowerCase().includes(termo)) : unicas
  }, [obrasPorEmpresa, empresaFiltro, buscaObra])

  function resetForm() {
    setNome(''); setDescricao(''); setObrasSel([])
    setPercentuais({}); setObraEspecial('')
    setEmpresaFiltro(null); setBuscaObra('')
    setShares([]); setEmpresasGreedy([]); setIncluirCustoFinanceiro(false)
    setCustoFinanceiroEmpresas([])
    setCustoFinanceiroContas([])
  }

  function startCreate() {
    setEditando(null)
    resetForm()
    setCriando(true)
  }

  function startEdit(g: GrupoObras) {
    setCriando(false)
    setNome(g.nome)
    setDescricao(g.descricao ?? '')
    setObrasSel(g.obras)
    setPercentuais(g.percentuais ?? {})
    setObraEspecial(g.obra_especial ?? '')
    setEmpresaFiltro(null)
    setBuscaObra('')
    setShares(g.shared_with ?? [])
    setEmpresasGreedy(g.empresas_greedy ?? [])
    setIncluirCustoFinanceiro(g.incluir_custo_financeiro ?? false)
    setCustoFinanceiroEmpresas(g.custo_financeiro_empresas ?? [])
    setCustoFinanceiroContas(g.custo_financeiro_contas ?? [])
    setEditando(g)
  }

  function cancelForm() {
    setCriando(false)
    setEditando(null)
    resetForm()
  }

  function saveForm() {
    if (!nome.trim()) return
    const payload = {
      nome: nome.trim(),
      descricao: descricao || undefined,
      obras: obrasSel,
      percentuais,
      obra_especial: obraEspecial || undefined,
      shared_with: shares,
      empresas_greedy: empresasGreedy,
      incluir_custo_financeiro: incluirCustoFinanceiro,
      custo_financeiro_empresas: custoFinanceiroEmpresas,
      custo_financeiro_contas: custoFinanceiroContas,
    }
    if (editando) {
      updateGrupo.mutate({ id: editando.id, ...payload }, { onSuccess: () => onClose() })
    } else {
      createGrupo.mutate(payload, { onSuccess: () => onClose() })
    }
  }

  function handleDelete(g: GrupoObras) {
    if (!confirm(`Excluir o grupo "${g.nome}"?`)) return
    deleteGrupo.mutate(g.id, { onSuccess: () => onClose() })
  }

  function toggleShare(userId: number) {
    setShares((prev) => {
      const idx = prev.findIndex((s) => s.user_id === userId)
      if (idx >= 0) return prev.filter((_, i) => i !== idx)
      return [...prev, { user_id: userId, permission: 'view' }]
    })
  }

  function setSharePermission(userId: number, permission: 'view' | 'edit') {
    setShares((prev) => prev.map((s) => (s.user_id === userId ? { ...s, permission } : s)))
  }

  const canEditGrupo = (g: GrupoObras) => g.can_edit === true

  function toggleObra(obra: string) {
    setObrasSel((prev) =>
      prev.includes(obra) ? prev.filter((o) => o !== obra) : [...prev, obra],
    )
  }

  function selecionarVisiveis() {
    setObrasSel((prev) => [...new Set([...prev, ...obrasVisiveis])])
  }

  function limparSelecao() {
    setObrasSel([])
  }

  const showForm = criando || editando !== null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white w-full max-w-3xl max-h-[92vh] flex flex-col block-border shadow-hard">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-dark text-white flex-shrink-0">
          <h2 className="text-sm font-black uppercase tracking-widest">
            {showForm ? (editando ? 'Editar Grupo' : 'Novo Grupo') : 'Grupos de Análise'}
          </h2>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Conteúdo */}
        <div className="overflow-y-auto flex-1 p-6 space-y-3">
          {!showForm && grupos.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum grupo criado. Clique em <strong>+ Novo Grupo</strong>.</p>
          )}

          {!showForm && grupos.map((g) => (
            <div key={g.id} className="border-2 border-grid p-3 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-black uppercase tracking-widest truncate">{g.nome}</p>
                  {!g.is_owner && (
                    <span className="flex-shrink-0 text-[9px] font-black uppercase tracking-widest bg-brand/10 text-brand px-1.5 py-0.5">
                      Compartilhado
                    </span>
                  )}
                  {g.is_owner && (g.shared_with?.length ?? 0) > 0 && (
                    <span className="flex-shrink-0 text-[9px] font-black uppercase tracking-widest bg-teal-50 text-teal-700 px-1.5 py-0.5">
                      {g.shared_with!.length} usuário(s)
                    </span>
                  )}
                </div>
                {g.descricao && <p className="text-xs text-muted-foreground mt-0.5">{g.descricao}</p>}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {g.obras.length} obra(s){g.obras.length > 0 ? ': ' + g.obras.slice(0, 4).join(', ') + (g.obras.length > 4 ? '…' : '') : ''}
                </p>
              </div>
              {canEditGrupo(g) && (
                <div className="flex gap-3 flex-shrink-0">
                  <button onClick={() => startEdit(g)} disabled={isPending} className="text-xs font-bold text-brand hover:underline disabled:opacity-50">Editar</button>
                  <button onClick={() => handleDelete(g)} disabled={isPending} className="text-xs font-bold text-red-500 hover:underline disabled:opacity-50">Excluir</button>
                </div>
              )}
            </div>
          ))}

          {showForm && (
            <div className="space-y-3">
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

              {/* Seletor de obras */}
              <div className="border-2 border-grid">
                {/* Label + contador */}
                <div className="flex items-center justify-between px-3 py-2 bg-bgBase border-b border-grid">
                  <span className="text-[10px] font-black uppercase tracking-widest text-dark">Obras</span>
                  <span className="text-[10px] font-bold text-muted-foreground">
                    {obrasSel.length} selecionada(s)
                  </span>
                </div>

                {/* Chips de empresa */}
                <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-grid">
                  <button
                    type="button"
                    onClick={() => setEmpresaFiltro(null)}
                    className={cn(
                      'text-[10px] font-black uppercase tracking-widest px-2 py-1 border transition-colors',
                      empresaFiltro === null
                        ? 'bg-dark text-white border-dark'
                        : 'border-grid text-muted-foreground hover:bg-bgBase',
                    )}
                  >
                    Todas
                  </button>
                  {empresas.map((emp) => (
                    <button
                      key={emp}
                      type="button"
                      onClick={() => setEmpresaFiltro(emp)}
                      className={cn(
                        'text-[10px] font-black uppercase tracking-widest px-2 py-1 border transition-colors',
                        empresaFiltro === emp
                          ? 'bg-dark text-white border-dark'
                          : 'border-grid text-muted-foreground hover:bg-bgBase',
                      )}
                    >
                      {emp}
                    </button>
                  ))}
                </div>

                {/* Campo de busca */}
                <div className="relative border-b border-grid">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                  <input
                    className="w-full text-xs pl-8 pr-3 py-2 focus:outline-none focus:bg-brand/5 bg-white placeholder:text-muted-foreground/60"
                    placeholder="Buscar obra..."
                    value={buscaObra}
                    onChange={(e) => setBuscaObra(e.target.value)}
                  />
                </div>

                {/* Checklist */}
                <div className="max-h-48 overflow-y-auto">
                  {obrasVisiveis.length === 0 ? (
                    <p className="px-3 py-4 text-xs text-muted-foreground text-center">Nenhuma obra encontrada.</p>
                  ) : (
                    obrasVisiveis.map((obra) => {
                      const checked = obrasSel.includes(obra)
                      return (
                        <div
                          key={obra}
                          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-brand/5 border-b border-grid/50 last:border-0"
                        >
                          <input
                            type="checkbox"
                            className="accent-brand flex-shrink-0 cursor-pointer"
                            checked={checked}
                            onChange={() => toggleObra(obra)}
                          />
                          <span
                            className="text-xs text-dark truncate flex-1 cursor-pointer select-none"
                            onClick={() => toggleObra(obra)}
                          >
                            {obra}
                          </span>
                          {checked && (
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.1"
                                className="w-16 text-xs text-right border border-grid px-1.5 py-0.5 focus:outline-none focus:border-brand"
                                placeholder="0"
                                value={percentuais[obra] ?? ''}
                                onChange={(e) => {
                                  const v = parseFloat(e.target.value)
                                  setPercentuais((prev) => ({ ...prev, [obra]: isNaN(v) ? 0 : v }))
                                }}
                              />
                              <span className="text-[10px] text-muted-foreground">%</span>
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>

                {/* Ações da lista */}
                <div className="flex items-center gap-3 px-3 py-2 border-t border-grid bg-bgBase">
                  <button type="button" onClick={selecionarVisiveis} className="text-[10px] font-bold text-brand hover:underline">
                    Selecionar todas visíveis
                  </button>
                  <span className="text-muted-foreground/40">·</span>
                  <button type="button" onClick={limparSelecao} className="text-[10px] font-bold text-muted-foreground hover:text-red-500">
                    Limpar seleção
                  </button>
                </div>
              </div>

              {/* Obra Especial */}
              <div className="border-2 border-grid p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-dark">Obra Especial</span>
                </div>
                <select
                  className="w-full text-xs border-2 border-grid px-3 py-2 focus:outline-none focus:border-brand bg-white"
                  value={obraEspecial}
                  onChange={(e) => setObraEspecial(e.target.value)}
                >
                  <option value="">— Nenhuma —</option>
                  {obrasSel.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
                {obraEspecial && (
                  <p className="text-[10px] text-muted-foreground">
                    Esta obra terá sua receita calculada como soma ponderada (%) das receitas das demais obras do grupo.
                  </p>
                )}
              </div>

              {/* Demais Obras — empresas greedy */}
              {empresas.length > 0 && (
                <div className="border-2 border-grid p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-dark">Demais Obras</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Selecione empresas para incluir um card com todas as outras obras (não pertencentes a este grupo) no consolidado operacional.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {empresas.map((emp) => (
                      <label key={emp} className="flex items-center gap-1.5 text-xs cursor-pointer select-none hover:bg-brand/5 px-1 py-0.5">
                        <input
                          type="checkbox"
                          className="accent-brand flex-shrink-0"
                          checked={empresasGreedy.includes(emp)}
                          onChange={(e) => setEmpresasGreedy((prev) =>
                            e.target.checked ? [...prev, emp] : prev.filter((x) => x !== emp)
                          )}
                        />
                        <span>{emp}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Custo Financeiro */}
              <div className="border-2 border-grid p-3 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="accent-brand flex-shrink-0"
                    checked={incluirCustoFinanceiro}
                    onChange={(e) => {
                      const checked = e.target.checked
                      setIncluirCustoFinanceiro(checked)
                      if (checked && custoFinanceiroEmpresas.length === 0) {
                        const inferidas = empresas.filter((emp) =>
                          (obrasPorEmpresa[emp] ?? []).some((o) => obrasSel.includes(o))
                        )
                        if (inferidas.length) setCustoFinanceiroEmpresas(inferidas)
                      }
                    }}
                  />
                  <span className="text-[10px] font-black uppercase tracking-widest text-dark">Custo Financeiro</span>
                </label>
                <p className="text-[10px] text-muted-foreground">
                  Exibe ao final do grupo um card de tesouraria consolidado com transferências bancárias e controle financeiro, mês a mês.
                </p>
                {incluirCustoFinanceiro && empresas.length > 0 && (
                  <div className="space-y-1 pt-1">
                    <span className="text-[10px] font-black uppercase tracking-widest text-dark">Empresas consideradas</span>
                    <p className="text-[10px] text-muted-foreground">
                      Somente transferências bancárias e controle financeiro dessas empresas entram no card. Se nenhuma for marcada, todas as empresas visíveis para você serão consideradas.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {empresas.map((emp) => (
                        <label key={emp} className="flex items-center gap-1.5 text-xs cursor-pointer select-none hover:bg-brand/5 px-1 py-0.5">
                          <input
                            type="checkbox"
                            className="accent-brand flex-shrink-0"
                            checked={custoFinanceiroEmpresas.includes(emp)}
                            onChange={(e) => setCustoFinanceiroEmpresas((prev) =>
                              e.target.checked ? [...prev, emp] : prev.filter((x) => x !== emp)
                            )}
                          />
                          <span>{emp}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {incluirCustoFinanceiro && (transferenciasContas.length > 0 || custoFinanceiroContas.length > 0) && (
                  <div className="space-y-1 pt-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-black uppercase tracking-widest text-dark">Contas consideradas (Transferências Bancárias)</span>
                      {custoFinanceiroContas.length > 0 && (
                        <button
                          type="button"
                          className="text-[10px] text-brand hover:underline flex-shrink-0"
                          onClick={() => setCustoFinanceiroContas([])}
                        >
                          Limpar filtro de contas
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Restringe quais contas bancárias entram nas Transferências Bancárias do card (não afeta o Controle Financeiro). Se nenhuma conta for marcada, todas as contas das empresas consideradas acima entram.
                    </p>
                    <div className="border-2 border-grid max-h-40 overflow-auto divide-y divide-grid/50">
                      {[
                        ...transferenciasContas,
                        ...custoFinanceiroContas.filter(
                          (s) => !transferenciasContas.some((c) => c.empresa === s.empresa && c.banco === s.banco && c.conta === s.conta),
                        ),
                      ]
                        .filter((c) => custoFinanceiroEmpresas.length === 0 || custoFinanceiroEmpresas.includes(c.empresa))
                        .map((c) => {
                          const checked = custoFinanceiroContas.some(
                            (s) => s.empresa === c.empresa && s.banco === c.banco && s.conta === c.conta,
                          )
                          const orfa = !transferenciasContas.some(
                            (t) => t.empresa === c.empresa && t.banco === c.banco && t.conta === c.conta,
                          )
                          return (
                            <label key={`${c.empresa}-${c.banco}-${c.conta}`} className="flex items-center gap-2 px-2 py-1 text-xs cursor-pointer hover:bg-brand/5">
                              <input
                                type="checkbox"
                                className="accent-brand flex-shrink-0"
                                checked={checked}
                                onChange={(e) => setCustoFinanceiroContas((prev) =>
                                  e.target.checked
                                    ? [...prev, { empresa: c.empresa, banco: c.banco, conta: c.conta }]
                                    : prev.filter((s) => !(s.empresa === c.empresa && s.banco === c.banco && s.conta === c.conta))
                                )}
                              />
                              <span className="text-[9px] uppercase font-bold text-muted-foreground w-24 flex-shrink-0 truncate">{c.empresa}</span>
                              <span className="truncate flex-1">Banco {c.banco} / Conta {c.conta}</span>
                              {orfa && (
                                <span className="text-[9px] text-amber-600 flex-shrink-0" title="Essa conta está marcada no filtro salvo, mas não aparece nos lançamentos atuais.">
                                  sem lançamentos recentes
                                </span>
                              )}
                            </label>
                          )
                        })}
                    </div>
                  </div>
                )}
              </div>

              {/* Compartilhar com */}
              {otherUsers.length > 0 && (
                <div className="border-2 border-grid p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Share2 className="h-3 w-3 text-muted-foreground" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-dark">Compartilhar com</span>
                  </div>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {otherUsers.map((u) => {
                      const share = shares.find((s) => s.user_id === u.id)
                      const isShared = !!share
                      return (
                        <div
                          key={u.id}
                          className="flex items-center gap-2 text-xs px-1 py-1 hover:bg-brand/5"
                        >
                          <label className="flex items-center gap-2 cursor-pointer select-none flex-1 min-w-0">
                            <input
                              type="checkbox"
                              className="accent-brand flex-shrink-0"
                              checked={isShared}
                              onChange={() => toggleShare(u.id)}
                            />
                            <span className="truncate">{u.name}</span>
                          </label>
                          {isShared && (
                            <select
                              value={share!.permission}
                              onChange={(e) => setSharePermission(u.id, e.target.value as 'view' | 'edit')}
                              className="text-[10px] font-bold uppercase tracking-widest border border-grid px-1.5 py-0.5 bg-white focus:outline-none focus:border-brand"
                            >
                              <option value="view">Ver</option>
                              <option value="edit">Editar</option>
                            </select>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {(createGrupo.isError || updateGrupo.isError) && (
                <p className="text-xs font-bold text-red-600">
                  {(createGrupo.error ?? updateGrupo.error)?.message}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t-2 border-grid flex items-center gap-2 flex-shrink-0">
          {showForm ? (
            <>
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
            </>
          ) : (
            <button
              onClick={startCreate}
              className="text-xs font-black uppercase tracking-widest bg-dark text-white px-4 py-2 hover:bg-brand hover:text-dark transition-colors"
            >
              + Novo Grupo
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Card de grupo ─────────────────────────────────────────────────────────────

interface GrupoCardProps {
  grupo: GrupoObras
  totais: { custoPrev: number; recPrev: number; saldo: number } | null
  totaisReais: GrupoTotaisReais | null
  onAbrir: () => void
  onEditar: () => void
  onExcluir: () => void
  deletePending: boolean
  canEdit: boolean
}

function GrupoCard({ grupo, totais, totaisReais, onAbrir, onEditar, onExcluir, deletePending, canEdit }: GrupoCardProps) {
  const saldoReal = totaisReais ? totaisReais.receita_realizada - totaisReais.custo_real : null

  return (
    <div className="data-panel flex flex-col">
      {/* Header do card */}
      <div className="bg-sidebar px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <p className="truncate flex-1 text-sm font-semibold">{grupo.nome}</p>
          {!grupo.is_owner && (
            <Share2 className="h-3 w-3 text-white/50 flex-shrink-0" />
          )}
          {grupo.is_owner && (grupo.shared_with?.length ?? 0) > 0 && (
            <Lock className="h-3 w-3 text-white/50 flex-shrink-0" />
          )}
        </div>
        {grupo.descricao && (
          <p className="text-xs text-white/60 mt-0.5 truncate">{grupo.descricao}</p>
        )}
      </div>

      {/* Métricas */}
      <div className="px-4 py-3 flex-1">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{grupo.obras.length} obra(s)</p>
          {grupo.periodo_padrao && (
            <p className="text-[10px] font-semibold text-muted-foreground">
              {MESES[grupo.periodo_padrao.mes_inicio - 1]}/{grupo.periodo_padrao.ano_inicio}
              {' – '}
              {MESES[grupo.periodo_padrao.mes_fim - 1]}/{grupo.periodo_padrao.ano_fim}
            </p>
          )}
        </div>
        {totais !== null ? (
          <div className="space-y-1.5">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1.5 text-xs items-baseline">
              <span></span>
              <span className="section-label text-right">Prev.</span>
              <span className="section-label text-right">Real</span>
              <span className="text-muted-foreground">Custo</span>
              <span className="font-bold tabular-nums text-right">{formatCurrency(totais.custoPrev)}</span>
              <span className="font-bold tabular-nums text-right text-dark/70">
                {totaisReais ? formatCurrency(totaisReais.custo_real) : '—'}
              </span>
              <span className="text-muted-foreground">Receita</span>
              <span className="font-bold tabular-nums text-right">{formatCurrency(totais.recPrev)}</span>
              <span className="font-bold tabular-nums text-right text-dark/70">
                {totaisReais ? formatCurrency(totaisReais.receita_realizada) : '—'}
              </span>
            </div>
            <div className="mt-2 space-y-1 border-t border-grid pt-2">
              <div className="flex justify-between text-xs">
                <span className="font-black text-dark">Saldo Prev.</span>
                <span className={cn('font-black tabular-nums', totais.saldo >= 0 ? 'text-teal-600' : 'text-red-500')}>
                  {formatCurrency(totais.saldo)}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="font-black text-dark">Saldo Real</span>
                {saldoReal !== null ? (
                  <span className={cn('font-black tabular-nums', saldoReal >= 0 ? 'text-teal-600' : 'text-red-500')}>
                    {formatCurrency(saldoReal)}
                  </span>
                ) : (
                  <span className="font-black tabular-nums text-muted-foreground">—</span>
                )}
              </div>
            </div>
            {totaisReais && (
              <p className="text-[10px] text-muted-foreground italic pt-1">
                Real: {formatDateTime(totaisReais.updated_at)}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        )}
      </div>

      {/* Ações */}
      <div className="flex items-center gap-3 border-t border-grid px-4 py-3">
        <button
          onClick={onAbrir}
          className="flex-1 rounded-md bg-dark py-2 text-xs font-semibold text-white transition-colors hover:bg-brand hover:text-dark"
        >
          Abrir
        </button>
        {canEdit && (
          <button
            onClick={onEditar}
            className="text-xs font-bold text-muted-foreground hover:text-brand transition-colors"
          >
            Editar
          </button>
        )}
        {canEdit && (
          <button
            onClick={onExcluir}
            disabled={deletePending}
            className="text-xs font-bold text-red-500 hover:underline disabled:opacity-50"
          >
            Excluir
          </button>
        )}
      </div>
    </div>
  )
}

// ── Seção de uma obra ─────────────────────────────────────────────────────────

// Distribui um total em n parcelas iguais; a última absorve o arredondamento.
function distribuirIgual(total: number, n: number): number[] {
  if (n <= 0) return []
  const base = Math.round((total / n) * 100) / 100
  const arr = Array<number>(n).fill(base)
  arr[n - 1] = Math.round((total - base * (n - 1)) * 100) / 100
  return arr
}

const r2 = (v: number) => Math.round(v * 100) / 100

// ── Campo de valor global por obra ───────────────────────────────────────────
interface GlobalFieldProps {
  label: string
  value: number
  soma: number
  onChange: (v: number) => void
  onDistribuir: () => void
  disabled?: boolean
  readOnly?: boolean
}

function GlobalField({ label, value, soma, onChange, onDistribuir, disabled, readOnly }: GlobalFieldProps) {
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const diff = r2(soma - value)
  const ok = Math.abs(diff) <= 0.01

  function startEdit() {
    if (disabled || readOnly) return
    setRaw(value ? String(value) : '')
    setEditing(true)
  }

  function commit() {
    onChange(parseBRLInput(raw))
    setEditing(false)
  }

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  return (
    <div className="flex flex-col gap-1 min-w-[200px]">
      <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        {editing ? (
          <MoneyInput
            raw={raw}
            onRawChange={setRaw}
            onCommit={commit}
            onCancel={() => setEditing(false)}
            inputRef={inputRef}
            className="w-36 text-right tabular-nums text-sm font-bold border-2 border-brand px-2 py-1 outline-none bg-white"
          />
        ) : (
          <button
            type="button"
            onClick={startEdit}
            disabled={disabled || readOnly}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 min-w-[140px] text-right tabular-nums text-sm font-black',
              readOnly
                ? 'text-muted-foreground cursor-default'
                : 'text-dark hover:text-brand transition-colors cursor-pointer group',
            )}
            title={readOnly ? undefined : 'Clique para editar'}
          >
            <span className="flex-1 text-right">{value === 0 ? '—' : formatCurrency(value)}</span>
            {!readOnly && (
              <Pencil className="h-3 w-3 text-muted-foreground/40 group-hover:text-brand flex-shrink-0 transition-colors" />
            )}
          </button>
        )}
        {!readOnly && (
          <button
            type="button"
            onClick={onDistribuir}
            disabled={disabled}
            className="text-[10px] font-black uppercase tracking-widest border-2 border-dark px-2 py-1 bg-white hover:bg-brand hover:border-brand transition-colors disabled:opacity-40"
            title="Distribuir igualmente entre os meses do período"
          >
            Distribuir
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 text-[11px] tabular-nums">
        <span className="text-muted-foreground">Soma: <strong className="text-dark">{formatCurrency(soma)}</strong></span>
        {readOnly ? null : ok ? (
          <span className="font-black text-teal-600">✓ confere</span>
        ) : (
          <span className="font-black text-red-600">
            {diff > 0 ? '▲' : '▼'} {diff > 0 ? '+' : ''}{formatCurrency(diff)} {diff > 0 ? 'a maior' : 'a menor'}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Modal: histórico completo de alterações de previsto de uma obra ──────────
function ObraHistoricoModal({
  obraCodigo, logs, onClose,
}: {
  obraCodigo: string
  logs: PlanejamentoLogEntry[]
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-3xl max-h-[85vh] flex flex-col block-border shadow-hard"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-dark text-white flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <History className="h-4 w-4 flex-shrink-0 text-brand" />
            <p className="text-xs font-black uppercase tracking-widest truncate">
              Histórico de Alterações — {obraCodigo}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-white/70 hover:text-white transition-colors flex-shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Conteúdo */}
        <div className="overflow-auto flex-1">
          {logs.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground font-bold">
              Nenhuma alteração registrada para esta obra.
            </p>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-bgBase border-b-2 border-dark">
                  <th className="text-left font-black uppercase tracking-widest px-4 py-2">Data/Hora</th>
                  <th className="text-left font-black uppercase tracking-widest px-4 py-2">Competência</th>
                  <th className="text-left font-black uppercase tracking-widest px-4 py-2">Campo</th>
                  <th className="text-right font-black uppercase tracking-widest px-4 py-2">Anterior</th>
                  <th className="text-right font-black uppercase tracking-widest px-4 py-2">Novo</th>
                  <th className="text-left font-black uppercase tracking-widest px-4 py-2">Usuário</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l, i) => (
                  <tr key={i} className="border-b border-grid hover:bg-brand/5 transition-colors">
                    <td className="px-4 py-1.5 whitespace-nowrap tabular-nums">{formatDateTime(l.changed_at)}</td>
                    <td className="px-4 py-1.5 whitespace-nowrap font-bold">{MESES[l.mes - 1]}/{l.ano}</td>
                    <td className="px-4 py-1.5 whitespace-nowrap">
                      {l.campo === 'custo_previsto' ? 'Custo Previsto' : 'Receita Prevista'}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-muted-foreground">{formatCurrency(l.valor_anterior)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums font-black text-dark">{formatCurrency(l.valor_novo)}</td>
                    <td className="px-4 py-1.5 whitespace-nowrap">{l.changed_by_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t-2 border-grid flex items-center justify-between flex-shrink-0">
          <span className="text-[11px] text-muted-foreground">{logs.length} alteração(ões)</span>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-black uppercase tracking-widest border-2 border-dark px-4 py-2 bg-white hover:bg-brand hover:border-brand transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Célula de previsto editável com histórico no hover ───────────────────────
function PrevistoCell({
  value, onChange, disabled, history, colorCls, locked, lockedMessage,
}: {
  value: number
  onChange: (v: number) => void
  disabled?: boolean
  history?: PlanejamentoLogEntry[]
  colorCls?: string
  locked?: boolean
  lockedMessage?: string
}) {
  // Só mostra a bolinha a partir da 2ª alteração dessa célula — a 1ª (preenchimento
  // inicial de um valor antes vazio/zero) já gera um log, mas não deve ser sinalizada.
  const hasHist = !!history && history.length > 1
  return (
    <div className="relative group">
      <EditableCell value={value} onSave={onChange} disabled={disabled} colorCls={colorCls} locked={locked} lockedMessage={lockedMessage} />
      {hasHist && (
        <>
          <span className="absolute top-0 right-0 h-1.5 w-1.5 rounded-full bg-amber-500 pointer-events-none" />
          <div className="hidden group-hover:block absolute z-40 right-0 top-full mt-1 w-60 bg-dark text-white text-[11px] shadow-hard border-2 border-dark p-2 text-left normal-case tracking-normal font-normal">
            <p className="font-black uppercase tracking-widest text-[10px] text-brand mb-1">Histórico</p>
            {history!.slice(0, 6).map((h, i) => (
              <div key={i} className="border-b border-white/15 last:border-0 py-0.5">
                <span className="tabular-nums">
                  {formatCurrency(h.valor_anterior)} → <strong>{formatCurrency(h.valor_novo)}</strong>
                </span>
                <div className="text-white/60">
                  {formatDateTime(h.changed_at)}{h.changed_by_name ? ` · ${h.changed_by_name}` : ''}
                </div>
              </div>
            ))}
            {history!.length > 6 && (
              <p className="text-white/50 mt-1">+{history!.length - 6} alteração(ões)…</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

type ObraRenderData = FluxoPlanejamentoResponse & { _isEspecial?: boolean; _recRealizadaPct?: number[] }

interface ObraSectionProps {
  grupoId: number
  data: ObraRenderData
  canEdit: boolean
  defaultCollapsed: boolean
  especial?: { recRealizadaPct: number[] }
  projetar: boolean
}

function ObraSection({ grupoId, data, canEdit, defaultCollapsed, especial, projetar }: ObraSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const meses: FluxoMesRow[] = data.meses
  const n = meses.length

  const save = useSaveObraPlanejamento()
  // Busca sempre (mesmo recolhida) para saber se a obra tem histórico de alterações.
  const { data: logs } = useObraLogs(grupoId, data.obra_codigo)
  const hasHist = (logs?.length ?? 0) > 0
  const [showHist, setShowHist] = useState(false)

  // Rascunho local do previsto + valores globais
  const [custoPrevState, setCustoPrev] = useState<number[]>(() => meses.map((m) => m.custo_previsto))
  const [receitaPrevState, setReceitaPrev] = useState<number[]>(() => meses.map((m) => m.receita_prevista))
  const [custoGlobalState, setCustoGlobal] = useState<number>(data.custo_global)
  const [receitaGlobalState, setReceitaGlobal] = useState<number>(data.receita_global)

  // Reinicializa quando os dados do servidor mudam (período, novo snapshot salvo, etc.).
  // O ajuste é disparado durante o render (não em useEffect, que só roda após o commit),
  // mas chamar os setters aqui não muda o valor das variáveis de estado nesta MESMA
  // execução — só a partir do próximo render. Por isso os valores efetivamente usados
  // abaixo (custoPrev/receitaPrev/custoGlobal/receitaGlobal) são recalculados na hora
  // sempre que a sincronização é necessária, em vez de ler o estado (potencialmente
  // ainda desatualizado, com tamanho diferente de `meses`) diretamente. Sem isso, a
  // troca de ano do período podia deixar custoPrev/receitaPrev com o tamanho do
  // período anterior e a tabela lançava "Cannot read properties of undefined
  // (reading 'ano')" ao indexar o novo array `meses` (mais curto) com esse tamanho antigo.
  const serverSig = useMemo(
    () => JSON.stringify({
      c: meses.map((m) => m.custo_previsto),
      r: meses.map((m) => m.receita_prevista),
      cg: data.custo_global, rg: data.receita_global,
    }),
    [meses, data.custo_global, data.receita_global],
  )
  const [syncedSig, setSyncedSig] = useState(serverSig)
  const needsSync = serverSig !== syncedSig
  if (needsSync) {
    setSyncedSig(serverSig)
    setCustoPrev(meses.map((m) => m.custo_previsto))
    setReceitaPrev(meses.map((m) => m.receita_prevista))
    setCustoGlobal(data.custo_global)
    setReceitaGlobal(especial
      ? r2(meses.reduce((s, m) => s + m.receita_prevista, 0))
      : data.receita_global)
  }
  const custoPrev = needsSync ? meses.map((m) => m.custo_previsto) : custoPrevState
  const receitaPrev = needsSync ? meses.map((m) => m.receita_prevista) : receitaPrevState
  const custoGlobal = needsSync ? data.custo_global : custoGlobalState
  const receitaGlobal = needsSync
    ? (especial ? r2(meses.reduce((s, m) => s + m.receita_prevista, 0)) : data.receita_global)
    : receitaGlobalState

  // Mapa de histórico por célula
  const histMap = useMemo(() => {
    const m: Record<string, PlanejamentoLogEntry[]> = {}
    for (const e of logs ?? []) {
      (m[`${e.ano}-${e.mes}-${e.campo}`] ??= []).push(e)
    }
    return m
  }, [logs])

  const somaCusto = r2(custoPrev.reduce((s, v) => s + v, 0))
  const somaReceita = r2(receitaPrev.reduce((s, v) => s + v, 0))
  const custoOk = Math.abs(r2(somaCusto - custoGlobal)) <= 0.01
  const receitaOk = especial ? true : Math.abs(r2(somaReceita - receitaGlobal)) <= 0.01
  const balanced = custoOk && receitaOk

  // Bloqueia o lançamento mensal enquanto o valor global correspondente não for informado.
  const custoGlobalUnset = custoGlobal === 0
  const receitaGlobalUnset = !especial && receitaGlobal === 0

  const dirty = useMemo(() => {
    if (r2(custoGlobal) !== r2(data.custo_global)) return true
    if (!especial && r2(receitaGlobal) !== r2(data.receita_global)) return true
    return meses.some((m, i) =>
      r2(custoPrev[i]) !== r2(m.custo_previsto) ||
      (!especial && r2(receitaPrev[i]) !== r2(m.receita_prevista)),
    )
  }, [custoPrev, receitaPrev, custoGlobal, receitaGlobal, meses, data, especial])

  const totalCustoReal = meses.reduce((s, m) => s + m.custo_real, 0)
  const totalRecReal = especial
    ? especial.recRealizadaPct.reduce((s, v) => s + v, 0) + meses.reduce((s, m) => s + m.receita_realizada, 0)
    : meses.reduce((s, m) => s + m.receita_realizada, 0)
  const saldoReal = totalRecReal - totalCustoReal

  let accPlan = 0
  let accReal = 0
  const acumuladoPlanejado = meses.map((_, i) => {
    accPlan += (especial ? meses[i].receita_prevista : receitaPrev[i]) - custoPrev[i]
    return accPlan
  })
  const recRealParaAcc = especial
    ? meses.map((m, i) => especial.recRealizadaPct[i] + m.receita_realizada)
    : meses.map((m) => m.receita_realizada)
  // Índices cujo acumulado é projetado (toggle ligado + mês atual em diante)
  const mesProjetado = meses.map((m) => projetar && isMesProjetado(m.ano, m.mes))
  const acumuladoReal = meses.map((m, i) => {
    if (mesProjetado[i]) {
      const custoMes = Math.max(m.custo_real, custoPrev[i])
      const recPrevMes = especial ? meses[i].receita_prevista : receitaPrev[i]
      // Havendo receita realizada no mês projetado, usa a realizada no lugar da prevista
      const receitaMes = recRealParaAcc[i] > 0 ? recRealParaAcc[i] : recPrevMes
      accReal += receitaMes - custoMes
    } else {
      accReal += recRealParaAcc[i] - m.custo_real
    }
    return accReal
  })

  function handleSalvar() {
    // Obra especial: a receita é uma realocação ponderada das demais obras (não
    // entra como receita própria), então é persistida como 0 para não duplicar nos totais.
    const body: SaveObraPlanejamentoIn = {
      custo_global: r2(custoGlobal),
      receita_global: especial ? 0 : r2(receitaGlobal),
      meses: meses.map((m, i) => ({
        mes: m.mes,
        ano: m.ano,
        custo_previsto: r2(custoPrev[i]),
        receita_prevista: especial ? 0 : r2(receitaPrev[i]),
        custo_real: 0,
        receita_realizada: 0,
      })),
    }
    save.mutate({ grupoId, obraCodigo: data.obra_codigo, body })
  }

  function handleCancelar() {
    setCustoPrev(meses.map((m) => m.custo_previsto))
    setReceitaPrev(meses.map((m) => m.receita_prevista))
    setCustoGlobal(data.custo_global)
    setReceitaGlobal(data.receita_global)
  }

  function handleDistribuirCusto() {
    if (custoPrev.some((v) => v !== 0) && !window.confirm(
      'Isso vai substituir os valores mensais de Custo Previsto pelos valores distribuídos igualmente. Continuar?'
    )) return
    setCustoPrev(distribuirIgual(custoGlobal, n))
  }

  function handleDistribuirReceita() {
    if (receitaPrev.some((v) => v !== 0) && !window.confirm(
      'Isso vai substituir os valores mensais de Receita Prevista pelos valores distribuídos igualmente. Continuar?'
    )) return
    setReceitaPrev(distribuirIgual(receitaGlobal, n))
  }

  type RowDef =
    | { label: string; kind: 'custo'; colorCls?: string }
    | { label: string; kind: 'receita'; colorCls?: string }
    | { label: string; kind: 'readonly' | 'accumulated'; values: number[]; colorCls?: string }

  const rowDefs: RowDef[] = especial
    ? [
        { label: 'Custo Previsto', kind: 'custo', colorCls: 'text-red-400' },
        { label: 'Custo Real', kind: 'readonly', values: meses.map((m) => m.custo_real), colorCls: 'text-red-600' },
        { label: 'Receita Prevista (%)', kind: 'readonly', values: meses.map((m) => m.receita_prevista), colorCls: 'text-teal-500' },
        { label: 'Receita Realizada (%)', kind: 'readonly', values: especial.recRealizadaPct, colorCls: 'text-teal-700' },
        { label: 'Receita Financeira', kind: 'readonly', values: meses.map((m) => m.receita_realizada), colorCls: 'text-teal-700' },
        { label: 'Fluxo Acumulado Planejado', kind: 'accumulated', values: acumuladoPlanejado },
        { label: 'Fluxo Acumulado Real', kind: 'accumulated', values: acumuladoReal },
      ]
    : [
        { label: 'Custo Previsto', kind: 'custo', colorCls: 'text-red-400' },
        { label: 'Custo Real', kind: 'readonly', values: meses.map((m) => m.custo_real), colorCls: 'text-red-600' },
        { label: 'Receita Prevista', kind: 'receita', colorCls: 'text-teal-500' },
        { label: 'Receita Realizada', kind: 'readonly', values: meses.map((m) => m.receita_realizada), colorCls: 'text-teal-700' },
        { label: 'Fluxo Acumulado Planejado', kind: 'accumulated', values: acumuladoPlanejado },
        { label: 'Fluxo Acumulado Real', kind: 'accumulated', values: acumuladoReal },
      ]

  const headerCls = especial
    ? 'w-full flex items-center justify-between px-4 py-3 bg-brand text-dark hover:bg-brand/90 transition-colors'
    : 'w-full flex items-center justify-between px-4 py-3 bg-dark text-white hover:bg-dark/90 transition-colors'
  const headerTextCls = especial ? 'text-dark/60' : 'text-white/60'
  const headerValCls = especial ? 'text-dark font-bold' : 'text-white font-bold'
  const saldoCls = especial
    ? cn('font-black', saldoReal >= 0 ? 'text-dark' : 'text-red-700')
    : cn('font-black', saldoReal >= 0 ? 'text-teal-300' : 'text-red-400')

  const histBtnCls = especial
    ? 'border-dark/40 text-dark hover:bg-dark hover:text-brand'
    : 'border-amber-400/60 text-amber-300 hover:bg-amber-400 hover:text-dark'

  return (
    <div className="data-panel">
      <div className={headerCls}>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center justify-between gap-6 flex-1 min-w-0 text-left"
        >
          <div className="flex items-center gap-3">
            {collapsed ? <ChevronRight className="h-4 w-4 flex-shrink-0" /> : <ChevronDown className="h-4 w-4 flex-shrink-0" />}
            <span className="text-xs font-black uppercase tracking-widest text-left">{data.obra_codigo}</span>
            {especial && (
              <span className="text-[10px] font-black uppercase tracking-widest bg-dark/20 px-2 py-0.5">Obra Especial</span>
            )}
            {!collapsed && dirty && (
              <span className="text-[10px] font-black uppercase tracking-widest bg-amber-400 text-dark px-2 py-0.5">Não salvo</span>
            )}
          </div>
          <div className="flex items-center gap-6 text-xs tabular-nums">
            <span className={cn('hidden sm:inline', headerTextCls)}>
              Custo Real: <span className={headerValCls}>{formatCurrency(totalCustoReal)}</span>
            </span>
            <span className={cn('hidden sm:inline', headerTextCls)}>
              Rec. Realizada: <span className={headerValCls}>{formatCurrency(totalRecReal)}</span>
            </span>
            <span className={saldoCls}>Saldo: {formatCurrency(saldoReal)}</span>
          </div>
        </button>
        {hasHist && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowHist(true) }}
            className={cn(
              'flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest border-2 px-2 py-1 ml-4 flex-shrink-0 transition-colors',
              histBtnCls,
            )}
            title="Ver histórico de alterações do previsto"
          >
            <History className="h-3 w-3" />
            <span className="hidden sm:inline">Histórico</span>
          </button>
        )}
      </div>

      {!collapsed && (
        <>
          {/* Painel de valores globais + validação + salvar */}
          <div className="border-b-2 border-grid bg-bgBase px-4 py-3 flex flex-wrap items-end gap-6">
            <GlobalField
              label="Custo Previsto (Global)"
              value={custoGlobal}
              soma={somaCusto}
              onChange={setCustoGlobal}
              onDistribuir={handleDistribuirCusto}
              disabled={!canEdit || save.isPending}
            />
            <GlobalField
              label={especial ? 'Receita Prevista (calculada)' : 'Receita Prevista (Global)'}
              value={receitaGlobal}
              soma={somaReceita}
              onChange={setReceitaGlobal}
              onDistribuir={handleDistribuirReceita}
              disabled={!canEdit || save.isPending}
              readOnly={!!especial}
            />
            <div className="flex flex-col gap-1 ml-auto">
              <div className="flex items-center gap-2">
                {dirty && (
                  <button
                    type="button"
                    onClick={handleCancelar}
                    disabled={save.isPending}
                    className="text-xs font-black uppercase tracking-widest border-2 border-dark px-5 py-2 bg-white hover:bg-red-50 hover:border-red-500 hover:text-red-600 transition-colors disabled:opacity-40"
                  >
                    Cancelar
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSalvar}
                  disabled={!canEdit || !balanced || !dirty || save.isPending}
                  className="text-xs font-black uppercase tracking-widest bg-dark text-white px-5 py-2 hover:bg-brand hover:text-dark transition-colors disabled:opacity-40 disabled:hover:bg-dark disabled:hover:text-white"
                  title={!balanced ? 'A soma dos meses deve ser igual ao valor global' : undefined}
                >
                  {save.isPending ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
              {!canEdit ? (
                <span className="text-[11px] text-muted-foreground italic">Somente leitura</span>
              ) : !balanced ? (
                <span className="text-[11px] font-bold text-red-600">Ajuste os meses para fechar o global</span>
              ) : save.isError ? (
                <span className="text-[11px] font-bold text-red-600">{save.error?.message}</span>
              ) : dirty ? (
                <span className="text-[11px] text-muted-foreground">Alterações pendentes</span>
              ) : (
                <span className="text-[11px] text-teal-600 font-bold">✓ Tudo salvo</span>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse" style={{ minWidth: '900px' }}>
              <thead>
                <tr className="bg-bgBase border-b-2 border-dark">
                  <th className="text-left font-black uppercase tracking-widest px-4 py-2 sticky left-0 bg-bgBase z-10 w-52 border-r-2 border-grid">
                    Métrica
                  </th>
                  {meses.map((m) => (
                    <th key={`${m.ano}-${m.mes}`} className="text-right font-black uppercase tracking-widest px-2 py-2 w-20">
                      {MESES[m.mes - 1]}/{String(m.ano).slice(2)}
                    </th>
                  ))}
                  <th className="text-right font-black uppercase tracking-widest px-2 py-2 w-24 border-l-2 border-dark bg-bgBase">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {rowDefs.map((row) => {
                  const isAccumulated = row.kind === 'accumulated'
                  const isAccReal = row.label === 'Fluxo Acumulado Real'
                  const editable = row.kind === 'custo' || row.kind === 'receita'
                  const rowBg = isAccumulated ? 'bg-bgBase' : 'bg-white'
                  let values: number[]
                  if (row.kind === 'custo') values = custoPrev
                  else if (row.kind === 'receita') values = receitaPrev
                  else values = row.values
                  const campo = row.kind === 'custo' ? 'custo_previsto' : 'receita_prevista'
                  const totalVal = isAccumulated ? (values[values.length - 1] ?? 0) : values.reduce((s, v) => s + v, 0)
                  return (
                    <tr key={row.label} className={cn('border-b border-grid hover:bg-brand/5 transition-colors', rowBg)}>
                      <td className={cn(
                        'px-4 py-1.5 font-bold uppercase tracking-wide text-xs sticky left-0 z-10 border-r-2 border-grid',
                        isAccumulated ? 'bg-bgBase font-black' : rowBg,
                      )}>
                        {row.label}
                      </td>
                      {values.map((val, mesIdx) => (
                        <td key={mesIdx} className="px-1 py-1">
                          {editable ? (
                            <PrevistoCell
                              value={val}
                              disabled={!canEdit || save.isPending}
                              colorCls={row.colorCls}
                              history={histMap[`${meses[mesIdx].ano}-${meses[mesIdx].mes}-${campo}`]}
                              locked={row.kind === 'custo' ? custoGlobalUnset : receitaGlobalUnset}
                              lockedMessage={
                                row.kind === 'custo'
                                  ? 'Informe primeiro o Custo Previsto (Global) desta obra antes de lançar os valores mensais.'
                                  : 'Informe primeiro a Receita Prevista (Global) desta obra antes de lançar os valores mensais.'
                              }
                              onChange={(v) => {
                                if (row.kind === 'custo') {
                                  setCustoPrev((prev) => prev.map((x, i) => (i === mesIdx ? v : x)))
                                } else {
                                  setReceitaPrev((prev) => prev.map((x, i) => (i === mesIdx ? v : x)))
                                }
                              }}
                            />
                          ) : (
                            <ValueCell
                              value={val}
                              bold={isAccumulated}
                              colorCls={row.colorCls}
                              projected={isAccReal && mesProjetado[mesIdx]}
                            />
                          )}
                        </td>
                      ))}
                      <td className={cn('px-1 py-1 border-l-2 border-dark', rowBg)}>
                        <ValueCell
                          value={totalVal}
                          bold
                          colorCls={isAccumulated ? undefined : row.colorCls}
                          projected={isAccReal && mesProjetado[n - 1]}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showHist && (
        <ObraHistoricoModal
          obraCodigo={data.obra_codigo}
          logs={logs ?? []}
          onClose={() => setShowHist(false)}
        />
      )}
    </div>
  )
}

// ── Card de demais obras (greedy) ────────────────────────────────────────────

interface DemaisObrasSectionProps {
  data: FluxoPlanejamentoResponse & { _greedyCount: number; _greedyEmpresas: string[] }
  breakdown: FluxoPlanejamentoResponse[]
  projetar: boolean
}

function DemaisObrasSection({ data, breakdown, projetar }: DemaisObrasSectionProps) {
  const [collapsed, setCollapsed] = useState(true)
  const meses = data.meses

  const totalCustoReal = meses.reduce((s, m) => s + m.custo_real, 0)
  const totalRecReal   = meses.reduce((s, m) => s + m.receita_realizada, 0)
  const saldoReal      = totalRecReal - totalCustoReal

  const mesProjetado = meses.map((m) => projetar && isMesProjetado(m.ano, m.mes))
  const acumuladoReal = meses.reduce<number[]>((acc, m, i) => {
    const previous = acc[i - 1] ?? 0
    const delta = mesProjetado[i]
      ? (m.receita_realizada > 0 ? m.receita_realizada : m.receita_prevista) - Math.max(m.custo_real, m.custo_previsto)
      : m.receita_realizada - m.custo_real
    acc.push(previous + delta)
    return acc
  }, [])

  function buildTooltip(mesIdx: number, field: 'custo_real' | 'receita_realizada'): string | undefined {
    const contribuintes = breakdown
      .map((o) => ({ obra: o.obra_codigo, val: o.meses[mesIdx][field] }))
      .filter((x) => x.val !== 0)
    if (!contribuintes.length) return undefined
    return contribuintes.map((x) => `${x.obra}: ${formatCurrency(x.val)}`).join('\n')
  }

  const rows: Array<{ label: string; values: number[]; tooltipField?: 'custo_real' | 'receita_realizada'; accumulated?: boolean; colorCls?: string }> = [
    { label: 'Custo Previsto', values: meses.map((m) => m.custo_previsto), colorCls: 'text-red-400' },
    { label: 'Receita Prevista', values: meses.map((m) => m.receita_prevista), colorCls: 'text-teal-500' },
    { label: 'Custo Real', values: meses.map((m) => m.custo_real), tooltipField: 'custo_real', colorCls: 'text-red-600' },
    { label: 'Receita Realizada', values: meses.map((m) => m.receita_realizada), tooltipField: 'receita_realizada', colorCls: 'text-teal-700' },
    { label: 'Fluxo Acumulado Real', values: acumuladoReal, accumulated: true },
  ]

  return (
    <div className="data-panel">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 bg-brand text-dark hover:bg-brand/90 transition-colors"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-3">
          {collapsed
            ? <ChevronRight className="h-4 w-4 flex-shrink-0" />
            : <ChevronDown className="h-4 w-4 flex-shrink-0" />}
          <span className="text-xs font-black uppercase tracking-widest text-left">
            Demais Obras — {data._greedyEmpresas.join(', ')}
          </span>
          <span className="text-[10px] font-black uppercase tracking-widest bg-dark/20 px-2 py-0.5">
            {data._greedyCount} obras
          </span>
        </div>
        <div className="flex items-center gap-6 text-xs tabular-nums">
          <span className="hidden sm:inline text-dark/60">
            Custo Real: <span className="text-dark font-bold">{formatCurrency(totalCustoReal)}</span>
          </span>
          <span className="hidden sm:inline text-dark/60">
            Rec. Realizada: <span className="text-dark font-bold">{formatCurrency(totalRecReal)}</span>
          </span>
          <span className={cn('font-black', saldoReal >= 0 ? 'text-dark' : 'text-red-700')}>
            Saldo: {formatCurrency(saldoReal)}
          </span>
        </div>
      </button>

      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse" style={{ minWidth: '900px' }}>
            <thead>
              <tr className="bg-bgBase border-b-2 border-dark">
                <th className="text-left font-black uppercase tracking-widest px-4 py-2 sticky left-0 bg-bgBase z-10 w-52 border-r-2 border-grid">
                  Métrica
                </th>
                {meses.map((m) => (
                  <th key={`${m.ano}-${m.mes}`} className="text-right font-black uppercase tracking-widest px-2 py-2 w-20">
                    {MESES[m.mes - 1]}/{String(m.ano).slice(2)}
                  </th>
                ))}
                <th className="text-right font-black uppercase tracking-widest px-2 py-2 w-24 border-l-2 border-dark bg-bgBase">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const rowBg = row.accumulated ? 'bg-bgBase' : 'bg-white'
                const lastIdx = row.values.length - 1
                const totalVal = row.accumulated ? (row.values[lastIdx] ?? 0) : row.values.reduce((s, v) => s + v, 0)
                return (
                  <tr
                    key={row.label}
                    className={cn('border-b border-grid hover:bg-brand/5 transition-colors', rowBg)}
                  >
                    <td className={cn(
                      'px-4 py-1.5 uppercase tracking-wide text-xs sticky left-0 z-10 border-r-2 border-grid',
                      row.accumulated ? 'bg-bgBase font-black' : `${rowBg} font-bold`,
                    )}>
                      {row.label}
                    </td>
                    {row.values.map((val, mesIdx) => {
                      const tooltip = row.tooltipField ? buildTooltip(mesIdx, row.tooltipField) : undefined
                      const colorCls = val === 0 ? 'text-muted-foreground/30' : (row.colorCls ?? 'text-dark')
                      return (
                        <td key={mesIdx} className="px-1 py-1">
                          {row.accumulated ? (
                            <ValueCell value={val} bold projected={mesProjetado[mesIdx]} />
                          ) : tooltip ? (
                            <span
                              title={tooltip}
                              className={cn(
                                'block w-full text-right tabular-nums text-xs px-1 py-0.5 cursor-help underline decoration-dotted decoration-muted-foreground/40',
                                colorCls,
                              )}
                            >
                              {val === 0 ? '—' : formatCurrency(val)}
                            </span>
                          ) : (
                            <span className={cn(
                              'block w-full text-right tabular-nums text-xs px-1 py-0.5',
                              colorCls,
                            )}>
                              {val === 0 ? '—' : formatCurrency(val)}
                            </span>
                          )}
                        </td>
                      )
                    })}
                    <td className={cn('px-1 py-1 border-l-2 border-dark', rowBg)}>
                      <ValueCell
                        value={totalVal}
                        bold
                        colorCls={row.accumulated ? undefined : row.colorCls}
                        projected={row.accumulated && mesProjetado[lastIdx]}
                      />
                    </td>
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

// ── Consolidado do grupo ─────────────────────────────────────────────────────

interface ConsolidadoGrupoProps {
  obras: FluxoPlanejamentoResponse[]
  obrasGreedy?: FluxoPlanejamentoResponse | null
  projetar: boolean
}

function ConsolidadoGrupo({ obras, obrasGreedy, projetar }: ConsolidadoGrupoProps) {
  const [collapsed, setCollapsed] = useState(false)

  const mesesRef = obras[0]?.meses ?? []
  const nSlots = mesesRef.length
  const custoReal = Array.from({ length: nSlots }, (_, i) =>
    obras.reduce((s, o) => s + o.meses[i].custo_real, 0) + (obrasGreedy?.meses[i].custo_real ?? 0)
  )
  const recReal   = Array.from({ length: nSlots }, (_, i) =>
    obras.reduce((s, o) => s + o.meses[i].receita_realizada, 0) + (obrasGreedy?.meses[i].receita_realizada ?? 0)
  )
  const custoPrev = Array.from({ length: nSlots }, (_, i) =>
    obras.reduce((s, o) => s + o.meses[i].custo_previsto, 0) + (obrasGreedy?.meses[i].custo_previsto ?? 0)
  )
  const recPrev   = Array.from({ length: nSlots }, (_, i) =>
    obras.reduce((s, o) => s + o.meses[i].receita_prevista, 0) + (obrasGreedy?.meses[i].receita_prevista ?? 0)
  )
  const saldoMes  = custoReal.map((c, i) => recReal[i] - c)

  // Saldo acumulado: a partir do mês atual, projeta usando previsto (custo = maior entre real e previsto)
  const mesProjetado = mesesRef.map((m) => projetar && isMesProjetado(m.ano, m.mes))
  let acc = 0
  const saldoAcc = saldoMes.map((s, i) => {
    acc += mesProjetado[i]
      ? ((recReal[i] > 0 ? recReal[i] : recPrev[i]) - Math.max(custoReal[i], custoPrev[i]))
      : s
    return acc
  })

  const totalCustoReal = custoReal.reduce((s, v) => s + v, 0)
  const totalRecReal   = recReal.reduce((s, v) => s + v, 0)
  const saldoAnual     = totalRecReal - totalCustoReal

  type Row = { label: string; values: number[]; total: number; bold?: boolean; separator?: boolean; tooltipField?: 'custo_real' | 'receita_realizada'; colorCls?: string; projectedRow?: boolean }

  function buildTooltip(mesIdx: number, field: 'custo_real' | 'receita_realizada'): string | undefined {
    const contribuintes = obras
      .map((o) => ({ obra: o.obra_codigo, val: o.meses[mesIdx][field] }))
      .filter((x) => x.val !== 0)
    if (obrasGreedy) {
      const val = obrasGreedy.meses[mesIdx][field]
      if (val !== 0) contribuintes.push({ obra: 'Demais Obras', val })
    }
    if (!contribuintes.length) return undefined
    return contribuintes.map((x) => `${x.obra}: ${formatCurrency(x.val)}`).join('\n')
  }

  const rows: Row[] = [
    { label: 'Custo Real',        values: custoReal, total: totalCustoReal, tooltipField: 'custo_real', colorCls: 'text-red-600' },
    { label: 'Receita Realizada', values: recReal,   total: totalRecReal,   tooltipField: 'receita_realizada', colorCls: 'text-teal-700' },
    { label: 'Saldo do Mês',      values: saldoMes,  total: saldoMes.reduce((s, v) => s + v, 0), separator: true },
    { label: 'Saldo Acumulado',   values: saldoAcc,  total: saldoAcc[nSlots - 1], bold: true, projectedRow: true },
  ]

  return (
    <div className="data-panel">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 bg-dark text-white hover:bg-dark/90 transition-colors"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-3">
          {collapsed
            ? <ChevronRight className="h-4 w-4 flex-shrink-0" />
            : <ChevronDown className="h-4 w-4 flex-shrink-0" />}
          <span className="text-xs font-black uppercase tracking-widest">
            Consolidado Operacional do Grupo
          </span>
        </div>
        <div className="flex items-center gap-6 text-xs tabular-nums">
          <span className="hidden sm:inline text-white/60">
            Custo Real: <span className="text-white font-bold">{formatCurrency(totalCustoReal)}</span>
          </span>
          <span className="hidden sm:inline text-white/60">
            Rec. Realizada: <span className="text-white font-bold">{formatCurrency(totalRecReal)}</span>
          </span>
          <span className={cn('font-black', saldoAnual >= 0 ? 'text-teal-300' : 'text-red-400')}>
            Saldo: {formatCurrency(saldoAnual)}
          </span>
        </div>
      </button>

      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse" style={{ minWidth: '1000px' }}>
            <thead>
              <tr className="bg-bgBase border-b-2 border-dark">
                <th className="text-left font-black uppercase tracking-widest px-4 py-2 sticky left-0 bg-bgBase z-10 w-52 border-r-2 border-grid">
                  Métrica
                </th>
                {(obras[0]?.meses ?? []).map((m) => (
                  <th key={`${m.ano}-${m.mes}`} className="text-right font-black uppercase tracking-widest px-2 py-2 w-20">
                    {MESES[m.mes - 1]}/{String(m.ano).slice(2)}
                  </th>
                ))}
                <th className="text-right font-black uppercase tracking-widest px-2 py-2 w-24 border-l-2 border-dark bg-bgBase">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isSaldo = row.label.startsWith('Saldo')
                const rowBg = row.bold ? 'bg-bgBase' : 'bg-white'
                return (
                  <tr
                    key={row.label}
                    className={cn(
                      'border-b border-grid',
                      row.separator && 'border-t-2 border-dark',
                      rowBg,
                    )}
                  >
                    <td
                      className={cn(
                        'px-4 py-1.5 uppercase tracking-wide text-xs sticky left-0 z-10 border-r-2 border-grid',
                        row.bold ? 'bg-bgBase font-black' : `${rowBg} font-bold`,
                      )}
                    >
                      {row.label}
                    </td>
                    {row.values.map((val, i) => {
                      const tooltip = row.tooltipField ? buildTooltip(i, row.tooltipField) : undefined
                      const colorCls = val === 0 ? 'text-muted-foreground/30' : (row.colorCls ?? 'text-dark')
                      return (
                        <td key={i} className="px-1 py-1">
                          {isSaldo || row.bold ? (
                            <ValueCell value={val} bold={row.bold} projected={row.projectedRow && mesProjetado[i]} />
                          ) : tooltip ? (
                            <span
                              title={tooltip}
                              className={cn(
                                'block w-full text-right tabular-nums text-xs px-1 py-0.5 cursor-help underline decoration-dotted decoration-muted-foreground/40',
                                colorCls,
                              )}
                            >
                              {val === 0 ? '—' : formatCurrency(val)}
                            </span>
                          ) : (
                            <span className={cn(
                              'block w-full text-right tabular-nums text-xs px-1 py-0.5',
                              colorCls,
                            )}>
                              {val === 0 ? '—' : formatCurrency(val)}
                            </span>
                          )}
                        </td>
                      )
                    })}
                    <td className={cn('px-1 py-1 border-l-2 border-dark', rowBg)}>
                      {isSaldo || row.bold ? (
                        <ValueCell value={row.total} bold={row.bold} projected={row.projectedRow && mesProjetado[nSlots - 1]} />
                      ) : (
                        <span className={cn(
                          'block w-full text-right tabular-nums text-xs px-1 py-0.5 font-bold',
                          row.total === 0 ? 'text-muted-foreground/30' : (row.colorCls ?? 'text-dark'),
                        )}>
                          {row.total === 0 ? '—' : formatCurrency(row.total)}
                        </span>
                      )}
                    </td>
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

// ── Card Custo Financeiro (Tesouraria) ───────────────────────────────────────

function CustoFinanceiroGrupo({ data, grupoId, periodo, saldoOperacionalPorMes }: { data: CustoFinanceiroResponse; grupoId: number; periodo: Periodo; saldoOperacionalPorMes: Map<string, number> }) {
  const [collapsed, setCollapsed] = useState(false)
  const [detalhe, setDetalhe] = useState<{ id: number; nome: string; ano?: number; mes?: number } | null>(null)
  const [gerenciarAberto, setGerenciarAberto] = useState(false)
  const [regrasParAberto, setRegrasParAberto] = useState(false)
  const [suprimidosAberto, setSuprimidosAberto] = useState(false)
  const [ordemLocal, setOrdemLocal] = useState<number[] | null>(null)
  const [categoriaArrastadaId, setCategoriaArrastadaId] = useState<number | null>(null)
  const [categoriaSobrepostaId, setCategoriaSobrepostaId] = useState<number | null>(null)
  const currentUser = useAuthStore((s) => s.user)
  const { data: todasCategorias = [] } = useCustoFinanceiroCategorias()
  const reorderCategorias = useReorderCustoFinanceiroCategorias()
  const { meses, categorias: categoriasResposta, total_entradas, total_saidas, fluxo_liquido } = data
  const categorias = useMemo(() => {
    if (!ordemLocal) return categoriasResposta
    const posicaoPorId = new Map(ordemLocal.map((id, index) => [id, index]))
    return [...categoriasResposta].sort((a, b) => {
      if (a.categoria_id === null) return 1
      if (b.categoria_id === null) return -1
      return (posicaoPorId.get(a.categoria_id) ?? Number.MAX_SAFE_INTEGER)
        - (posicaoPorId.get(b.categoria_id) ?? Number.MAX_SAFE_INTEGER)
    })
  }, [categoriasResposta, ordemLocal])

  useEffect(() => {
    setOrdemLocal(null)
  }, [categoriasResposta, todasCategorias])

  function handleDropCategoria(destinoId: number) {
    const origemId = categoriaArrastadaId
    setCategoriaArrastadaId(null)
    setCategoriaSobrepostaId(null)
    if (origemId === null || origemId === destinoId || reorderCategorias.isPending) return

    const idsVisiveis = categorias.flatMap((categoria) => categoria.categoria_id === null ? [] : [categoria.categoria_id])
    const indiceOrigem = idsVisiveis.indexOf(origemId)
    const indiceDestino = idsVisiveis.indexOf(destinoId)
    if (indiceOrigem < 0 || indiceDestino < 0) return

    const novaOrdemVisivel = [...idsVisiveis]
    novaOrdemVisivel.splice(indiceOrigem, 1)
    novaOrdemVisivel.splice(indiceDestino, 0, origemId)

    const idsConfigurados = todasCategorias.map((categoria) => categoria.id)
    const visiveisConfigurados = new Set(idsVisiveis)
    if (idsConfigurados.length === 0 || !idsVisiveis.every((id) => idsConfigurados.includes(id))) return

    let indiceVisivel = 0
    const novaOrdemCompleta = idsConfigurados.map((id) => (
      visiveisConfigurados.has(id) ? novaOrdemVisivel[indiceVisivel++] : id
    ))
    const ordemAnterior = ordemLocal
    setOrdemLocal(novaOrdemVisivel)
    reorderCategorias.mutate(
      { categoriaIds: novaOrdemCompleta },
      {
        onError: () => {
          setOrdemLocal(ordemAnterior)
          alert('Não foi possível salvar a nova ordem das categorias. Tente novamente.')
        },
      },
    )
  }

  const podeReordenar = !!currentUser?.is_admin && !reorderCategorias.isPending
  const n = meses.length
  const saldoOperacional = meses.map((s) => saldoOperacionalPorMes.get(`${s.ano}-${s.mes}`) ?? 0)
  const totalSaldoOperacional = saldoOperacional.reduce((s, v) => s + v, 0)
  const fluxoComOperacional = fluxo_liquido + totalSaldoOperacional

  return (
    <div className="data-panel overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-brand/5 transition-colors"
        onClick={() => setCollapsed((v) => !v)}
      >
        <div className="flex items-center gap-2">
          {collapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          <span className="text-xs font-black uppercase tracking-widest text-dark">Custo Financeiro</span>
          <span className="text-[10px] text-muted-foreground font-normal">— Tesouraria consolidada</span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          {currentUser?.is_admin && (
            <span
              role="button"
              className="flex items-center gap-1 text-muted-foreground hover:text-brand"
              onClick={(e) => { e.stopPropagation(); setGerenciarAberto(true) }}
            >
              <Settings2 className="h-3.5 w-3.5" /> Categorias
            </span>
          )}
          {currentUser?.is_admin && (
            <span
              role="button"
              className="flex items-center gap-1 text-muted-foreground hover:text-brand"
              onClick={(e) => { e.stopPropagation(); setRegrasParAberto(true) }}
            >
              <Share2 className="h-3.5 w-3.5" /> Contas Especiais
            </span>
          )}
          {currentUser?.is_admin && (
            <span
              role="button"
              className="flex items-center gap-1 text-muted-foreground hover:text-brand"
              onClick={(e) => { e.stopPropagation(); setSuprimidosAberto(true) }}
            >
              <EyeOff className="h-3.5 w-3.5" /> Transferências Suprimidas
            </span>
          )}
          <span className="text-green-700 font-bold">Ent: {formatCurrency(total_entradas)}</span>
          <span className="text-red-700 font-bold">Saí: {formatCurrency(total_saidas)}</span>
          <span
            className={cn('font-black', fluxoComOperacional >= 0 ? 'text-green-700' : 'text-red-700')}
            title="Inclui o Saldo do Mês (Receita Realizada − Custo Real) do Consolidado Operacional do Grupo"
          >
            Fluxo: {formatCurrency(fluxoComOperacional)}
          </span>
        </div>
      </button>

      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-dark text-white">
                <th className="text-left px-3 py-1.5 font-black uppercase tracking-widest text-[10px] min-w-[220px] sticky left-0 bg-dark z-10">Categoria</th>
                {meses.map((s, i) => (
                  <th key={i} className="px-1 py-1.5 text-right font-bold whitespace-nowrap min-w-[80px]">
                    {MESES[s.mes - 1]}/{String(s.ano).slice(2)}
                  </th>
                ))}
                <th className="px-1 py-1.5 text-right font-bold border-l-2 border-white/30 min-w-[90px]">Total</th>
              </tr>
            </thead>
            <tbody>
              {categorias.map((cat, ci) => (
                <tr
                  key={cat.categoria_id ?? 'nc'}
                  className={cn(
                    ci % 2 === 0 ? 'bg-white' : 'bg-[color-mix(in_srgb,hsl(var(--border))_20%,hsl(var(--card)))]',
                    categoriaArrastadaId === cat.categoria_id && 'opacity-40',
                    categoriaSobrepostaId === cat.categoria_id && categoriaArrastadaId !== cat.categoria_id && 'ring-2 ring-inset ring-brand',
                  )}
                  onDragOver={(event) => {
                    if (!podeReordenar || cat.categoria_id === null || categoriaArrastadaId === null) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    setCategoriaSobrepostaId(cat.categoria_id)
                  }}
                  onDragLeave={() => {
                    if (categoriaSobrepostaId === cat.categoria_id) setCategoriaSobrepostaId(null)
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (cat.categoria_id !== null) handleDropCategoria(cat.categoria_id)
                  }}
                >
                  <td
                    className="px-3 py-1 sticky left-0 z-10 bg-inherit font-medium text-dark max-w-[220px] cursor-pointer hover:bg-brand/10"
                    onClick={() => setDetalhe({ id: cat.categoria_id ?? CATEGORIA_NAO_CLASSIFICADA, nome: cat.nome })}
                    title="Clique para ver todos os lançamentos do período"
                  >
                    <div className="flex items-center min-w-0">
                      {podeReordenar && cat.categoria_id !== null && (
                        <button
                          type="button"
                          draggable
                          className="mr-1 -ml-1 cursor-grab text-muted-foreground hover:text-brand active:cursor-grabbing"
                          title="Arraste para reorganizar a categoria"
                          aria-label={`Reorganizar ${cat.nome}`}
                          onClick={(event) => event.stopPropagation()}
                          onDragStart={(event: DragEvent<HTMLButtonElement>) => {
                            event.dataTransfer.effectAllowed = 'move'
                            event.dataTransfer.setData('text/plain', String(cat.categoria_id))
                            setCategoriaArrastadaId(cat.categoria_id)
                          }}
                          onDragEnd={() => {
                            setCategoriaArrastadaId(null)
                            setCategoriaSobrepostaId(null)
                          }}
                        >
                          <GripVertical className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {cat.sinal && (
                        <span className={cat.sinal === 'entrada' ? 'text-green-700' : 'text-red-700'}>
                          {cat.sinal === 'entrada' ? '(+) ' : '(-) '}
                        </span>
                      )}
                      <span className="truncate">{cat.nome}</span>
                    </div>
                  </td>
                  {cat.valores.map((v, vi) => (
                    <td
                      key={vi}
                      className="px-1 py-1 text-right tabular-nums cursor-pointer hover:bg-brand/10"
                      onClick={() => setDetalhe({
                        id: cat.categoria_id ?? CATEGORIA_NAO_CLASSIFICADA, nome: cat.nome,
                        ano: meses[vi].ano, mes: meses[vi].mes,
                      })}
                      title={`Clique para ver os lançamentos de ${MESES[meses[vi].mes - 1]}/${meses[vi].ano}`}
                    >
                      <span className={cn(v === 0 ? 'text-muted-foreground/30' : v > 0 ? 'text-green-700' : 'text-red-700')}>
                        {v === 0 ? '—' : formatCurrency(v)}
                      </span>
                    </td>
                  ))}
                  <td
                    className="px-1 py-1 text-right tabular-nums border-l-2 border-dark cursor-pointer hover:bg-brand/10"
                    onClick={() => setDetalhe({ id: cat.categoria_id ?? CATEGORIA_NAO_CLASSIFICADA, nome: cat.nome })}
                    title="Clique para ver todos os lançamentos do período"
                  >
                    <span className={cn('font-bold', cat.total === 0 ? 'text-muted-foreground/30' : cat.total > 0 ? 'text-green-700' : 'text-red-700')}>
                      {cat.total === 0 ? '—' : formatCurrency(cat.total)}
                    </span>
                  </td>
                </tr>
              ))}
              {categorias.length === 0 && (
                <tr>
                  <td colSpan={n + 2} className="px-3 py-4 text-center text-muted-foreground">
                    Nenhum lançamento classificado neste período.
                  </td>
                </tr>
              )}

              {/* Rodapé com totais */}
              <tr className="bg-dark text-white font-black border-t-2 border-dark">
                <td className="px-3 py-1.5 sticky left-0 z-10 bg-dark text-[10px] uppercase tracking-widest">Total Entradas</td>
                {Array.from({ length: n }).map((_, i) => {
                  const v = categorias.reduce((s, c) => s + (c.valores[i] > 0 ? c.valores[i] : 0), 0)
                  return (
                    <td key={i} className="px-1 py-1.5 text-right tabular-nums text-green-300">
                      {v === 0 ? '—' : formatCurrency(v)}
                    </td>
                  )
                })}
                <td className="px-1 py-1.5 text-right tabular-nums border-l-2 border-white/30 text-green-300">{formatCurrency(total_entradas)}</td>
              </tr>
              <tr className="bg-[color-mix(in_srgb,hsl(var(--foreground))_80%,hsl(var(--card)))] text-white font-black">
                <td className="px-3 py-1.5 sticky left-0 z-10 bg-[color-mix(in_srgb,hsl(var(--foreground))_80%,hsl(var(--card)))] text-[10px] uppercase tracking-widest">Total Saídas</td>
                {Array.from({ length: n }).map((_, i) => {
                  const v = categorias.reduce((s, c) => s + (c.valores[i] < 0 ? c.valores[i] : 0), 0)
                  return (
                    <td key={i} className="px-1 py-1.5 text-right tabular-nums text-red-300">
                      {v === 0 ? '—' : formatCurrency(v)}
                    </td>
                  )
                })}
                <td className="px-1 py-1.5 text-right tabular-nums border-l-2 border-white/30 text-red-300">{formatCurrency(-total_saidas)}</td>
              </tr>
              <tr className="bg-[color-mix(in_srgb,hsl(var(--foreground))_60%,hsl(var(--card)))] text-white font-bold">
                <td
                  className="px-3 py-1.5 sticky left-0 z-10 bg-[color-mix(in_srgb,hsl(var(--foreground))_60%,hsl(var(--card)))] text-[10px] uppercase tracking-widest"
                  title="Receita Realizada − Custo Real do Consolidado Operacional do Grupo"
                >
                  Saldo Operacional (Consolidado)
                </td>
                {saldoOperacional.map((v, i) => (
                  <td key={i} className="px-1 py-1.5 text-right tabular-nums">
                    {v === 0 ? '—' : formatCurrency(v)}
                  </td>
                ))}
                <td className="px-1 py-1.5 text-right tabular-nums border-l-2 border-white/30">
                  {formatCurrency(totalSaldoOperacional)}
                </td>
              </tr>
              <tr className="bg-brand text-white font-black text-sm">
                <td
                  className="px-3 py-2 sticky left-0 z-10 bg-brand text-[10px] uppercase tracking-widest"
                  title="Fluxo financeiro do período + Saldo do Mês do Consolidado Operacional do Grupo"
                >
                  Fluxo do Período
                </td>
                {Array.from({ length: n }).map((_, i) => {
                  const v = categorias.reduce((s, c) => s + c.valores[i], 0) + saldoOperacional[i]
                  return (
                    <td key={i} className={cn('px-1 py-2 text-right tabular-nums font-black', v < 0 ? 'text-red-200' : '')}>
                      {v === 0 ? '—' : formatCurrency(v)}
                    </td>
                  )
                })}
                <td className={cn('px-1 py-2 text-right tabular-nums border-l-2 border-white/30 font-black', fluxoComOperacional < 0 ? 'text-red-200' : '')}>
                  {formatCurrency(fluxoComOperacional)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {detalhe && (
        <LancamentosModal
          grupoId={grupoId}
          periodo={
            detalhe.ano && detalhe.mes
              ? { anoInicio: detalhe.ano, mesInicio: detalhe.mes, anoFim: detalhe.ano, mesFim: detalhe.mes }
              : periodo
          }
          categoriaId={detalhe.id}
          categoriaNome={detalhe.nome}
          mesLabel={detalhe.ano && detalhe.mes ? `${MESES[detalhe.mes - 1]}/${detalhe.ano}` : null}
          isAdmin={!!currentUser?.is_admin}
          onClose={() => setDetalhe(null)}
        />
      )}

      {gerenciarAberto && (
        <CategoriasCustoFinanceiroModal onClose={() => setGerenciarAberto(false)} />
      )}
      {regrasParAberto && (
        <RegrasParTransferenciaModal onClose={() => setRegrasParAberto(false)} />
      )}
      {suprimidosAberto && (
        <LancamentosSuprimidosModal grupoId={grupoId} periodo={periodo} onClose={() => setSuprimidosAberto(false)} />
      )}
    </div>
  )
}

// ── Tabela reutilizável de lançamentos (categoria e descrição) ──────────────

function fmtContaLabel(c: LancamentoConta | null): string {
  if (!c) return '—'
  return [c.empresa, [c.banco, c.conta].filter(Boolean).join('/')].filter(Boolean).join(' — ')
}

function LancamentosTable({
  lancamentos, isLoading, emptyMessage, categorias, isAdmin, onReclassify, showMotivo,
}: {
  lancamentos: LancamentoDetalhe[]
  isLoading: boolean
  emptyMessage: string
  categorias: CustoFinanceiroCategoria[]
  isAdmin: boolean
  onReclassify: (lancamentoId: string, categoriaId: number | null) => void
  showMotivo?: boolean
}) {
  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    )
  }
  if (lancamentos.length === 0) {
    return <p className="p-4 text-xs text-muted-foreground">{emptyMessage}</p>
  }
  return (
    <table className="w-full text-xs border-collapse">
      <thead>
        <tr className="bg-dark text-white sticky top-0 z-10">
          <th className="text-left px-3 py-1.5 font-black uppercase tracking-widest text-[10px] whitespace-nowrap">Data</th>
          <th className="text-left px-3 py-1.5 font-black uppercase tracking-widest text-[10px]">Descrição</th>
          <th className="text-right px-3 py-1.5 font-black uppercase tracking-widest text-[10px]">Valor</th>
          <th className="text-left px-3 py-1.5 font-black uppercase tracking-widest text-[10px]">Origem</th>
          <th className="text-left px-3 py-1.5 font-black uppercase tracking-widest text-[10px]">Destino</th>
          <th className="text-left px-3 py-1.5 font-black uppercase tracking-widest text-[10px]">Banco</th>
          <th className="text-left px-3 py-1.5 font-black uppercase tracking-widest text-[10px]">Conta</th>
          {showMotivo && <th className="text-left px-3 py-1.5 font-black uppercase tracking-widest text-[10px]">Motivo</th>}
          {isAdmin && <th className="text-left px-3 py-1.5 font-black uppercase tracking-widest text-[10px]">Categoria</th>}
        </tr>
      </thead>
      <tbody>
        {lancamentos.map((lc, i) => (
          <tr key={lc.id} className={i % 2 === 0 ? 'bg-white' : 'bg-grid/20'}>
            <td className="px-3 py-1 whitespace-nowrap">{lc.data}</td>
            <td className="px-3 py-1 max-w-[240px] truncate" title={lc.descricao}>{lc.descricao}</td>
            <td className={cn('px-3 py-1 text-right tabular-nums font-medium whitespace-nowrap', lc.sentido === 'entrada' ? 'text-green-700' : 'text-red-700')}>
              {lc.sentido === 'entrada' ? '+' : '-'}{formatCurrency(lc.valor)}
            </td>
            <td className="px-3 py-1 whitespace-nowrap">{fmtContaLabel(lc.origem)}</td>
            <td className="px-3 py-1 whitespace-nowrap">{fmtContaLabel(lc.destino)}</td>
            <td className="px-3 py-1 whitespace-nowrap">{lc.banco || '—'}</td>
            <td className="px-3 py-1 whitespace-nowrap">{lc.conta || '—'}</td>
            {showMotivo && (
              <td className="px-3 py-1 whitespace-nowrap text-muted-foreground">
                {(lc as LancamentoSuprimido).rotulo ?? '—'}
              </td>
            )}
            {isAdmin && (
              <td className="px-3 py-1">
                {lc.tipo === 'controle' ? (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
                    title="Classificado automaticamente pelo sentido do Controle Financeiro"
                  >
                    <Lock className="h-3 w-3 flex-shrink-0" />
                    {categorias.find((c) => c.id === lc.categoria_id)?.nome ?? 'Não Classificado'}
                  </span>
                ) : (
                  <select
                    className="text-[10px] border-2 border-grid px-1 py-0.5 bg-white focus:outline-none focus:border-brand"
                    value={lc.categoria_id ?? CATEGORIA_NAO_CLASSIFICADA}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      onReclassify(lc.id, v === CATEGORIA_NAO_CLASSIFICADA ? null : v)
                    }}
                  >
                    <option value={CATEGORIA_NAO_CLASSIFICADA}>Não Classificado</option>
                    {categorias.map((c) => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </select>
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Modal: detalhamento de lançamentos de uma categoria ─────────────────────

function LancamentosModal({
  grupoId, periodo, categoriaId, categoriaNome, mesLabel, isAdmin, onClose,
}: {
  grupoId: number
  periodo: Periodo
  categoriaId: number
  categoriaNome: string
  mesLabel: string | null
  isAdmin: boolean
  onClose: () => void
}) {
  const { data: lancamentos = [], isLoading } = useCustoFinanceiroLancamentos(grupoId, categoriaId, periodo, true)
  const { data: categorias = [] } = useCustoFinanceiroCategorias()
  const setCategoria = useSetLancamentoCategoria()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white block-border max-w-6xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b-2 border-grid flex-shrink-0">
          <span className="text-xs font-black uppercase tracking-widest text-dark">
            {categoriaNome} — Lançamentos{mesLabel ? ` (${mesLabel})` : ' (período completo)'}
          </span>
          <button onClick={onClose}><X className="h-4 w-4 text-muted-foreground hover:text-dark" /></button>
        </div>
        <div className="overflow-auto flex-1">
          <LancamentosTable
            lancamentos={lancamentos}
            isLoading={isLoading}
            emptyMessage={mesLabel ? `Nenhum lançamento nesta categoria em ${mesLabel}.` : 'Nenhum lançamento nesta categoria no período selecionado.'}
            categorias={categorias}
            isAdmin={isAdmin}
            onReclassify={(lancamentoId, categoriaId) => setCategoria.mutate({ lancamentoId, categoriaId })}
          />
        </div>
      </div>
    </div>
  )
}

// ── Modal: transferências suprimidas por Conta Especial (admin) ─────────────

function LancamentosSuprimidosModal({
  grupoId, periodo, onClose,
}: {
  grupoId: number
  periodo: Periodo
  onClose: () => void
}) {
  const { data: lancamentos = [], isLoading } = useCustoFinanceiroLancamentosSuprimidos(grupoId, periodo, true)
  const { data: categorias = [] } = useCustoFinanceiroCategorias()
  const setCategoria = useSetLancamentoCategoria()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white block-border max-w-6xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b-2 border-grid flex-shrink-0">
          <span className="text-xs font-black uppercase tracking-widest text-dark">
            Transferências Suprimidas por Conta Especial — {MESES[periodo.mesInicio - 1]}/{periodo.anoInicio} a {MESES[periodo.mesFim - 1]}/{periodo.anoFim}
          </span>
          <button onClick={onClose}><X className="h-4 w-4 text-muted-foreground hover:text-dark" /></button>
        </div>
        <p className="px-4 pt-3 text-[11px] text-muted-foreground">
          Escolha uma categoria para incluir uma transferência no card. Isso cria uma reclassificação manual (override) que passa a valer para esse lançamento específico.
        </p>
        <div className="overflow-auto flex-1">
          <LancamentosTable
            lancamentos={lancamentos}
            isLoading={isLoading}
            emptyMessage="Nenhuma transferência suprimida por Conta Especial neste período."
            categorias={categorias}
            isAdmin
            showMotivo
            onReclassify={(lancamentoId, categoriaId) => setCategoria.mutate({ lancamentoId, categoriaId })}
          />
        </div>
      </div>
    </div>
  )
}

// ── Modal: gerenciar categorias de Custo Financeiro (admin) ─────────────────

function CategoriasCustoFinanceiroModal({ onClose }: { onClose: () => void }) {
  const { data: categorias = [] } = useCustoFinanceiroCategorias()
  const createCategoria = useCreateCustoFinanceiroCategoria()
  const updateCategoria = useUpdateCustoFinanceiroCategoria()
  const deleteCategoria = useDeleteCustoFinanceiroCategoria()

  const [editando, setEditando] = useState<CustoFinanceiroCategoria | null>(null)
  const [criando, setCriando] = useState(false)
  const [nome, setNome] = useState('')
  const [sinal, setSinal] = useState<'entrada' | 'saida'>('saida')
  const [ordem, setOrdem] = useState(0)

  const isPending = createCategoria.isPending || updateCategoria.isPending

  function startCreate() {
    setEditando(null)
    setCriando(true)
    setNome('')
    setSinal('saida')
    setOrdem((categorias.length + 1) * 10)
  }

  function startEdit(c: CustoFinanceiroCategoria) {
    setCriando(false)
    setEditando(c)
    setNome(c.nome)
    setSinal(c.sinal)
    setOrdem(c.ordem)
  }

  function cancelForm() {
    setCriando(false)
    setEditando(null)
  }

  function save() {
    if (!nome.trim()) return
    const payload = { nome: nome.trim(), sinal, ordem, descricoes: [], contas: [] }
    if (editando) {
      updateCategoria.mutate({ id: editando.id, ...payload }, { onSuccess: cancelForm })
    } else {
      createCategoria.mutate(payload, { onSuccess: cancelForm })
    }
  }

  function handleDelete(c: CustoFinanceiroCategoria) {
    if (!confirm(`Excluir a categoria "${c.nome}"? Os lançamentos dela voltam para "Não Classificado".`)) return
    deleteCategoria.mutate(c.id)
  }

  const showForm = criando || !!editando

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white block-border max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b-2 border-grid flex-shrink-0">
          <span className="text-xs font-black uppercase tracking-widest text-dark">Categorias de Custo Financeiro</span>
          <button onClick={onClose}><X className="h-4 w-4 text-muted-foreground hover:text-dark" /></button>
        </div>

        <div className="overflow-auto flex-1 p-4 space-y-4">
          {!showForm && (
            <>
              <button
                className="flex items-center gap-1.5 text-xs font-bold text-brand hover:underline"
                onClick={startCreate}
              >
                <Plus className="h-3.5 w-3.5" /> Nova categoria
              </button>
              <div className="border-2 border-grid divide-y-2 divide-grid">
                {categorias.map((c) => (
                  <div key={c.id} className="flex items-center justify-between px-3 py-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={c.sinal === 'entrada' ? 'text-green-700' : 'text-red-700'}>
                        {c.sinal === 'entrada' ? '(+)' : '(-)'}
                      </span>
                      <span className="font-medium text-dark truncate">{c.nome}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => startEdit(c)}><Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-brand" /></button>
                      <button onClick={() => handleDelete(c)}><Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-600" /></button>
                    </div>
                  </div>
                ))}
                {categorias.length === 0 && (
                  <p className="px-3 py-4 text-xs text-muted-foreground">Nenhuma categoria cadastrada.</p>
                )}
              </div>
            </>
          )}

          {showForm && (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2">
                <div className="col-span-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-dark">Nome</label>
                  <input
                    className="w-full text-xs border-2 border-grid px-2 py-1.5 focus:outline-none focus:border-brand"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-dark">Sinal</label>
                  <select
                    className="w-full text-xs border-2 border-grid px-2 py-1.5 focus:outline-none focus:border-brand"
                    value={sinal}
                    onChange={(e) => setSinal(e.target.value as 'entrada' | 'saida')}
                  >
                    <option value="entrada">(+) Entrada</option>
                    <option value="saida">(-) Saída</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-dark">Ordem</label>
                  <input
                    type="number"
                    className="w-full text-xs border-2 border-grid px-2 py-1.5 focus:outline-none focus:border-brand"
                    value={ordem}
                    onChange={(e) => setOrdem(Number(e.target.value) || 0)}
                  />
                </div>
              </div>

              <p className="text-[10px] text-muted-foreground">
                Esta categoria só passa a valer para uma transferência quando referenciada por uma
                regra em "Contas Especiais" (Mútuo/CG/Aporte/Interno).
              </p>

              <div className="flex items-center gap-2 pt-1">
                <button
                  className="text-xs font-bold bg-brand text-white px-3 py-1.5 hover:bg-brand/90 disabled:opacity-50"
                  onClick={save}
                  disabled={!nome.trim() || isPending}
                >
                  Salvar
                </button>
                <button className="text-xs font-bold text-muted-foreground px-3 py-1.5 hover:text-dark" onClick={cancelForm}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Modal: regras por par de conta (Mútuo/Conta Garantida/Aporte/Interno) ───

const REGRA_PAR_VAZIA: Omit<RegraParTransferencia, 'id'> = {
  empresa_origem: '', empresa_destino: '', banco: '', conta: '', rotulo: '',
  anular: false, categoria_positiva_id: null, categoria_negativa_id: null,
}

function RegrasParTransferenciaModal({ onClose }: { onClose: () => void }) {
  const { data: regras = [] } = useCustoFinanceiroRegrasPar(true)
  const { data: categorias = [] } = useCustoFinanceiroCategorias()
  const createRegra = useCreateCustoFinanceiroRegraPar()
  const updateRegra = useUpdateCustoFinanceiroRegraPar()
  const deleteRegra = useDeleteCustoFinanceiroRegraPar()

  const [editando, setEditando] = useState<RegraParTransferencia | null>(null)
  const [criando, setCriando] = useState(false)
  const [form, setForm] = useState<Omit<RegraParTransferencia, 'id'>>(REGRA_PAR_VAZIA)

  const isPending = createRegra.isPending || updateRegra.isPending
  const showForm = criando || !!editando
  const nomeCategoria = (id: number | null) => categorias.find((c) => c.id === id)?.nome ?? '—'

  function startCreate() {
    setEditando(null)
    setCriando(true)
    setForm(REGRA_PAR_VAZIA)
  }

  function startEdit(r: RegraParTransferencia) {
    setCriando(false)
    setEditando(r)
    setForm({ ...r, rotulo: r.rotulo ?? '' })
  }

  function cancelForm() {
    setCriando(false)
    setEditando(null)
  }

  function save() {
    if (!form.empresa_origem.trim() || !form.empresa_destino.trim() || !form.banco.trim() || !form.conta.trim()) return
    const payload = {
      ...form,
      empresa_origem: form.empresa_origem.trim(),
      empresa_destino: form.empresa_destino.trim(),
      banco: form.banco.trim(),
      conta: form.conta.trim(),
      rotulo: form.rotulo?.trim() || null,
      categoria_positiva_id: form.anular ? null : form.categoria_positiva_id,
      categoria_negativa_id: form.anular ? null : form.categoria_negativa_id,
    }
    if (editando) {
      updateRegra.mutate({ id: editando.id, ...payload }, { onSuccess: cancelForm })
    } else {
      createRegra.mutate(payload, { onSuccess: cancelForm })
    }
  }

  function handleDelete(r: RegraParTransferencia) {
    if (!confirm(`Excluir a regra de ${r.empresa_origem} → ${r.empresa_destino} (banco ${r.banco} / conta ${r.conta})?`)) return
    deleteRegra.mutate(r.id)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white block-border max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b-2 border-grid flex-shrink-0">
          <div>
            <span className="text-xs font-black uppercase tracking-widest text-dark">Contas Especiais de Transferência</span>
            <p className="text-[10px] text-muted-foreground">
              Regras por par de empresa + conta (Mútuo, Conta Garantida, Aporte, Interno) — têm prioridade sobre as regras por conta única e por descrição.
            </p>
          </div>
          <button onClick={onClose}><X className="h-4 w-4 text-muted-foreground hover:text-dark" /></button>
        </div>

        <div className="overflow-auto flex-1 p-4 space-y-4">
          {!showForm && (
            <>
              <button
                className="flex items-center gap-1.5 text-xs font-bold text-brand hover:underline"
                onClick={startCreate}
              >
                <Plus className="h-3.5 w-3.5" /> Nova regra
              </button>
              <div className="border-2 border-grid divide-y-2 divide-grid">
                {regras.map((r) => (
                  <div key={r.id} className="flex items-center justify-between px-3 py-2 text-xs gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-dark">{r.empresa_origem} → {r.empresa_destino}</span>
                        <span className="text-muted-foreground">Banco {r.banco} / Conta {r.conta}</span>
                        {r.rotulo && <span className="text-[9px] uppercase font-bold text-muted-foreground border border-grid px-1">{r.rotulo}</span>}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {r.anular ? (
                          <span className="text-amber-600 font-bold">Anular — suprimido do card</span>
                        ) : (
                          <>
                            <span className="text-green-700">(+) {nomeCategoria(r.categoria_positiva_id)}</span>
                            {' '}/{' '}
                            <span className="text-red-700">(-) {nomeCategoria(r.categoria_negativa_id)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => startEdit(r)}><Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-brand" /></button>
                      <button onClick={() => handleDelete(r)}><Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-600" /></button>
                    </div>
                  </div>
                ))}
                {regras.length === 0 && (
                  <p className="px-3 py-4 text-xs text-muted-foreground">Nenhuma regra cadastrada.</p>
                )}
              </div>
            </>
          )}

          {showForm && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-dark">Empresa Origem</label>
                  <input
                    className="w-full text-xs border-2 border-grid px-2 py-1.5 focus:outline-none focus:border-brand"
                    value={form.empresa_origem}
                    onChange={(e) => setForm((f) => ({ ...f, empresa_origem: e.target.value }))}
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-dark">Empresa Destino</label>
                  <input
                    className="w-full text-xs border-2 border-grid px-2 py-1.5 focus:outline-none focus:border-brand"
                    value={form.empresa_destino}
                    onChange={(e) => setForm((f) => ({ ...f, empresa_destino: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-dark">Banco</label>
                  <input
                    className="w-full text-xs border-2 border-grid px-2 py-1.5 focus:outline-none focus:border-brand"
                    value={form.banco}
                    onChange={(e) => setForm((f) => ({ ...f, banco: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-dark">Conta</label>
                  <input
                    className="w-full text-xs border-2 border-grid px-2 py-1.5 focus:outline-none focus:border-brand"
                    value={form.conta}
                    onChange={(e) => setForm((f) => ({ ...f, conta: e.target.value }))}
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-dark">Rótulo (opcional, ex.: Mutuo, CG, Aporte, Interno)</label>
                  <input
                    className="w-full text-xs border-2 border-grid px-2 py-1.5 focus:outline-none focus:border-brand"
                    value={form.rotulo ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, rotulo: e.target.value }))}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs font-bold text-dark cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="accent-brand"
                  checked={form.anular}
                  onChange={(e) => setForm((f) => ({ ...f, anular: e.target.checked }))}
                />
                Anular — suprimir esses lançamentos do card (não é fluxo de caixa real)
              </label>

              {!form.anular && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-dark">Categoria quando valor positivo (entrada)</label>
                    <select
                      className="w-full text-xs border-2 border-grid px-2 py-1.5 bg-white focus:outline-none focus:border-brand"
                      value={form.categoria_positiva_id ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, categoria_positiva_id: e.target.value ? Number(e.target.value) : null }))}
                    >
                      <option value="">Não Classificado</option>
                      {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-dark">Categoria quando valor negativo (saída)</label>
                    <select
                      className="w-full text-xs border-2 border-grid px-2 py-1.5 bg-white focus:outline-none focus:border-brand"
                      value={form.categoria_negativa_id ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, categoria_negativa_id: e.target.value ? Number(e.target.value) : null }))}
                    >
                      <option value="">Não Classificado</option>
                      {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  className="text-xs font-bold bg-brand text-white px-3 py-1.5 hover:bg-brand/90 disabled:opacity-50"
                  onClick={save}
                  disabled={!form.empresa_origem.trim() || !form.empresa_destino.trim() || !form.banco.trim() || !form.conta.trim() || isPending}
                >
                  Salvar
                </button>
                <button className="text-xs font-bold text-muted-foreground px-3 py-1.5 hover:text-dark" onClick={cancelForm}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function FluxoObras() {
  useEffect(() => {
    document.title = 'Fluxo de Obras | DashFinance'
  }, [])

  const [periodo, setPeriodo] = useState<Periodo>({
    anoInicio: currentYear, mesInicio: 1,
    anoFim: currentYear, mesFim: 12,
  })
  const [view, setView] = useState<'grupos' | 'obras'>('grupos')
  const [grupoAtivoId, setGrupoAtivoId] = useState<number | null>(null)
  // Projeção do Fluxo Acumulado Real (toggle local; não persiste)
  const [projetarFuturo, setProjetarFuturo] = useState(false)
  // 'novo' abre o modal em modo criação; GrupoObras abre em modo edição
  const [modalState, setModalState] = useState<'novo' | GrupoObras | null>(null)
  // filtros para dados reais
  const [origensAP, setOrigensAP] = useState<string[]>(['Pago'])
  const [statusRec, setStatusRec] = useState<string[]>(['Recebida'])
  const lastRestoredMetaRef = useRef<string | null>(null)
  const periodoFromGroupRef = useRef(false)

  const { data: tree } = useFilterTree()
  const { data: todasObras, isLoading: loadingObras } = useFluxoObrasTodas(grupoAtivoId, periodo)
  const { data: grupos = [], isLoading: loadingGrupos } = useGruposObras()
  const { data: totaisReaisMap } = useGruposTotaisReais()
  const { data: totaisPrevMap } = useGruposTotaisPrevistos()
  const fluxoRealCache = useFluxoRealCache(grupoAtivoId, periodo)
  const atualizarFluxoReal = useAtualizarFluxoReal()
  const savePeriodo = useSavePeriodoGrupo()
  const deleteGrupo = useDeleteGrupo()

  const dadosReais = fluxoRealCache.data?.data ?? null
  const meta = fluxoRealCache.data?.meta ?? null
  const loadingReal = fluxoRealCache.isFetching || atualizarFluxoReal.isPending

  // Restaura filtros do snapshot ao carregar/atualizar (não sobrescreve edições manuais subsequentes)
  useEffect(() => {
    if (!meta) {
      lastRestoredMetaRef.current = null
      return
    }
    if (lastRestoredMetaRef.current === meta.updated_at) return
    lastRestoredMetaRef.current = meta.updated_at
    setOrigensAP(meta.origens)
    setStatusRec(meta.status_rec)
  }, [meta])

  // Ao abrir um grupo, carrega o período salvo no banco (comum a todos os usuários)
  useEffect(() => {
    if (grupoAtivoId === null) return
    periodoFromGroupRef.current = true
    const grupo = grupos.find((g) => g.id === grupoAtivoId)
    const p = grupo?.periodo_padrao
    if (p) {
      setPeriodo({ anoInicio: p.ano_inicio, mesInicio: p.mes_inicio, anoFim: p.ano_fim, mesFim: p.mes_fim })
    } else {
      setPeriodo({ anoInicio: currentYear, mesInicio: 1, anoFim: currentYear, mesFim: 12 })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupoAtivoId])

  // Ao alterar o período (pelo usuário, não por carregamento), persiste no banco
  useEffect(() => {
    if (grupoAtivoId === null) return
    if (periodoFromGroupRef.current) { periodoFromGroupRef.current = false; return }
    const grupo = grupos.find((g) => g.id === grupoAtivoId)
    if (!grupo?.can_edit) return
    savePeriodo.mutate({ grupoId: grupoAtivoId, periodo })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo])

  // grupoAtivo sempre reflete o estado mais recente do servidor
  const grupoAtivo = useMemo(
    () => grupos.find((g) => g.id === grupoAtivoId) ?? null,
    [grupos, grupoAtivoId],
  )

  const custoFinanceiroEnabled = !!(grupoAtivoId !== null && grupoAtivo?.incluir_custo_financeiro)
  const { data: custoFinanceiro } = useCustoFinanceiro(periodo, grupoAtivoId, custoFinanceiroEnabled)

  function calcTotaisGrupo(grupo: GrupoObras) {
    const t = totaisPrevMap?.[String(grupo.id)]
    if (!t) return null
    return { custoPrev: t.custo_prev, recPrev: t.receita_prev, saldo: t.receita_prev - t.custo_prev }
  }

  const obrasDoGrupo = useMemo(() => {
    if (!todasObras || !grupoAtivo) return []
    const set = new Set(grupoAtivo.obras)
    return todasObras.filter((o) => set.has(o.obra_codigo))
  }, [todasObras, grupoAtivo])

  type ObraRender = FluxoPlanejamentoResponse & {
    _isEspecial?: boolean
    _recRealizadaPct?: number[]
  }

  const obrasParaRender = useMemo((): ObraRender[] => {
    // 1. Merge com dados reais
    const realMap = dadosReais ? new Map(dadosReais.map((r) => [r.obra_codigo, r.meses])) : new Map()
    let result: ObraRender[] = obrasDoGrupo.map((obra) => {
      const real = realMap.get(obra.obra_codigo)
      if (!real) return obra
      return {
        ...obra,
        meses: obra.meses.map((m, i) => ({
          ...m,
          custo_real: real[i]?.custo_real ?? 0,
          receita_realizada: real[i]?.receita_realizada ?? 0,
        })),
      }
    })

    // 2. Calcular receitas da obra especial
    const especial = grupoAtivo?.obra_especial
    const pcts = grupoAtivo?.percentuais ?? {}
    if (especial && result.some((o) => o.obra_codigo === especial)) {
      const regulares = result.filter((o) => o.obra_codigo !== especial)
      result = result.map((obra) => {
        if (obra.obra_codigo !== especial) return obra
        const nSlots = regulares[0]?.meses.length ?? 0
        const recPrevCalc = Array.from({ length: nSlots }, (_, i) =>
          regulares.reduce((s, o) => s + o.meses[i].receita_prevista * ((pcts[o.obra_codigo] ?? 0) / 100), 0),
        )
        const recRealPct = Array.from({ length: nSlots }, (_, i) =>
          regulares.reduce((s, o) => s + o.meses[i].receita_realizada * ((pcts[o.obra_codigo] ?? 0) / 100), 0),
        )
        return {
          ...obra,
          meses: obra.meses.map((m, i) => ({ ...m, receita_prevista: recPrevCalc[i] })),
          _isEspecial: true,
          _recRealizadaPct: recRealPct,
        }
      })
    }

    // 3. Obra especial sempre por último
    return result.sort((a, b) => (a._isEspecial ? 1 : 0) - (b._isEspecial ? 1 : 0))
  }, [obrasDoGrupo, dadosReais, grupoAtivo])

  type GreedyResult = {
    sintetica: FluxoPlanejamentoResponse & { _greedyCount: number; _greedyEmpresas: string[] }
    breakdown: FluxoPlanejamentoResponse[]
  }

  const obrasGreedy = useMemo((): GreedyResult | null => {
    if (!grupoAtivo?.empresas_greedy?.length || !tree) return null
    const grupoSet = new Set(grupoAtivo.obras)
    const greedyObras = grupoAtivo.empresas_greedy.flatMap(
      (emp) => (tree.obras_por_empresa[emp] ?? []).filter((o) => !grupoSet.has(o))
    )
    if (!greedyObras.length) return null
    const greedySet = new Set(greedyObras)

    const planejamento = (todasObras ?? []).filter((o) => greedySet.has(o.obra_codigo))
    const realMap = dadosReais ? new Map(dadosReais.map((r) => [r.obra_codigo, r.meses])) : new Map()
    const merged: FluxoPlanejamentoResponse[] = planejamento.map((obra) => {
      const real = realMap.get(obra.obra_codigo)
      if (!real) return obra
      return {
        ...obra,
        meses: obra.meses.map((m, i) => ({
          ...m,
          custo_real: real[i]?.custo_real ?? 0,
          receita_realizada: real[i]?.receita_realizada ?? 0,
        })),
      }
    })

    const nSlots = merged[0]?.meses.length ?? planejamento[0]?.meses.length ?? 0
    const meses = Array.from({ length: nSlots }, (_, i) => {
      const slot = merged[0]?.meses[i]
      return {
        mes: slot?.mes ?? i + 1,
        ano: slot?.ano ?? periodo.anoInicio,
        custo_previsto: merged.reduce((s, o) => s + o.meses[i].custo_previsto, 0),
        receita_prevista: merged.reduce((s, o) => s + o.meses[i].receita_prevista, 0),
        custo_real: merged.reduce((s, o) => s + o.meses[i].custo_real, 0),
        receita_realizada: merged.reduce((s, o) => s + o.meses[i].receita_realizada, 0),
      }
    })

    return {
      sintetica: {
        obra_codigo: '__DEMAIS_OBRAS__',
        ano: periodo.anoInicio,
        custo_global: 0,
        receita_global: 0,
        meses,
        _greedyCount: greedyObras.length,
        _greedyEmpresas: grupoAtivo.empresas_greedy,
      },
      breakdown: merged,
    }
  }, [grupoAtivo, tree, todasObras, dadosReais, periodo])

  // Saldo do Mês do Consolidado Operacional (Receita Realizada − Custo Real), por ano/mês —
  // usado pelo Custo Financeiro para refletir o fluxo de caixa total do grupo, não só o financeiro.
  const saldoOperacionalPorMes = useMemo(() => {
    const map = new Map<string, number>()
    for (const obra of obrasParaRender) {
      for (const m of obra.meses) {
        const key = `${m.ano}-${m.mes}`
        map.set(key, (map.get(key) ?? 0) + (m.receita_realizada - m.custo_real))
      }
    }
    if (obrasGreedy) {
      for (const m of obrasGreedy.sintetica.meses) {
        const key = `${m.ano}-${m.mes}`
        map.set(key, (map.get(key) ?? 0) + (m.receita_realizada - m.custo_real))
      }
    }
    return map
  }, [obrasParaRender, obrasGreedy])

  function handleAbrirGrupo(g: GrupoObras) {
    setGrupoAtivoId(g.id)
    setView('obras')
  }

  function handleVoltar() {
    setView('grupos')
    setGrupoAtivoId(null)
  }

  function handleExcluirGrupo(g: GrupoObras) {
    if (!confirm(`Excluir o grupo "${g.nome}"?`)) return
    deleteGrupo.mutate(g.id, {
      onSuccess: () => {
        if (grupoAtivoId === g.id) handleVoltar()
      },
    })
  }

  function handleExportarPDF() {
    if (!grupoAtivo || !obrasParaRender.length) return

    const nSlots = obrasParaRender[0].meses.length
    const greedy = obrasGreedy?.sintetica
    const custoReal = Array.from({ length: nSlots }, (_, i) =>
      obrasParaRender.reduce((s, o) => s + o.meses[i].custo_real, 0)
      + (greedy?.meses[i].custo_real ?? 0),
    )
    const recReal = Array.from({ length: nSlots }, (_, i) =>
      obrasParaRender.reduce((s, o) => s + o.meses[i].receita_realizada, 0)
      + (greedy?.meses[i].receita_realizada ?? 0),
    )
    const saldoMes = custoReal.map((c, i) => recReal[i] - c)
    let acc = 0
    const saldoAcc = saldoMes.map((s) => { acc += s; return acc })

    const colunas = obrasParaRender[0].meses.map((m) => ({
      label: `${MESES[m.mes - 1]}/${String(m.ano).slice(2)}`,
    }))

    exportFluxoObrasPDF({
      grupo: grupoAtivo,
      periodo,
      colunas,
      obras: obrasParaRender,
      consolidado: { custoReal, recReal, saldoMes, saldoAcc },
      demaisObras: greedy ?? null,
    })
  }

  const seletor_periodo = (
    <PeriodoMesesSelector periodo={periodo} onChange={setPeriodo} />
  )

  const modal = modalState !== null && (
    <GrupoModal
      grupos={grupos}
      obrasPorEmpresa={tree?.obras_por_empresa ?? {}}
      onClose={() => setModalState(null)}
      initialEditando={typeof modalState === 'object' ? modalState : undefined}
      startInCreate={modalState === 'novo'}
    />
  )

  // ── Tela: galeria de grupos ───────────────────────────────────────────────

  if (view === 'grupos') {
    return (
      <div className="flex h-full min-h-0">
        <div className="min-w-0 flex-1 overflow-auto p-5 md:p-7">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="section-label text-brand">Obras</p>
              <h1 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-dark md:text-2xl">
                Fluxo de caixa gerencial
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setModalState('novo')}
                className="rounded-md bg-dark px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand hover:text-dark"
              >
                Novo grupo
              </button>
            </div>
          </div>

          {loadingGrupos ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-52 w-full" />
              ))}
            </div>
          ) : grupos.length === 0 ? (
            <div className="data-panel p-12 text-center">
              <p className="mb-4 text-sm font-medium text-muted-foreground">
                Nenhum grupo criado ainda.
              </p>
              <button
                onClick={() => setModalState('novo')}
                className="rounded-md bg-dark px-6 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand hover:text-dark"
              >
                Criar primeiro grupo
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {grupos.map((g) => (
                <GrupoCard
                  key={g.id}
                  grupo={g}
                  totais={calcTotaisGrupo(g)}
                  totaisReais={totaisReaisMap?.[String(g.id)] ?? null}
                  onAbrir={() => handleAbrirGrupo(g)}
                  onEditar={() => setModalState(g)}
                  onExcluir={() => handleExcluirGrupo(g)}
                  deletePending={deleteGrupo.isPending}
                  canEdit={g.can_edit === true}
                />
              ))}
            </div>
          )}

          {modal}
        </div>
      </div>
    )
  }

  // ── Tela: detalhe do grupo ────────────────────────────────────────────────

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-auto p-5 md:p-7">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={handleVoltar}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-line px-3 py-2 text-xs font-semibold text-dark transition-colors hover:border-brand hover:bg-brand hover:text-dark"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Voltar
            </button>
            <div>
              <h1 className="text-xl font-semibold tracking-[-0.03em] text-dark md:text-2xl">
                {grupoAtivo?.nome}
              </h1>
              {grupoAtivo?.descricao && (
                <p className="text-xs text-muted-foreground mt-0.5">{grupoAtivo.descricao}</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {grupoAtivo?.can_edit === true && (
              <button
                onClick={() => grupoAtivo && setModalState(grupoAtivo)}
                className="rounded-md border border-line bg-white px-3 py-2 text-xs font-semibold text-dark transition-colors hover:border-brand hover:bg-brand hover:text-dark"
              >
                Editar Grupo
              </button>
            )}
            <button
              onClick={handleExportarPDF}
              disabled={!obrasParaRender.length}
              className="flex items-center gap-2 rounded-md bg-dark px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand hover:text-dark disabled:opacity-50"
            >
              <FileDown className="h-3.5 w-3.5" />
              Exportar PDF
            </button>
          </div>
        </div>

        {loadingObras ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : obrasDoGrupo.length === 0 ? (
          <div className="data-panel p-12 text-center text-sm font-medium text-muted-foreground">
            Nenhuma obra neste grupo. Clique em <strong>Editar Grupo</strong> para adicionar obras.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Painel: Dados Reais */}
            <div className="data-panel space-y-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="section-label text-dark">Dados reais (UAU)</p>
                {seletor_periodo}
              </div>
              <div className="flex flex-wrap gap-6">
                <div className="space-y-1.5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Despesas</p>
                  <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="accent-brand"
                      checked={origensAP.includes('Pago')}
                      onChange={(e) => setOrigensAP(prev =>
                        e.target.checked ? [...prev, 'Pago'] : prev.filter(o => o !== 'Pago')
                      )}
                    />
                    Realizadas (Pago)
                  </label>
                  <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="accent-brand"
                      checked={origensAP.includes('Emissao')}
                      onChange={(e) => setOrigensAP(prev =>
                        e.target.checked
                          ? [...prev, 'Emissao', 'A Confirmar']
                          : prev.filter(o => o !== 'Emissao' && o !== 'A Confirmar')
                      )}
                    />
                    A Realizar (Emissão + A Confirmar)
                  </label>
                </div>
                <div className="space-y-1.5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Receitas</p>
                  <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="accent-brand"
                      checked={statusRec.includes('Recebida')}
                      onChange={(e) => setStatusRec(prev =>
                        e.target.checked ? [...prev, 'Recebida'] : prev.filter(s => s !== 'Recebida')
                      )}
                    />
                    Realizadas (Recebidas)
                  </label>
                  <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="accent-brand"
                      checked={statusRec.includes('A Receber')}
                      onChange={(e) => setStatusRec(prev =>
                        e.target.checked ? [...prev, 'A Receber'] : prev.filter(s => s !== 'A Receber')
                      )}
                    />
                    A Receber
                  </label>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={() => {
                    if (!grupoAtivoId) return
                    atualizarFluxoReal.mutate({
                      grupoId: grupoAtivoId,
                      periodo,
                      origens: origensAP,
                      statusRec,
                    })
                  }}
                  disabled={loadingReal || !grupoAtivoId || grupoAtivo?.can_edit !== true}
                  className="flex items-center gap-2 rounded-md bg-dark px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand hover:text-dark disabled:opacity-50"
                >
                  <RefreshCw className={cn('h-3 w-3', loadingReal && 'animate-spin')} />
                  {loadingReal ? 'Carregando…' : meta ? 'Atualizar Dados Reais' : 'Carregar Dados Reais'}
                </button>
                {meta && !loadingReal && (
                  <span className="text-xs font-bold text-teal-600">✓ Dados reais carregados</span>
                )}
                {grupoAtivo && grupoAtivo.can_edit !== true && (
                  <span className="text-xs text-muted-foreground italic">
                    Acesso somente de visualização — peça ao dono para atualizar.
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {meta ? (
                  <>
                    Última atualização: <strong>{formatDateTime(meta.updated_at)}</strong>
                    {meta.updated_by_name && <> · por {meta.updated_by_name}</>}
                    {' · filtros: '}{[...meta.origens, ...meta.status_rec].join(', ') || '—'}
                  </>
                ) : (
                  <span className="italic">Nunca atualizado · clique em "Carregar Dados Reais" para gerar o primeiro snapshot</span>
                )}
              </p>
            </div>

            {/* Painel: Projeção do Fluxo Acumulado Real */}
            <div className="data-panel space-y-2 p-5">
              <label className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-dark cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="accent-brand"
                  checked={projetarFuturo}
                  onChange={(e) => setProjetarFuturo(e.target.checked)}
                />
                Projetar Fluxo Acumulado Real (a partir de {MESES[CUR_MONTH - 1]}/{CUR_YEAR})
              </label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Com a projeção ativa, a partir do mês atual o <strong>Fluxo Acumulado Real</strong> deixa de usar só o realizado:
                a cada mês parte do acumulado do mês anterior, soma a <strong>Receita Realizada</strong> (ou, se ainda não houver,
                a <strong>Receita Prevista</strong>) e subtrai o <strong>maior valor entre Custo Real e Custo Previsto</strong>.
                Os meses projetados aparecem destacados
                (<span className="italic text-violet-700 bg-violet-50 px-1">roxo/itálico</span>).
                Desligue para voltar ao cálculo somente com valores realizados.
              </p>
            </div>

            <p className="text-xs text-muted-foreground">
              {obrasDoGrupo.length} obra(s) · Informe o <strong>valor global</strong> de custo e receita de cada obra e
              distribua nos meses · a soma precisa fechar com o global para salvar
            </p>
            {grupoAtivoId !== null && obrasParaRender.map((obra) => (
              <ObraSection
                key={obra.obra_codigo}
                grupoId={grupoAtivoId}
                data={obra}
                canEdit={grupoAtivo?.can_edit === true}
                defaultCollapsed={obrasDoGrupo.length > 5}
                projetar={projetarFuturo}
                especial={obra._isEspecial && obra._recRealizadaPct
                  ? { recRealizadaPct: obra._recRealizadaPct }
                  : undefined}
              />
            ))}

            {obrasGreedy && (
              <DemaisObrasSection
                data={obrasGreedy.sintetica}
                breakdown={obrasGreedy.breakdown}
                projetar={projetarFuturo}
              />
            )}

            {obrasParaRender.length + (obrasGreedy ? 1 : 0) > 1 && (
              <ConsolidadoGrupo obras={obrasParaRender} obrasGreedy={obrasGreedy?.sintetica} projetar={projetarFuturo} />
            )}

            {custoFinanceiro && (
              <CustoFinanceiroGrupo
                data={custoFinanceiro}
                grupoId={grupoAtivoId ?? 0}
                periodo={periodo}
                saldoOperacionalPorMes={saldoOperacionalPorMes}
              />
            )}
          </div>
        )}

        {modal}
      </div>
    </div>
  )
}
