import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import type {
  APRecord, ReceitaRecord, SaldoRecord, SyncResponse, StatusResponse, FilterTree, SaldoConfig,
  FluxoPlanejamentoResponse, UpsertPlanejamentoIn, BulkImportResult,
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

export function useFluxoObras(obraCodigo: string | null, ano: number) {
  return useQuery<FluxoPlanejamentoResponse>({
    queryKey: ['fluxo-obras', obraCodigo, ano],
    queryFn: () => api.get('/fluxo-obras/planejamento', { obra_codigo: obraCodigo!, ano }),
    enabled: !!obraCodigo,
    staleTime: 1000 * 60 * 5,
  })
}

export function useSavePlanejamento() {
  const queryClient = useQueryClient()
  return useMutation<null, Error, UpsertPlanejamentoIn>({
    mutationFn: (body) => api.post('/fluxo-obras/planejamento', body),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({
        queryKey: ['fluxo-obras', variables.obra_codigo, variables.ano],
      }),
  })
}

export function useImportarPlanilhaObras() {
  const queryClient = useQueryClient()
  return useMutation<BulkImportResult, Error, File>({
    mutationFn: async (file) => {
      const { useAuthStore } = await import('@/hooks/useAuth')
      const token = useAuthStore.getState().token
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || '/api'}/fluxo-obras/planejamento/importar`,
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
