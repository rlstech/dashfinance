import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import type {
  APRecord, ReceitaRecord, SaldoRecord, SyncResponse, StatusResponse, FilterTree, SaldoConfig,
  FluxoPlanejamentoResponse, SaveObraPlanejamentoIn, PlanejamentoLogEntry, BulkImportResult, GrupoObras,
  FluxoRealCachedResponse, GrupoTotaisReais, GrupoTotaisPrevistos, Periodo,
  UserBasic, CustoFinanceiroResponse, CustoFinanceiroCategoria, DescricaoDisponivel, LancamentoDetalhe,
} from '@/types'

export function useAP() {
  return useQuery<APRecord[]>({
    queryKey: ['ap'],
    queryFn: () => api.get('/ap'),
    staleTime: 1000 * 60 * 5,
  })
}

export function useReceitas() {
  return useQuery<ReceitaRecord[]>({
    queryKey: ['receitas'],
    queryFn: () => api.get('/receitas'),
    staleTime: 1000 * 60 * 5,
  })
}

export function useSaldoBanco() {
  return useQuery<SaldoRecord[]>({
    queryKey: ['saldo_banco'],
    queryFn: () => api.get('/saldo_banco'),
    staleTime: 1000 * 60 * 5,
  })
}

export function useStatus() {
  return useQuery<StatusResponse>({
    queryKey: ['status'],
    queryFn: () => api.get('/status'),
    refetchInterval: 1000 * 60,
  })
}

export function useFilterTree() {
  return useQuery<FilterTree>({
    queryKey: ['filter-tree'],
    queryFn: () => api.get('/filters/tree'),
    staleTime: 1000 * 60 * 30,
  })
}

export function useSync() {
  const queryClient = useQueryClient()
  return useMutation<SyncResponse>({
    mutationFn: () => api.get('/sync'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ap'] })
      queryClient.invalidateQueries({ queryKey: ['receitas'] })
      queryClient.invalidateQueries({ queryKey: ['saldo_banco'] })
      queryClient.invalidateQueries({ queryKey: ['status'] })
      queryClient.invalidateQueries({ queryKey: ['filter-tree'] })
    },
  })
}

export function useSaldoConfig() {
  return useQuery<SaldoConfig[]>({
    queryKey: ['saldo-config'],
    queryFn: () => api.get('/config/saldos'),
    staleTime: 1000 * 60 * 5,
  })
}

export function useSaveSaldos() {
  const queryClient = useQueryClient()
  return useMutation<null, Error, SaldoConfig[]>({
    mutationFn: (items) => api.put('/config/saldos', items),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['saldo-config'] }),
  })
}

// ── Fluxo de Caixa Gerencial de Obras ────────────────────────────────────────

export function useFluxoObrasTodas(grupoId: number | null, periodo: Periodo) {
  return useQuery<FluxoPlanejamentoResponse[]>({
    queryKey: ['fluxo-obras-todas', grupoId, periodo],
    enabled: grupoId !== null,
    queryFn: () => api.get('/fluxo-obras/todas', {
      grupo_id: grupoId,
      ano_inicio: periodo.anoInicio,
      mes_inicio: periodo.mesInicio,
      ano_fim: periodo.anoFim,
      mes_fim: periodo.mesFim,
    }),
    staleTime: 1000 * 60 * 5,
  })
}

export function useGruposTotaisPrevistos(periodo: Periodo) {
  return useQuery<Record<string, GrupoTotaisPrevistos>>({
    queryKey: ['grupos-totais-previstos', periodo],
    queryFn: () => api.get('/fluxo-obras/grupos-totais-previstos', {
      ano_inicio: periodo.anoInicio,
      mes_inicio: periodo.mesInicio,
      ano_fim: periodo.anoFim,
      mes_fim: periodo.mesFim,
    }),
    staleTime: 1000 * 60 * 5,
  })
}

interface SaveObraArgs {
  grupoId: number
  obraCodigo: string
  body: SaveObraPlanejamentoIn
}

export function useSaveObraPlanejamento() {
  const queryClient = useQueryClient()
  return useMutation<null, Error, SaveObraArgs>({
    mutationFn: ({ grupoId, obraCodigo, body }) =>
      api.post(`/fluxo-obras/grupo/${grupoId}/obra/${encodeURIComponent(obraCodigo)}/planejamento`, body),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['fluxo-obras-todas'] })
      queryClient.invalidateQueries({ queryKey: ['grupos-totais-previstos'] })
      queryClient.invalidateQueries({
        queryKey: ['obra-logs', variables.grupoId, variables.obraCodigo],
      })
    },
  })
}

export function useObraLogs(grupoId: number | null, obraCodigo: string | null) {
  return useQuery<PlanejamentoLogEntry[]>({
    queryKey: ['obra-logs', grupoId, obraCodigo],
    enabled: grupoId !== null && !!obraCodigo,
    queryFn: () => api.get(`/fluxo-obras/grupo/${grupoId}/obra/${encodeURIComponent(obraCodigo!)}/logs`),
    staleTime: 1000 * 30,
  })
}

export function useUsers() {
  return useQuery<UserBasic[]>({
    queryKey: ['users-basic'],
    queryFn: () => api.get('/grupos-obras/users'),
    staleTime: 1000 * 60 * 10,
  })
}

export function useGruposObras() {
  return useQuery<GrupoObras[]>({
    queryKey: ['grupos-obras'],
    queryFn: () => api.get('/grupos-obras'),
    staleTime: 1000 * 60 * 5,
  })
}

export function useCreateGrupo() {
  const queryClient = useQueryClient()
  return useMutation<GrupoObras | null, Error, Omit<GrupoObras, 'id'>>({
    mutationFn: (body) => api.post('/grupos-obras', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['grupos-obras'] }),
  })
}

export function useUpdateGrupo() {
  const queryClient = useQueryClient()
  return useMutation<GrupoObras | null, Error, GrupoObras>({
    mutationFn: ({ id, ...body }) => api.put(`/grupos-obras/${id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['grupos-obras'] }),
  })
}

export function useDeleteGrupo() {
  const queryClient = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: (id) => api.delete(`/grupos-obras/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['grupos-obras'] }),
  })
}

interface SavePeriodoArgs {
  grupoId: number
  periodo: Periodo
}

export function useSavePeriodoGrupo() {
  const queryClient = useQueryClient()
  return useMutation<null, Error, SavePeriodoArgs>({
    mutationFn: ({ grupoId, periodo }) =>
      api.put(`/grupos-obras/${grupoId}/periodo`, {
        ano_inicio: periodo.anoInicio,
        mes_inicio: periodo.mesInicio,
        ano_fim: periodo.anoFim,
        mes_fim: periodo.mesFim,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['grupos-obras'] }),
  })
}

export function useFluxoRealCache(grupoId: number | null, periodo: Periodo) {
  return useQuery<FluxoRealCachedResponse>({
    queryKey: ['fluxo-real-cache', grupoId, periodo],
    enabled: grupoId !== null,
    staleTime: 1000 * 60 * 5,
    queryFn: () => api.get(`/fluxo-obras/grupo/${grupoId}/real`, {
      ano_inicio: periodo.anoInicio,
      mes_inicio: periodo.mesInicio,
      ano_fim: periodo.anoFim,
      mes_fim: periodo.mesFim,
    }),
  })
}

interface AtualizarFluxoRealArgs {
  grupoId: number
  periodo: Periodo
  origens: string[]
  statusRec: string[]
}

export function useAtualizarFluxoReal() {
  const queryClient = useQueryClient()
  return useMutation<FluxoRealCachedResponse | null, Error, AtualizarFluxoRealArgs>({
    mutationFn: ({ grupoId, periodo, origens, statusRec }) =>
      api.post(
        `/fluxo-obras/grupo/${grupoId}/real?ano_inicio=${periodo.anoInicio}&mes_inicio=${periodo.mesInicio}&ano_fim=${periodo.anoFim}&mes_fim=${periodo.mesFim}`,
        { origens, status_rec: statusRec },
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['fluxo-real-cache', variables.grupoId, variables.periodo] })
      queryClient.invalidateQueries({ queryKey: ['grupos-totais-reais', variables.periodo.anoInicio] })
    },
  })
}

export function useGruposTotaisReais(ano: number) {
  return useQuery<Record<string, GrupoTotaisReais>>({
    queryKey: ['grupos-totais-reais', ano],
    queryFn: () => api.get('/fluxo-obras/grupos-totais-reais', { ano }),
    staleTime: 1000 * 60 * 5,
  })
}

export function useCustoFinanceiro(periodo: Periodo, grupoId: number | null, enabled: boolean) {
  return useQuery<CustoFinanceiroResponse>({
    queryKey: ['custo-financeiro', periodo, grupoId],
    enabled: enabled && grupoId !== null,
    staleTime: 1000 * 60 * 5,
    queryFn: () => api.get('/fluxo-obras/custo-financeiro', {
      grupo_id: grupoId,
      ano_inicio: periodo.anoInicio,
      mes_inicio: periodo.mesInicio,
      ano_fim: periodo.anoFim,
      mes_fim: periodo.mesFim,
    }),
  })
}

export function useCustoFinanceiroCategorias() {
  return useQuery<CustoFinanceiroCategoria[]>({
    queryKey: ['custo-financeiro-categorias'],
    queryFn: () => api.get('/fluxo-obras/custo-financeiro/categorias'),
    staleTime: 1000 * 60 * 5,
  })
}

function invalidateCustoFinanceiro(queryClient: ReturnType<typeof useQueryClient>) {
  // refetchType: 'all' força a atualização mesmo se o card ainda não tiver sido observado como "ativo"
  // no exato instante da invalidação (ex.: reabertura rápida do modal de grupo).
  queryClient.invalidateQueries({ queryKey: ['custo-financeiro-categorias'], refetchType: 'all' })
  queryClient.invalidateQueries({ queryKey: ['custo-financeiro'], refetchType: 'all' })
  queryClient.invalidateQueries({ queryKey: ['custo-financeiro-descricoes'], refetchType: 'all' })
  queryClient.invalidateQueries({ queryKey: ['custo-financeiro-lancamentos'], refetchType: 'all' })
}

export function useCreateCustoFinanceiroCategoria() {
  const queryClient = useQueryClient()
  return useMutation<CustoFinanceiroCategoria | null, Error, Omit<CustoFinanceiroCategoria, 'id'>>({
    mutationFn: (body) => api.post('/fluxo-obras/custo-financeiro/categorias', body),
    onSuccess: () => invalidateCustoFinanceiro(queryClient),
  })
}

export function useUpdateCustoFinanceiroCategoria() {
  const queryClient = useQueryClient()
  return useMutation<CustoFinanceiroCategoria | null, Error, CustoFinanceiroCategoria>({
    mutationFn: ({ id, ...body }) => api.put(`/fluxo-obras/custo-financeiro/categorias/${id}`, body),
    onSuccess: () => invalidateCustoFinanceiro(queryClient),
  })
}

export function useDeleteCustoFinanceiroCategoria() {
  const queryClient = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: (id) => api.delete(`/fluxo-obras/custo-financeiro/categorias/${id}`),
    onSuccess: () => invalidateCustoFinanceiro(queryClient),
  })
}

export function useCustoFinanceiroDescricoes(enabled: boolean) {
  return useQuery<DescricaoDisponivel[]>({
    queryKey: ['custo-financeiro-descricoes'],
    enabled,
    queryFn: () => api.get('/fluxo-obras/custo-financeiro/descricoes'),
  })
}

export function useCustoFinanceiroLancamentos(
  grupoId: number | null, categoriaId: number | null, periodo: Periodo, enabled: boolean,
) {
  return useQuery<LancamentoDetalhe[]>({
    queryKey: ['custo-financeiro-lancamentos', grupoId, categoriaId, periodo],
    enabled: enabled && grupoId !== null && categoriaId !== null,
    queryFn: () => api.get('/fluxo-obras/custo-financeiro/lancamentos', {
      grupo_id: grupoId,
      categoria_id: categoriaId,
      ano_inicio: periodo.anoInicio,
      mes_inicio: periodo.mesInicio,
      ano_fim: periodo.anoFim,
      mes_fim: periodo.mesFim,
    }),
  })
}

export function useSetLancamentoCategoria() {
  const queryClient = useQueryClient()
  return useMutation<void, Error, { lancamentoId: string; categoriaId: number | null }>({
    mutationFn: async ({ lancamentoId, categoriaId }) => {
      await api.post(`/fluxo-obras/custo-financeiro/lancamentos/${lancamentoId}/categoria`, { categoria_id: categoriaId })
    },
    onSuccess: () => invalidateCustoFinanceiro(queryClient),
  })
}

export function useImportarPlanilhaObras() {
  const queryClient = useQueryClient()
  return useMutation<BulkImportResult, Error, { file: File; grupoId: number }>({
    mutationFn: async ({ file, grupoId }) => {
      const { useAuthStore } = await import('@/hooks/useAuth')
      const token = useAuthStore.getState().token
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || '/api'}/fluxo-obras/planejamento/importar?grupo_id=${grupoId}`,
        {
          method: 'POST',
          // Content-Type omitido intencionalmente — browser define o boundary do multipart
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
        },
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail ?? `Erro ${res.status}`)
      }
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['fluxo-obras'] }),
  })
}
