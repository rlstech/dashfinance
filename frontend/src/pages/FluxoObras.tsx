import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronDown, ChevronRight, Eye, FileDown, History, Lock, Pencil, Plus, RefreshCw, Search, Settings2, Share2, Trash2, X } from 'lucide-react'
import {
  useAtualizarFluxoReal,
  useCreateGrupo,
  useCreateCustoFinanceiroCategoria,
  useCustoFinanceiro,
  useCustoFinanceiroCategorias,
  useCustoFinanceiroContaLancamentos,
  useCustoFinanceiroContasDisponiveis,
  useCustoFinanceiroDescricaoLancamentos,
  useCustoFinanceiroDescricoes,
  useCustoFinanceiroLancamentos,
  useCustoFinanceiroTransferenciasContas,
  useDeleteCustoFinanceiroCategoria,
  useDeleteGrupo,
  useFilterTree,
  useFluxoObrasTodas,
  useFluxoRealCache,
  useGruposObras,
  useGruposTotaisReais,
  useGruposTotaisPrevistos,
  useObraLogs,
  useSaveObraPlanejamento,
  useSavePeriodoGrupo,
  useSetLancamentoCategoria,
  useUpdateCustoFinanceiroCategoria,
  useUpdateGrupo,
  useUsers,
} from '@/hooks/useFinanceiro'
import { useAuthStore } from '@/hooks/useAuth'
import { formatCurrency, formatDateTime } from '@/lib/formatters'
import { exportFluxoObrasPDF } from '@/lib/exportFluxoObras'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import type { FluxoMesRow, FluxoPlanejamentoResponse, GrupoObras, GrupoShareItem, GrupoTotaisReais, GrupoTotaisPrevistos, PlanejamentoLogEntry, SaveObraPlanejamentoIn, Periodo, CustoFinanceiroResponse, CustoFinanceiroCategoria, CategoriaDescricaoItem, ContaDisponivel, DescricaoDisponivel, LancamentoConta, LancamentoDetalhe } from '@/types'
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

function periodoSlots(p: Periodo): Array<{ ano: number; mes: number }> {
  const slots: Array<{ ano: number; mes: number }> = []
  let { anoInicio: ano, mesInicio: mes } = p
  while (ano < p.anoFim || (ano === p.anoFim && mes <= p.mesFim)) {
    slots.push({ ano, mes })
    mes++
    if (mes > 12) { mes = 1; ano++ }
  }
  return slots
}

// ── Célula editável inline ────────────────────────────────────────────────────

interface EditableCellProps {
  value: number
  onSave: (v: number) => void
  disabled?: boolean
  colorCls?: string
}

function EditableCell({ value, onSave, disabled, colorCls }: EditableCellProps) {
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
        value === 0 ? 'text-muted-foreground/30' : (colorCls ?? 'text-dark'),
      )}
      onClick={startEdit}
      title={disabled ? undefined : 'Clique para editar'}
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
    <div className="bg-white block-border shadow-hard flex flex-col">
      {/* Header do card */}
      <div className="bg-dark text-white px-4 py-3">
        <div className="flex items-center gap-2">
          <p className="text-xs font-black uppercase tracking-widest truncate flex-1">{grupo.nome}</p>
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
        <p className="text-xs text-muted-foreground mb-3">{grupo.obras.length} obra(s)</p>
        {totais !== null ? (
          <div className="space-y-1.5">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1.5 text-xs items-baseline">
              <span></span>
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-right">Prev.</span>
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-right">Real</span>
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
            <div className="border-t-2 border-grid pt-2 mt-2 space-y-1">
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
      <div className="px-4 py-3 border-t-2 border-grid flex items-center gap-3">
        <button
          onClick={onAbrir}
          className="flex-1 text-xs font-black uppercase tracking-widest bg-dark text-white py-2 hover:bg-brand hover:text-dark transition-colors"
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
    const p = parseFloat(raw.replace(',', '.'))
    onChange(isNaN(p) ? 0 : p)
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
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setEditing(false)
            }}
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
  value, onChange, disabled, history, colorCls,
}: {
  value: number
  onChange: (v: number) => void
  disabled?: boolean
  history?: PlanejamentoLogEntry[]
  colorCls?: string
}) {
  const hasHist = !!history && history.length > 0
  return (
    <div className="relative group">
      <EditableCell value={value} onSave={onChange} disabled={disabled} colorCls={colorCls} />
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
  const [custoPrev, setCustoPrev] = useState<number[]>(() => meses.map((m) => m.custo_previsto))
  const [receitaPrev, setReceitaPrev] = useState<number[]>(() => meses.map((m) => m.receita_prevista))
  const [custoGlobal, setCustoGlobal] = useState<number>(data.custo_global)
  const [receitaGlobal, setReceitaGlobal] = useState<number>(data.receita_global)

  // Reinicializa quando os dados do servidor mudam (período, novo snapshot salvo, etc.)
  const serverSig = useMemo(
    () => JSON.stringify({
      c: meses.map((m) => m.custo_previsto),
      r: meses.map((m) => m.receita_prevista),
      cg: data.custo_global, rg: data.receita_global,
    }),
    [meses, data.custo_global, data.receita_global],
  )
  useEffect(() => {
    setCustoPrev(meses.map((m) => m.custo_previsto))
    setReceitaPrev(meses.map((m) => m.receita_prevista))
    setCustoGlobal(data.custo_global)
    setReceitaGlobal(especial
      ? r2(meses.reduce((s, m) => s + m.receita_prevista, 0))
      : data.receita_global)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSig])

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
    <div className="bg-white block-border shadow-hard">
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
  let accReal = 0
  const acumuladoReal = meses.map((m, i) => {
    if (mesProjetado[i]) {
      const receitaMes = m.receita_realizada > 0 ? m.receita_realizada : m.receita_prevista
      accReal += receitaMes - Math.max(m.custo_real, m.custo_previsto)
    } else {
      accReal += m.receita_realizada - m.custo_real
    }
    return accReal
  })

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
    <div className="bg-white block-border shadow-hard">
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
    <div className="bg-white block-border shadow-hard">
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

function CustoFinanceiroGrupo({ data, grupoId, periodo }: { data: CustoFinanceiroResponse; grupoId: number; periodo: Periodo }) {
  const [collapsed, setCollapsed] = useState(false)
  const [detalhe, setDetalhe] = useState<{ id: number; nome: string; ano?: number; mes?: number } | null>(null)
  const [gerenciarAberto, setGerenciarAberto] = useState(false)
  const currentUser = useAuthStore((s) => s.user)
  const { meses, categorias, total_entradas, total_saidas, fluxo_liquido } = data
  const n = meses.length

  return (
    <div className="bg-white block-border overflow-hidden">
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
          <span className="text-green-700 font-bold">Ent: {formatCurrency(total_entradas)}</span>
          <span className="text-red-700 font-bold">Saí: {formatCurrency(total_saidas)}</span>
          <span className={cn('font-black', fluxo_liquido >= 0 ? 'text-green-700' : 'text-red-700')}>
            Fluxo: {formatCurrency(fluxo_liquido)}
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
                  className={ci % 2 === 0 ? 'bg-white' : 'bg-grid/20'}
                >
                  <td
                    className="px-3 py-1 sticky left-0 bg-inherit font-medium text-dark max-w-[220px] truncate cursor-pointer hover:bg-brand/10"
                    onClick={() => setDetalhe({ id: cat.categoria_id ?? CATEGORIA_NAO_CLASSIFICADA, nome: cat.nome })}
                    title="Clique para ver todos os lançamentos do período"
                  >
                    {cat.sinal && (
                      <span className={cat.sinal === 'entrada' ? 'text-green-700' : 'text-red-700'}>
                        {cat.sinal === 'entrada' ? '(+) ' : '(-) '}
                      </span>
                    )}
                    {cat.nome}
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
                <td className="px-3 py-1.5 sticky left-0 bg-dark text-[10px] uppercase tracking-widest">Total Entradas</td>
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
              <tr className="bg-dark/80 text-white font-black">
                <td className="px-3 py-1.5 sticky left-0 bg-dark/80 text-[10px] uppercase tracking-widest">Total Saídas</td>
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
              <tr className="bg-brand text-white font-black text-sm">
                <td className="px-3 py-2 sticky left-0 bg-brand text-[10px] uppercase tracking-widest">Fluxo do Período</td>
                {Array.from({ length: n }).map((_, i) => {
                  const v = categorias.reduce((s, c) => s + c.valores[i], 0)
                  return (
                    <td key={i} className={cn('px-1 py-2 text-right tabular-nums font-black', v < 0 ? 'text-red-200' : '')}>
                      {v === 0 ? '—' : formatCurrency(v)}
                    </td>
                  )
                })}
                <td className={cn('px-1 py-2 text-right tabular-nums border-l-2 border-white/30 font-black', fluxo_liquido < 0 ? 'text-red-200' : '')}>
                  {formatCurrency(fluxo_liquido)}
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
    </div>
  )
}

// ── Tabela reutilizável de lançamentos (categoria e descrição) ──────────────

function fmtContaLabel(c: LancamentoConta | null): string {
  if (!c) return '—'
  return [c.empresa, [c.banco, c.conta].filter(Boolean).join('/')].filter(Boolean).join(' — ')
}

function LancamentosTable({
  lancamentos, isLoading, emptyMessage, categorias, isAdmin, onReclassify,
}: {
  lancamentos: LancamentoDetalhe[]
  isLoading: boolean
  emptyMessage: string
  categorias: CustoFinanceiroCategoria[]
  isAdmin: boolean
  onReclassify: (lancamentoId: string, categoriaId: number | null) => void
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

// ── Modal: prévia de lançamentos de uma descrição (antes de classificar) ────

function DescricaoLancamentosModal({
  tipo, descricao, onClose,
}: {
  tipo: 'transferencia' | 'controle'
  descricao: string
  onClose: () => void
}) {
  const { data: lancamentos = [], isLoading } = useCustoFinanceiroDescricaoLancamentos(tipo, descricao, true)
  const { data: categorias = [] } = useCustoFinanceiroCategorias()
  const setCategoria = useSetLancamentoCategoria()

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white block-border max-w-6xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b-2 border-grid flex-shrink-0">
          <div className="min-w-0">
            <span className="text-xs font-black uppercase tracking-widest text-dark truncate block">{descricao}</span>
            <span className="text-[10px] text-muted-foreground">
              {tipo === 'transferencia' ? 'Transferência Bancária' : 'Controle Financeiro'} — últimos lançamentos (máx. 200)
            </span>
          </div>
          <button onClick={onClose}><X className="h-4 w-4 text-muted-foreground hover:text-dark flex-shrink-0" /></button>
        </div>
        <div className="overflow-auto flex-1">
          <LancamentosTable
            lancamentos={lancamentos}
            isLoading={isLoading}
            emptyMessage="Nenhum lançamento encontrado para essa descrição."
            categorias={categorias}
            isAdmin
            onReclassify={(lancamentoId, categoriaId) => setCategoria.mutate({ lancamentoId, categoriaId })}
          />
        </div>
      </div>
    </div>
  )
}

function ContaLancamentosModal({
  conta, onClose,
}: {
  conta: LancamentoConta
  onClose: () => void
}) {
  const { data: lancamentos = [], isLoading } = useCustoFinanceiroContaLancamentos(conta, true)
  const { data: categorias = [] } = useCustoFinanceiroCategorias()
  const setCategoria = useSetLancamentoCategoria()

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white block-border max-w-6xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b-2 border-grid flex-shrink-0">
          <div className="min-w-0">
            <span className="text-xs font-black uppercase tracking-widest text-dark truncate block">
              {conta.empresa} — Banco {conta.banco} / Conta {conta.conta}
            </span>
            <span className="text-[10px] text-muted-foreground">Transferência Bancária — últimos lançamentos (máx. 200)</span>
          </div>
          <button onClick={onClose}><X className="h-4 w-4 text-muted-foreground hover:text-dark flex-shrink-0" /></button>
        </div>
        <div className="overflow-auto flex-1">
          <LancamentosTable
            lancamentos={lancamentos}
            isLoading={isLoading}
            emptyMessage="Nenhum lançamento encontrado para essa conta."
            categorias={categorias}
            isAdmin
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
  const { data: descricoes = [] } = useCustoFinanceiroDescricoes(true)
  const { data: contasDisponiveis = [] } = useCustoFinanceiroContasDisponiveis(true)
  const createCategoria = useCreateCustoFinanceiroCategoria()
  const updateCategoria = useUpdateCustoFinanceiroCategoria()
  const deleteCategoria = useDeleteCustoFinanceiroCategoria()

  const [editando, setEditando] = useState<CustoFinanceiroCategoria | null>(null)
  const [criando, setCriando] = useState(false)
  const [nome, setNome] = useState('')
  const [sinal, setSinal] = useState<'entrada' | 'saida'>('saida')
  const [ordem, setOrdem] = useState(0)
  const [descSel, setDescSel] = useState<CategoriaDescricaoItem[]>([])
  const [busca, setBusca] = useState('')
  const [apenasNaoClassificadas, setApenasNaoClassificadas] = useState(false)
  const [filtroSentido, setFiltroSentido] = useState<'todos' | 'entrada' | 'saida' | 'mista'>('todos')
  const [preview, setPreview] = useState<{ tipo: 'transferencia' | 'controle'; descricao: string } | null>(null)
  const [contaSel, setContaSel] = useState<LancamentoConta[]>([])
  const [buscaConta, setBuscaConta] = useState('')
  const [apenasNaoClassificadasConta, setApenasNaoClassificadasConta] = useState(false)
  const [filtroSentidoConta, setFiltroSentidoConta] = useState<'todos' | 'entrada' | 'saida' | 'mista'>('todos')
  const [previewConta, setPreviewConta] = useState<LancamentoConta | null>(null)

  const isPending = createCategoria.isPending || updateCategoria.isPending

  const descricoesFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return descricoes.filter((d) => {
      if (apenasNaoClassificadas && d.categoria_id != null) return false
      if (filtroSentido !== 'todos' && d.sentido !== filtroSentido) return false
      if (termo && !d.descricao.toLowerCase().includes(termo)) return false
      return true
    })
  }, [descricoes, busca, apenasNaoClassificadas, filtroSentido])

  const contasFiltradas = useMemo(() => {
    const termo = buscaConta.trim().toLowerCase()
    return contasDisponiveis.filter((c) => {
      if (apenasNaoClassificadasConta && c.categoria_id != null) return false
      if (filtroSentidoConta !== 'todos' && c.sentido !== filtroSentidoConta) return false
      if (termo && !`${c.empresa} ${c.banco} ${c.conta}`.toLowerCase().includes(termo)) return false
      return true
    })
  }, [contasDisponiveis, buscaConta, apenasNaoClassificadasConta, filtroSentidoConta])

  function marcarTodosVisiveis() {
    setDescSel((prev) => {
      const prevKeys = new Set(prev.map((d) => `${d.tipo}|${d.descricao}`))
      const adicionar = descricoesFiltradas
        .filter((d) => !prevKeys.has(`${d.tipo}|${d.descricao}`))
        .map((d) => ({ tipo: d.tipo, descricao: d.descricao }))
      return [...prev, ...adicionar]
    })
  }

  function desmarcarTodosVisiveis() {
    setDescSel((prev) => {
      const visKeys = new Set(descricoesFiltradas.map((d) => `${d.tipo}|${d.descricao}`))
      return prev.filter((d) => !visKeys.has(`${d.tipo}|${d.descricao}`))
    })
  }

  function marcarTodasVisiveisContas() {
    setContaSel((prev) => {
      const prevKeys = new Set(prev.map((c) => `${c.empresa}|${c.banco}|${c.conta}`))
      const adicionar = contasFiltradas
        .filter((c) => !prevKeys.has(`${c.empresa}|${c.banco}|${c.conta}`))
        .map((c) => ({ empresa: c.empresa, banco: c.banco, conta: c.conta }))
      return [...prev, ...adicionar]
    })
  }

  function desmarcarTodasVisiveisContas() {
    setContaSel((prev) => {
      const visKeys = new Set(contasFiltradas.map((c) => `${c.empresa}|${c.banco}|${c.conta}`))
      return prev.filter((c) => !visKeys.has(`${c.empresa}|${c.banco}|${c.conta}`))
    })
  }

  function startCreate() {
    setEditando(null)
    setCriando(true)
    setNome('')
    setSinal('saida')
    setOrdem((categorias.length + 1) * 10)
    setDescSel([])
    setBusca('')
    setApenasNaoClassificadas(false)
    setFiltroSentido('todos')
    setContaSel([])
    setBuscaConta('')
    setApenasNaoClassificadasConta(false)
    setFiltroSentidoConta('todos')
  }

  function startEdit(c: CustoFinanceiroCategoria) {
    setCriando(false)
    setEditando(c)
    setNome(c.nome)
    setSinal(c.sinal)
    setOrdem(c.ordem)
    setDescSel(c.descricoes)
    setBusca('')
    setApenasNaoClassificadas(false)
    setFiltroSentido('todos')
    setContaSel(c.contas)
    setBuscaConta('')
    setApenasNaoClassificadasConta(false)
    setFiltroSentidoConta('todos')
  }

  function cancelForm() {
    setCriando(false)
    setEditando(null)
  }

  function save() {
    if (!nome.trim()) return
    const payload = { nome: nome.trim(), sinal, ordem, descricoes: descSel, contas: contaSel }
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

  function toggleDesc(item: DescricaoDisponivel) {
    setDescSel((prev) => {
      const exists = prev.some((d) => d.tipo === item.tipo && d.descricao === item.descricao)
      if (exists) return prev.filter((d) => !(d.tipo === item.tipo && d.descricao === item.descricao))
      return [...prev, { tipo: item.tipo, descricao: item.descricao }]
    })
  }

  function toggleConta(item: ContaDisponivel) {
    setContaSel((prev) => {
      const exists = prev.some((c) => c.empresa === item.empresa && c.banco === item.banco && c.conta === item.conta)
      if (exists) return prev.filter((c) => !(c.empresa === item.empresa && c.banco === item.banco && c.conta === item.conta))
      return [...prev, { empresa: item.empresa, banco: item.banco, conta: item.conta }]
    })
  }

  const showForm = criando || !!editando

  return (
    <>
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
                      <span className="text-muted-foreground flex-shrink-0">
                        ({c.descricoes.length} descrições, {c.contas.length} contas)
                      </span>
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

              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-dark">Descrições incluídas nesta categoria</label>
                <p className="text-[10px] text-muted-foreground pb-1">
                  Marcar uma descrição já usada em outra categoria a transfere para esta.
                </p>

                <div className="flex items-center gap-2 pb-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                    <input
                      className="w-full text-xs border-2 border-grid pl-6 pr-2 py-1.5 focus:outline-none focus:border-brand"
                      placeholder="Buscar descrição..."
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                    />
                  </div>
                  <select
                    className="text-[10px] font-bold border-2 border-grid px-1.5 py-1.5 bg-white focus:outline-none focus:border-brand flex-shrink-0"
                    value={filtroSentido}
                    onChange={(e) => setFiltroSentido(e.target.value as typeof filtroSentido)}
                  >
                    <option value="todos">Todos os sinais</option>
                    <option value="entrada">(+) Entrada</option>
                    <option value="saida">(-) Saída</option>
                    <option value="mista">± Mista</option>
                  </select>
                  <label className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground cursor-pointer select-none whitespace-nowrap">
                    <input
                      type="checkbox"
                      className="accent-brand"
                      checked={apenasNaoClassificadas}
                      onChange={(e) => setApenasNaoClassificadas(e.target.checked)}
                    />
                    Só não classificadas
                  </label>
                </div>
                <p className="text-[9px] text-muted-foreground pb-2">
                  O sinal mostrado é o observado nos lançamentos: (+) só entrada, (-) só saída, ± quando a mesma descrição já apareceu nos dois sentidos.
                </p>

                <div className="flex items-center justify-between pb-1">
                  <span className="text-[10px] text-muted-foreground">
                    {descricoesFiltradas.length} descrição(ões) no filtro — {descSel.length} selecionada(s) no total
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="text-[10px] font-bold text-brand hover:underline disabled:opacity-40 disabled:no-underline"
                      onClick={marcarTodosVisiveis}
                      disabled={descricoesFiltradas.length === 0}
                    >
                      Marcar todos visíveis
                    </button>
                    <button
                      type="button"
                      className="text-[10px] font-bold text-muted-foreground hover:underline disabled:opacity-40 disabled:no-underline"
                      onClick={desmarcarTodosVisiveis}
                      disabled={descricoesFiltradas.length === 0}
                    >
                      Desmarcar todos visíveis
                    </button>
                  </div>
                </div>

                <div className="border-2 border-grid max-h-64 overflow-auto divide-y divide-grid/50">
                  {descricoesFiltradas.map((d) => {
                    const checked = descSel.some((s) => s.tipo === d.tipo && s.descricao === d.descricao)
                    const outraCategoria = !checked && d.categoria_id != null
                      ? categorias.find((c) => c.id === d.categoria_id)
                      : null
                    return (
                      <label key={`${d.tipo}-${d.descricao}`} className="flex items-center gap-2 px-2 py-1 text-xs cursor-pointer hover:bg-brand/5">
                        <input type="checkbox" className="accent-brand flex-shrink-0" checked={checked} onChange={() => toggleDesc(d)} />
                        <span
                          className={cn(
                            'text-[10px] font-black w-4 flex-shrink-0 text-center',
                            d.sentido === 'entrada' ? 'text-green-700' : d.sentido === 'saida' ? 'text-red-700' : 'text-amber-600',
                          )}
                          title={d.sentido === 'entrada' ? 'Só entrada' : d.sentido === 'saida' ? 'Só saída' : 'Sinal misto'}
                        >
                          {d.sentido === 'entrada' ? '+' : d.sentido === 'saida' ? '-' : '±'}
                        </span>
                        <span className="text-[9px] uppercase font-bold text-muted-foreground w-24 flex-shrink-0">
                          {d.tipo === 'transferencia' ? 'Transferência' : 'Controle Fin.'}
                        </span>
                        <span className="truncate flex-1">{d.descricao}</span>
                        {outraCategoria && (
                          <span className="text-[9px] text-muted-foreground flex-shrink-0">em: {outraCategoria.nome}</span>
                        )}
                        <button
                          type="button"
                          className="flex-shrink-0 text-muted-foreground hover:text-brand"
                          title="Ver lançamentos dessa descrição"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setPreview({ tipo: d.tipo, descricao: d.descricao })
                          }}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                      </label>
                    )
                  })}
                  {descricoesFiltradas.length === 0 && (
                    <p className="px-2 py-3 text-xs text-muted-foreground">
                      {descricoes.length === 0 ? 'Nenhuma descrição disponível ainda.' : 'Nenhuma descrição encontrada para esse filtro.'}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-dark">Contas incluídas nesta categoria</label>
                <p className="text-[10px] text-muted-foreground pb-1">
                  Classifica automaticamente toda Transferência Bancária dessa conta, tenha ou não regra por
                  descrição — marcar uma conta já usada em outra categoria a transfere para esta.
                </p>

                <div className="flex items-center gap-2 pb-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                    <input
                      className="w-full text-xs border-2 border-grid pl-6 pr-2 py-1.5 focus:outline-none focus:border-brand"
                      placeholder="Buscar empresa/banco/conta..."
                      value={buscaConta}
                      onChange={(e) => setBuscaConta(e.target.value)}
                    />
                  </div>
                  <select
                    className="text-[10px] font-bold border-2 border-grid px-1.5 py-1.5 bg-white focus:outline-none focus:border-brand flex-shrink-0"
                    value={filtroSentidoConta}
                    onChange={(e) => setFiltroSentidoConta(e.target.value as typeof filtroSentidoConta)}
                  >
                    <option value="todos">Todos os sinais</option>
                    <option value="entrada">(+) Entrada</option>
                    <option value="saida">(-) Saída</option>
                    <option value="mista">± Mista</option>
                  </select>
                  <label className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground cursor-pointer select-none whitespace-nowrap">
                    <input
                      type="checkbox"
                      className="accent-brand"
                      checked={apenasNaoClassificadasConta}
                      onChange={(e) => setApenasNaoClassificadasConta(e.target.checked)}
                    />
                    Só não classificadas
                  </label>
                </div>
                <p className="text-[9px] text-muted-foreground pb-2">
                  O sinal mostrado é o observado nos lançamentos: (+) só entrada, (-) só saída, ± quando a mesma conta já apareceu nos dois sentidos.
                </p>

                <div className="flex items-center justify-between pb-1">
                  <span className="text-[10px] text-muted-foreground">
                    {contasFiltradas.length} conta(s) no filtro — {contaSel.length} selecionada(s) no total
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="text-[10px] font-bold text-brand hover:underline disabled:opacity-40 disabled:no-underline"
                      onClick={marcarTodasVisiveisContas}
                      disabled={contasFiltradas.length === 0}
                    >
                      Marcar todos visíveis
                    </button>
                    <button
                      type="button"
                      className="text-[10px] font-bold text-muted-foreground hover:underline disabled:opacity-40 disabled:no-underline"
                      onClick={desmarcarTodasVisiveisContas}
                      disabled={contasFiltradas.length === 0}
                    >
                      Desmarcar todos visíveis
                    </button>
                  </div>
                </div>

                <div className="border-2 border-grid max-h-64 overflow-auto divide-y divide-grid/50">
                  {contasFiltradas.map((c) => {
                    const checked = contaSel.some((s) => s.empresa === c.empresa && s.banco === c.banco && s.conta === c.conta)
                    const outraCategoria = !checked && c.categoria_id != null
                      ? categorias.find((cat) => cat.id === c.categoria_id)
                      : null
                    return (
                      <label key={`${c.empresa}-${c.banco}-${c.conta}`} className="flex items-center gap-2 px-2 py-1 text-xs cursor-pointer hover:bg-brand/5">
                        <input type="checkbox" className="accent-brand flex-shrink-0" checked={checked} onChange={() => toggleConta(c)} />
                        <span
                          className={cn(
                            'text-[10px] font-black w-4 flex-shrink-0 text-center',
                            c.sentido === 'entrada' ? 'text-green-700' : c.sentido === 'saida' ? 'text-red-700' : 'text-amber-600',
                          )}
                          title={c.sentido === 'entrada' ? 'Só entrada' : c.sentido === 'saida' ? 'Só saída' : 'Sinal misto'}
                        >
                          {c.sentido === 'entrada' ? '+' : c.sentido === 'saida' ? '-' : '±'}
                        </span>
                        <span className="text-[9px] uppercase font-bold text-muted-foreground w-24 flex-shrink-0 truncate">{c.empresa}</span>
                        <span className="truncate flex-1">Banco {c.banco} / Conta {c.conta}</span>
                        {outraCategoria && (
                          <span className="text-[9px] text-muted-foreground flex-shrink-0">em: {outraCategoria.nome}</span>
                        )}
                        <button
                          type="button"
                          className="flex-shrink-0 text-muted-foreground hover:text-brand"
                          title="Ver lançamentos dessa conta"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setPreviewConta({ empresa: c.empresa, banco: c.banco, conta: c.conta })
                          }}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                      </label>
                    )
                  })}
                  {contasFiltradas.length === 0 && (
                    <p className="px-2 py-3 text-xs text-muted-foreground">
                      {contasDisponiveis.length === 0 ? 'Nenhuma conta disponível ainda.' : 'Nenhuma conta encontrada para esse filtro.'}
                    </p>
                  )}
                </div>
              </div>

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
    {preview && (
      <DescricaoLancamentosModal
        tipo={preview.tipo}
        descricao={preview.descricao}
        onClose={() => setPreview(null)}
      />
    )}
    {previewConta && (
      <ContaLancamentosModal
        conta={previewConta}
        onClose={() => setPreviewConta(null)}
      />
    )}
    </>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function FluxoObras() {
  useEffect(() => {
    document.title = 'Fluxo de Obras | DashFinance'
  }, [])

  const currentUser = useAuthStore((s) => s.user)

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
  const { data: totaisReaisMap } = useGruposTotaisReais(periodo.anoInicio)
  const { data: totaisPrevMap } = useGruposTotaisPrevistos(periodo)
  const fluxoRealCache = useFluxoRealCache(grupoAtivoId, periodo)
  const atualizarFluxoReal = useAtualizarFluxoReal()
  const saveObraPlanejamento = useSaveObraPlanejamento()
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
      <div className="flex h-full">
        <div className="p-6 md:p-8 overflow-auto flex-1">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <h1 className="text-xl md:text-2xl font-black uppercase tracking-tight text-dark">
              Fluxo de Caixa Gerencial de Obras
            </h1>
            <div className="flex items-center gap-3">
              {seletor_periodo}
              <button
                onClick={() => setModalState('novo')}
                className="text-xs font-black uppercase tracking-widest bg-dark text-white px-4 py-2 hover:bg-brand hover:text-dark transition-colors"
              >
                + Novo Grupo
              </button>
            </div>
          </div>

          {loadingGrupos ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-52 w-full" />
              ))}
            </div>
          ) : grupos.length === 0 ? (
            <div className="bg-white block-border shadow-hard p-12 text-center">
              <p className="text-sm font-bold text-muted-foreground mb-4">
                Nenhum grupo criado ainda.
              </p>
              <button
                onClick={() => setModalState('novo')}
                className="text-xs font-black uppercase tracking-widest bg-dark text-white px-6 py-2 hover:bg-brand hover:text-dark transition-colors"
              >
                + Criar primeiro grupo
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
    <div className="flex h-full">
      <div className="p-6 md:p-8 overflow-auto flex-1">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <button
              onClick={handleVoltar}
              className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest border-2 border-dark px-3 py-2 hover:bg-brand hover:border-brand hover:text-dark transition-colors flex-shrink-0"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Voltar
            </button>
            <div>
              <h1 className="text-xl md:text-2xl font-black uppercase tracking-tight text-dark">
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
                className="text-xs font-black uppercase tracking-widest border-2 border-dark px-3 py-2 bg-white hover:bg-brand hover:border-brand hover:text-dark transition-colors"
              >
                Editar Grupo
              </button>
            )}
            {seletor_periodo}
            <button
              onClick={handleExportarPDF}
              disabled={!obrasParaRender.length}
              className="bg-dark text-white text-xs font-black uppercase tracking-widest px-4 py-2 hover:bg-brand hover:text-dark transition-colors disabled:opacity-50 flex items-center gap-2"
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
          <div className="bg-white block-border shadow-hard p-12 text-center text-muted-foreground text-sm font-bold">
            Nenhuma obra neste grupo. Clique em <strong>Editar Grupo</strong> para adicionar obras.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Painel: Dados Reais */}
            <div className="bg-white block-border p-4 space-y-3">
              <p className="text-xs font-black uppercase tracking-widest text-dark">Dados Reais (UAU)</p>
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
                  className="text-xs font-black uppercase tracking-widest bg-dark text-white px-4 py-2 hover:bg-brand hover:text-dark transition-colors disabled:opacity-50 flex items-center gap-2"
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
            <div className="bg-white block-border p-4 space-y-2">
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
              <CustoFinanceiroGrupo data={custoFinanceiro} grupoId={grupoAtivoId ?? 0} periodo={periodo} />
            )}
          </div>
        )}

        {modal}
      </div>
    </div>
  )
}
