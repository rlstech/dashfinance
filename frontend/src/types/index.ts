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

export interface GrupoShareItem {
  user_id: number
  permission: 'view' | 'edit'
}

export interface GrupoObras {
  id: number
  nome: string
  descricao?: string
  obras: string[]
  percentuais: Record<string, number>
  obra_especial?: string | null
  created_by?: number
  is_owner?: boolean
  can_edit?: boolean
  shared_with?: GrupoShareItem[]
  empresas_greedy?: string[]
  periodo_padrao?: { ano_inicio: number; mes_inicio: number; ano_fim: number; mes_fim: number } | null
  incluir_custo_financeiro?: boolean
  custo_financeiro_empresas?: string[]
  custo_financeiro_contas?: LancamentoConta[]
}

export interface UserBasic {
  id: number
  name: string
}

// ── Fluxo de Caixa Gerencial de Obras ────────────────────────────────────────

export interface Periodo {
  anoInicio: number
  mesInicio: number
  anoFim: number
  mesFim: number
}

export interface FluxoMesRow {
  mes: number
  ano: number
  custo_previsto: number
  receita_prevista: number
  custo_real: number
  receita_realizada: number
}

export interface FluxoPlanejamentoResponse {
  obra_codigo: string
  ano: number
  meses: FluxoMesRow[]
  custo_global: number
  receita_global: number
}

export interface UpsertPlanejamentoIn {
  obra_codigo: string
  ano: number
  mes: number
  custo_previsto: number
  receita_prevista: number
}

export interface SaveObraPlanejamentoIn {
  custo_global: number
  receita_global: number
  meses: FluxoMesRow[]
}

export interface PlanejamentoLogEntry {
  ano: number
  mes: number
  campo: 'custo_previsto' | 'receita_prevista'
  valor_anterior: number
  valor_novo: number
  changed_at: string
  changed_by_name: string | null
}

export interface GrupoTotaisPrevistos {
  custo_prev: number
  receita_prev: number
}

export interface BulkImportResult {
  imported: number
  errors: string[]
}

export interface FluxoRealMes {
  mes: number
  ano: number
  custo_real: number
  receita_realizada: number
}

export interface FluxoRealResponse {
  obra_codigo: string
  ano: number
  meses: FluxoRealMes[]
}

export interface FluxoRealCacheMeta {
  updated_at: string
  updated_by: number | null
  updated_by_name: string | null
  origens: string[]
  status_rec: string[]
  anos_cobertos: number[]
}

export interface FluxoRealCachedResponse {
  data: FluxoRealResponse[]
  meta: FluxoRealCacheMeta | null
}

export interface GrupoTotaisReais {
  custo_real: number
  receita_realizada: number
  updated_at: string
  origens: string[]
  status_rec: string[]
}

// ── Custo Financeiro (Tesouraria) ────────────────────────────────────────────

export interface CustoFinanceiroSlot {
  ano: number
  mes: number
}

export interface CategoriaDescricaoItem {
  tipo: 'transferencia' | 'controle'
  descricao: string
}

export interface CustoFinanceiroCategoria {
  id: number
  nome: string
  sinal: 'entrada' | 'saida'
  ordem: number
  descricoes: CategoriaDescricaoItem[]
  contas: LancamentoConta[]
}

export interface CustoFinanceiroCategoriaLinha {
  categoria_id: number | null
  nome: string
  sinal: 'entrada' | 'saida' | null
  valores: number[]
  total: number
}

export interface CustoFinanceiroResponse {
  meses: CustoFinanceiroSlot[]
  categorias: CustoFinanceiroCategoriaLinha[]
  total_entradas: number
  total_saidas: number
  fluxo_liquido: number
}

export interface LancamentoConta {
  empresa: string
  banco: string
  conta: string
}

export interface LancamentoDetalhe {
  id: string
  tipo: 'transferencia' | 'controle'
  data: string
  descricao: string
  valor: number
  sentido: 'entrada' | 'saida'
  origem: LancamentoConta | null
  destino: LancamentoConta | null
  banco: string
  conta: string
  categoria_id: number | null
}

export interface DescricaoDisponivel {
  tipo: 'transferencia' | 'controle'
  descricao: string
  categoria_id: number | null
  sentido: 'entrada' | 'saida' | 'mista'
}

export interface ContaDisponivel {
  empresa: string
  banco: string
  conta: string
  categoria_id: number | null
  sentido: 'entrada' | 'saida' | 'mista'
}
