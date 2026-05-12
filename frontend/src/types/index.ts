export interface APRecord {
  empresa: string
  obra: string
  data: string
  fornecedor: string
  banco: string
  conta: string
  categoria: string
  valor: number
  origem: string
}

export interface ReceitaRecord {
  empresa: string
  obra: string
  cliente: string
  tipo: string
  data: string
  data_venc: string
  valor: number
  status: string
  banco: string
  conta: string
}

export interface SaldoRecord {
  empresa: string
  banco: string
  conta: string
  data: string
  saldo: number
}

export interface SyncResponse {
  ok: boolean
  errors: string[]
  last_sync: string | null
  count_ap: number
  count_receitas: number
  count_saldo: number
}

export interface StatusResponse {
  last_sync: string | null
  de: string | null
  ate: string | null
  count_ap: number
  count_receitas: number
  count_saldo: number
}

export interface FilterTree {
  empresas: string[]
  obras_por_empresa: Record<string, string[]>
  bancos_por_empresa: Record<string, string[]>
  contas_por_empresa: Record<string, string[]>
  contas_por_empresa_banco?: Record<string, Record<string, string[]>>
}

export const EMPRESA_COLORS: Record<string, string> = {
  COMBRASEN: '#F25B2A',
  DRESDEN: '#005662',
  TRUST: '#00838F',
  'GAMA 01': '#4A148C',
  'CONSÓRCIO HMSJ': '#00796B',
}

export const EMPRESA_ABBR: Record<string, string> = {
  COMBRASEN: 'CMB',
  DRESDEN: 'DRE',
  TRUST: 'TRS',
  'GAMA 01': 'GAM',
  'CONSÓRCIO HMSJ': 'HMJ',
}

export interface User {
  id: number
  email: string
  name: string
  is_admin: boolean
  is_active: boolean
  empresas: string[]
}

export interface LoginResponse {
  access_token: string
  token_type: string
  user: User
}

export interface SaldoConfig {
  empresa: string
  banco: string
  conta: string
  enabled: boolean
  saldo: number
}

export const TIPO_LABEL: Record<string, string> = {
  M: 'Mensal',
  P: 'Entrada',
  I: 'Intermediária',
  F: 'Financiamento',
  S: 'Sinal',
  R: 'Reforço',
  C: 'Chaves',
}

// ── Grupos de Obras ───────────────────────────────────────────────────────────

export interface GrupoObras {
  id: number
  nome: string
  descricao?: string
  obras: string[]
}

// ── Fluxo de Caixa Gerencial de Obras ────────────────────────────────────────

export interface FluxoMesRow {
  mes: number
  custo_previsto: number
  receita_prevista: number
  custo_real: number
  receita_realizada: number
}

export interface FluxoPlanejamentoResponse {
  obra_codigo: string
  ano: number
  meses: FluxoMesRow[]
}

export interface UpsertPlanejamentoIn {
  obra_codigo: string
  ano: number
  mes: number
  custo_previsto: number
  receita_prevista: number
}

export interface BulkImportResult {
  imported: number
  errors: string[]
}
