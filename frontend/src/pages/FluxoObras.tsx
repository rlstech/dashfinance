import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronDown, ChevronRight, Lock, RefreshCw, Search, Share2, Upload, X } from 'lucide-react'
import {
  useCreateGrupo,
  useDeleteGrupo,
  useFilterTree,
  useFluxoObrasTodas,
  useFluxoObrasReal,
  useGruposObras,
  useImportarPlanilhaObras,
  useSavePlanejamento,
  useUpdateGrupo,
  useUsers,
} from '@/hooks/useFinanceiro'
import { useAuthStore } from '@/hooks/useAuth'
import { formatCurrency } from '@/lib/formatters'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

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
  const [sharedWithIds, setSharedWithIds] = useState<number[]>(initialEditando?.shared_with ?? [])
  const [empresasGreedy, setEmpresasGreedy] = useState<string[]>(initialEditando?.empresas_greedy ?? [])

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
    setSharedWithIds([]); setEmpresasGreedy([])
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
    setSharedWithIds(g.shared_with ?? [])
    setEmpresasGreedy(g.empresas_greedy ?? [])
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
      shared_with: sharedWithIds,
      empresas_greedy: empresasGreedy,
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
    setSharedWithIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    )
  }

  const canEditGrupo = (g: GrupoObras) => g.is_owner === true || currentUser?.is_admin === true

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

              {/* Compartilhar com */}
              {otherUsers.length > 0 && (
                <div className="border-2 border-grid p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Share2 className="h-3 w-3 text-muted-foreground" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-dark">Compartilhar com</span>
                  </div>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {otherUsers.map((u) => (
                      <label key={u.id} className="flex items-center gap-2 text-xs cursor-pointer select-none hover:bg-brand/5 px-1 py-0.5">
                        <input
                          type="checkbox"
                          className="accent-brand flex-shrink-0"
                          checked={sharedWithIds.includes(u.id)}
                          onChange={() => toggleShare(u.id)}
                        />
                        <span className="truncate">{u.name}</span>
                      </label>
                    ))}
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
  onAbrir: () => void
  onEditar: () => void
  onExcluir: () => void
  deletePending: boolean
  canEdit: boolean
}

function GrupoCard({ grupo, totais, onAbrir, onEditar, onExcluir, deletePending, canEdit }: GrupoCardProps) {
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
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Custo Prev.</span>
              <span className="font-bold tabular-nums">{formatCurrency(totais.custoPrev)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Rec. Prev.</span>
              <span className="font-bold tabular-nums">{formatCurrency(totais.recPrev)}</span>
            </div>
            <div className="flex justify-between text-xs border-t-2 border-grid pt-2 mt-2">
              <span className="font-black text-dark">Saldo</span>
              <span className={cn('font-black tabular-nums', totais.saldo >= 0 ? 'text-teal-600' : 'text-red-500')}>
                {formatCurrency(totais.saldo)}
              </span>
            </div>
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

interface ObraSectionProps {
  data: FluxoPlanejamentoResponse
  ano: number
  savePending: boolean
  onSave: (payload: UpsertPlanejamentoIn) => void
  defaultCollapsed: boolean
  especial?: { recRealizadaPct: number[] }
}

function ObraSection({ data, ano, savePending, onSave, defaultCollapsed, especial }: ObraSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  const meses: FluxoMesRow[] = data.meses

  const totalCustoPrev = meses.reduce((s, m) => s + m.custo_previsto, 0)
  const totalRecPrev = meses.reduce((s, m) => s + m.receita_prevista, 0)
  const saldoPrev = totalRecPrev - totalCustoPrev

  let accPlan = 0
  let accReal = 0
  const acumuladoPlanejado = meses.map((m) => {
    accPlan += m.receita_prevista - m.custo_previsto
    return accPlan
  })
  // Para obra especial, fluxo real usa Receita UAU; para normal, usa receita_realizada
  const recRealParaAcc = especial ? meses.map((m) => m.receita_realizada) : meses.map((m) => m.receita_realizada)
  const acumuladoReal = meses.map((m, i) => {
    accReal += recRealParaAcc[i] - m.custo_real
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

  const rowDefs: RowDef[] = especial
    ? [
        { label: 'Custo Previsto', kind: 'editable', field: 'custo_previsto', values: meses.map((m) => m.custo_previsto) },
        { label: 'Custo Real', kind: 'readonly', values: meses.map((m) => m.custo_real) },
        { label: 'Receita Prevista (%)', kind: 'readonly', values: meses.map((m) => m.receita_prevista) },
        { label: 'Receita Realizada (%)', kind: 'readonly', values: especial.recRealizadaPct },
        { label: 'Receita UAU', kind: 'readonly', values: meses.map((m) => m.receita_realizada) },
        { label: 'Fluxo Acumulado Planejado', kind: 'accumulated', values: acumuladoPlanejado },
        { label: 'Fluxo Acumulado Real (UAU)', kind: 'accumulated', values: acumuladoReal },
      ]
    : [
        { label: 'Custo Previsto', kind: 'editable', field: 'custo_previsto', values: meses.map((m) => m.custo_previsto) },
        { label: 'Custo Real', kind: 'readonly', values: meses.map((m) => m.custo_real) },
        { label: 'Receita Prevista', kind: 'editable', field: 'receita_prevista', values: meses.map((m) => m.receita_prevista) },
        { label: 'Receita Realizada', kind: 'readonly', values: meses.map((m) => m.receita_realizada) },
        { label: 'Fluxo Acumulado Planejado', kind: 'accumulated', values: acumuladoPlanejado },
        { label: 'Fluxo Acumulado Real', kind: 'accumulated', values: acumuladoReal },
      ]

  const headerCls = especial
    ? 'w-full flex items-center justify-between px-4 py-3 bg-brand text-dark hover:bg-brand/90 transition-colors'
    : 'w-full flex items-center justify-between px-4 py-3 bg-dark text-white hover:bg-dark/90 transition-colors'
  const headerTextCls = especial ? 'text-dark/60' : 'text-white/60'
  const headerValCls = especial ? 'text-dark font-bold' : 'text-white font-bold'
  const saldoCls = especial
    ? cn('font-black', saldoPrev >= 0 ? 'text-dark' : 'text-red-700')
    : cn('font-black', saldoPrev >= 0 ? 'text-teal-300' : 'text-red-400')

  return (
    <div className="bg-white block-border shadow-hard">
      <button
        type="button"
        className={headerCls}
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-3">
          {collapsed
            ? <ChevronRight className="h-4 w-4 flex-shrink-0" />
            : <ChevronDown className="h-4 w-4 flex-shrink-0" />}
          <span className="text-xs font-black uppercase tracking-widest text-left">
            {data.obra_codigo}
          </span>
          {especial && (
            <span className="text-[10px] font-black uppercase tracking-widest bg-dark/20 px-2 py-0.5">
              Obra Especial
            </span>
          )}
        </div>
        <div className="flex items-center gap-6 text-xs tabular-nums">
          <span className={cn('hidden sm:inline', headerTextCls)}>
            Custo Prev: <span className={headerValCls}>{formatCurrency(totalCustoPrev)}</span>
          </span>
          <span className={cn('hidden sm:inline', headerTextCls)}>
            Rec Prev: <span className={headerValCls}>{formatCurrency(totalRecPrev)}</span>
          </span>
          <span className={saldoCls}>
            Saldo: {formatCurrency(saldoPrev)}
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
                {MESES.map((m) => (
                  <th key={m} className="text-right font-black uppercase tracking-widest px-2 py-2 w-20">
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowDefs.map((row) => {
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

// ── Card de demais obras (greedy) ────────────────────────────────────────────

interface DemaisObrasSectionProps {
  data: FluxoPlanejamentoResponse & { _greedyCount: number; _greedyEmpresas: string[] }
  breakdown: FluxoPlanejamentoResponse[]
}

function DemaisObrasSection({ data, breakdown }: DemaisObrasSectionProps) {
  const [collapsed, setCollapsed] = useState(true)
  const meses = data.meses

  const totalCustoPrev = meses.reduce((s, m) => s + m.custo_previsto, 0)
  const totalRecPrev = meses.reduce((s, m) => s + m.receita_prevista, 0)
  const saldoPrev = totalRecPrev - totalCustoPrev

  let accReal = 0
  const acumuladoReal = meses.map((m) => {
    accReal += m.receita_realizada - m.custo_real
    return accReal
  })

  function buildTooltip(mesIdx: number, field: 'custo_real' | 'receita_realizada'): string | undefined {
    const contribuintes = breakdown
      .map((o) => ({ obra: o.obra_codigo, val: o.meses[mesIdx][field] }))
      .filter((x) => x.val !== 0)
    if (!contribuintes.length) return undefined
    return contribuintes.map((x) => `${x.obra}: ${formatCurrency(x.val)}`).join('\n')
  }

  const rows: Array<{ label: string; values: number[]; tooltipField?: 'custo_real' | 'receita_realizada'; accumulated?: boolean }> = [
    { label: 'Custo Previsto', values: meses.map((m) => m.custo_previsto) },
    { label: 'Receita Prevista', values: meses.map((m) => m.receita_prevista) },
    { label: 'Custo Real', values: meses.map((m) => m.custo_real), tooltipField: 'custo_real' },
    { label: 'Receita Realizada', values: meses.map((m) => m.receita_realizada), tooltipField: 'receita_realizada' },
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
            Custo Prev: <span className="text-dark font-bold">{formatCurrency(totalCustoPrev)}</span>
          </span>
          <span className="hidden sm:inline text-dark/60">
            Rec Prev: <span className="text-dark font-bold">{formatCurrency(totalRecPrev)}</span>
          </span>
          <span className={cn('font-black', saldoPrev >= 0 ? 'text-dark' : 'text-red-700')}>
            Saldo: {formatCurrency(saldoPrev)}
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
                {MESES.map((m) => (
                  <th key={m} className="text-right font-black uppercase tracking-widest px-2 py-2 w-20">{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const rowBg = row.accumulated ? 'bg-bgBase' : 'bg-white'
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
                      return (
                        <td key={mesIdx} className="px-1 py-1">
                          {row.accumulated ? (
                            <ValueCell value={val} bold />
                          ) : tooltip ? (
                            <span
                              title={tooltip}
                              className={cn(
                                'block w-full text-right tabular-nums text-xs px-1 py-0.5 cursor-help underline decoration-dotted decoration-muted-foreground/40',
                                val === 0 ? 'text-muted-foreground/30' : 'text-dark',
                              )}
                            >
                              {val === 0 ? '—' : formatCurrency(val)}
                            </span>
                          ) : (
                            <span className={cn(
                              'block w-full text-right tabular-nums text-xs px-1 py-0.5',
                              val === 0 ? 'text-muted-foreground/30' : 'text-dark',
                            )}>
                              {val === 0 ? '—' : formatCurrency(val)}
                            </span>
                          )}
                        </td>
                      )
                    })}
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
}

function ConsolidadoGrupo({ obras, obrasGreedy }: ConsolidadoGrupoProps) {
  const [collapsed, setCollapsed] = useState(false)

  const custoReal = Array.from({ length: 12 }, (_, i) =>
    obras.reduce((s, o) => s + o.meses[i].custo_real, 0) + (obrasGreedy?.meses[i].custo_real ?? 0)
  )
  const recReal   = Array.from({ length: 12 }, (_, i) =>
    obras.reduce((s, o) => s + o.meses[i].receita_realizada, 0) + (obrasGreedy?.meses[i].receita_realizada ?? 0)
  )
  const saldoMes  = custoReal.map((c, i) => recReal[i] - c)

  let acc = 0
  const saldoAcc = saldoMes.map((s) => { acc += s; return acc })

  const totalCustoReal = custoReal.reduce((s, v) => s + v, 0)
  const totalRecReal   = recReal.reduce((s, v) => s + v, 0)
  const saldoAnual     = totalRecReal - totalCustoReal

  type Row = { label: string; values: number[]; total: number; bold?: boolean; separator?: boolean }

  const rows: Row[] = [
    { label: 'Custo Real',        values: custoReal, total: totalCustoReal },
    { label: 'Receita Realizada', values: recReal,   total: totalRecReal },
    { label: 'Saldo do Mês',      values: saldoMes,  total: saldoMes.reduce((s, v) => s + v, 0), separator: true },
    { label: 'Saldo Acumulado',   values: saldoAcc,  total: saldoAcc[11], bold: true },
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
                {MESES.map((m) => (
                  <th key={m} className="text-right font-black uppercase tracking-widest px-2 py-2 w-20">
                    {m}
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
                    {row.values.map((val, i) => (
                      <td key={i} className="px-1 py-1">
                        {isSaldo || row.bold ? (
                          <ValueCell value={val} bold={row.bold} />
                        ) : (
                          <span className={cn(
                            'block w-full text-right tabular-nums text-xs px-1 py-0.5',
                            val === 0 ? 'text-muted-foreground/30' : 'text-dark',
                          )}>
                            {val === 0 ? '—' : formatCurrency(val)}
                          </span>
                        )}
                      </td>
                    ))}
                    <td className={cn('px-1 py-1 border-l-2 border-dark', rowBg)}>
                      {isSaldo || row.bold ? (
                        <ValueCell value={row.total} bold={row.bold} />
                      ) : (
                        <span className={cn(
                          'block w-full text-right tabular-nums text-xs px-1 py-0.5 font-bold',
                          row.total === 0 ? 'text-muted-foreground/30' : 'text-dark',
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

// ── Página principal ──────────────────────────────────────────────────────────

export default function FluxoObras() {
  useEffect(() => {
    document.title = 'Fluxo de Obras | DashFinance'
  }, [])

  const currentUser = useAuthStore((s) => s.user)

  const [ano, setAno] = useState(currentYear)
  const [view, setView] = useState<'grupos' | 'obras'>('grupos')
  const [grupoAtivoId, setGrupoAtivoId] = useState<number | null>(null)
  // 'novo' abre o modal em modo criação; GrupoObras abre em modo edição
  const [modalState, setModalState] = useState<'novo' | GrupoObras | null>(null)
  // filtros para dados reais
  const [origensAP, setOrigensAP] = useState<string[]>(['Pago'])
  const [statusRec, setStatusRec] = useState<string[]>(['Recebida'])
  const [realEnabled, setRealEnabled] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: tree } = useFilterTree()
  const { data: todasObras, isLoading: loadingObras } = useFluxoObrasTodas(ano)
  const { data: grupos = [], isLoading: loadingGrupos } = useGruposObras()
  const { data: dadosReais, isLoading: loadingReal, refetch: carregarReal } =
    useFluxoObrasReal(ano, origensAP, statusRec, realEnabled)
  const savePlanejamento = useSavePlanejamento()
  const importarPlanilha = useImportarPlanilhaObras()
  const deleteGrupo = useDeleteGrupo()

  // grupoAtivo sempre reflete o estado mais recente do servidor
  const grupoAtivo = useMemo(
    () => grupos.find((g) => g.id === grupoAtivoId) ?? null,
    [grupos, grupoAtivoId],
  )


  function calcTotaisGrupo(grupo: GrupoObras) {
    if (!todasObras) return null
    const set = new Set(grupo.obras)
    const obras = todasObras.filter((o) => set.has(o.obra_codigo))
    const custoPrev = obras.reduce((s, o) => s + o.meses.reduce((ms, m) => ms + m.custo_previsto, 0), 0)
    const recPrev = obras.reduce((s, o) => s + o.meses.reduce((ms, m) => ms + m.receita_prevista, 0), 0)
    return { custoPrev, recPrev, saldo: recPrev - custoPrev }
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
        const recPrevCalc = Array.from({ length: 12 }, (_, i) =>
          regulares.reduce((s, o) => s + o.meses[i].receita_prevista * ((pcts[o.obra_codigo] ?? 0) / 100), 0),
        )
        const recRealPct = Array.from({ length: 12 }, (_, i) =>
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

    const meses = Array.from({ length: 12 }, (_, i) => ({
      mes: i + 1,
      custo_previsto: merged.reduce((s, o) => s + o.meses[i].custo_previsto, 0),
      receita_prevista: merged.reduce((s, o) => s + o.meses[i].receita_prevista, 0),
      custo_real: merged.reduce((s, o) => s + o.meses[i].custo_real, 0),
      receita_realizada: merged.reduce((s, o) => s + o.meses[i].receita_realizada, 0),
    }))

    return {
      sintetica: {
        obra_codigo: '__DEMAIS_OBRAS__',
        ano,
        meses,
        _greedyCount: greedyObras.length,
        _greedyEmpresas: grupoAtivo.empresas_greedy,
      },
      breakdown: merged,
    }
  }, [grupoAtivo, tree, todasObras, dadosReais, ano])

  function handleAbrirGrupo(g: GrupoObras) {
    setGrupoAtivoId(g.id)
    setRealEnabled(false)
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

  const seletor_ano = (
    <select
      className="text-xs font-bold uppercase tracking-widest border-2 border-dark px-3 py-2 bg-white focus:outline-none focus:border-brand"
      value={ano}
      onChange={(e) => setAno(Number(e.target.value))}
    >
      {ANOS.map((y) => (
        <option key={y} value={y}>{y}</option>
      ))}
    </select>
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
              {seletor_ano}
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
                  onAbrir={() => handleAbrirGrupo(g)}
                  onEditar={() => setModalState(g)}
                  onExcluir={() => handleExcluirGrupo(g)}
                  deletePending={deleteGrupo.isPending}
                  canEdit={g.is_owner === true || currentUser?.is_admin === true}
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
            {(grupoAtivo?.is_owner === true || currentUser?.is_admin === true) && (
              <button
                onClick={() => grupoAtivo && setModalState(grupoAtivo)}
                className="text-xs font-black uppercase tracking-widest border-2 border-dark px-3 py-2 bg-white hover:bg-brand hover:border-brand hover:text-dark transition-colors"
              >
                Editar Grupo
              </button>
            )}
            {seletor_ano}
            <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={handleFileChange} />
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
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setRealEnabled(true); carregarReal() }}
                  disabled={loadingReal}
                  className="text-xs font-black uppercase tracking-widest bg-dark text-white px-4 py-2 hover:bg-brand hover:text-dark transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  <RefreshCw className={cn('h-3 w-3', loadingReal && 'animate-spin')} />
                  {loadingReal ? 'Carregando…' : dadosReais ? 'Atualizar Dados Reais' : 'Carregar Dados Reais'}
                </button>
                {dadosReais && !loadingReal && (
                  <span className="text-xs font-bold text-teal-600">✓ Dados reais carregados</span>
                )}
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              {obrasDoGrupo.length} obra(s) · Clique no cabeçalho de cada obra para expandir/colapsar ·
              Clique nas células de <strong>Custo Previsto</strong> ou <strong>Receita Prevista</strong> para editar
            </p>
            {obrasParaRender.map((obra) => (
              <ObraSection
                key={obra.obra_codigo}
                data={obra}
                ano={ano}
                savePending={savePlanejamento.isPending}
                onSave={(payload) => savePlanejamento.mutate(payload)}
                defaultCollapsed={obrasDoGrupo.length > 5}
                especial={obra._isEspecial && obra._recRealizadaPct
                  ? { recRealizadaPct: obra._recRealizadaPct }
                  : undefined}
              />
            ))}

            {obrasGreedy && (
              <DemaisObrasSection
                data={obrasGreedy.sintetica}
                breakdown={obrasGreedy.breakdown}
              />
            )}

            <ConsolidadoGrupo obras={obrasParaRender} obrasGreedy={obrasGreedy?.sintetica} />
          </div>
        )}

        {savePlanejamento.isError && (
          <p className="mt-3 text-xs font-bold text-red-600">
            Erro ao salvar: {savePlanejamento.error?.message}
          </p>
        )}

        {modal}
      </div>
    </div>
  )
}
