import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface FilterState {
  empresas: string[]
  obras: string[]
  dtInicio: string
  dtFim: string
  bancos: string[]
  contas: string[]
  // AP-specific
  origens: string[]
  // Receitas-specific
  status_list: string[]
  // Fluxo-specific
  vis: string[]

  setFilter: (key: string, value: string | string[]) => void
  setEmpresas: (empresas: string[]) => void
  setObras: (obras: string[]) => void
  setBancos: (bancos: string[]) => void
  setContas: (contas: string[]) => void
  setOrigens: (origens: string[]) => void
  setStatusList: (status_list: string[]) => void
  setVis: (vis: string[]) => void
  resetFilters: () => void
}

const currentYear = new Date().getFullYear()

const defaultState = {
  empresas: [] as string[],
  obras: [] as string[],
  dtInicio: `${currentYear}-01-01`,
  dtFim: `${currentYear}-12-31`,
  bancos: [] as string[],
  contas: [] as string[],
  origens: [] as string[],
  status_list: [] as string[],
  vis: ['todos'] as string[],
}

export const useFilterStore = create<FilterState>()(
  persist(
    (set) => ({
      ...defaultState,

      setFilter: (key, value) => set((state) => ({ ...state, [key]: value })),

      setEmpresas: (empresas) => set({ empresas, obras: [], bancos: [], contas: [] }),
      setObras: (obras) => set({ obras }),
      setBancos: (bancos) => set({ bancos, contas: [] }),
      setContas: (contas) => set({ contas }),
      setOrigens: (origens) => set({ origens }),
      setStatusList: (status_list) => set({ status_list }),
      setVis: (vis) => set({ vis }),

      resetFilters: () => set(defaultState),
    }),
    { name: 'dashfinance-filters-v2' }
  )
)
