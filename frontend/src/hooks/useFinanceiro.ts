import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { APRecord, ReceitaRecord, SaldoRecord, SyncResponse, StatusResponse, FilterTree, SaldoConfig } from '@/types'

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
