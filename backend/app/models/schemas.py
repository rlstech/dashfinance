from datetime import datetime

from pydantic import BaseModel


class APRecord(BaseModel):
    empresa: str = ""
    obra: str = ""
    data: str = ""
    fornecedor: str = ""
    banco: str = ""
    conta: str = ""
    categoria: str = ""
    valor: float = 0.0
    origem: str = ""


class ReceitaRecord(BaseModel):
    empresa: str = ""
    obra: str = ""
    cliente: str = ""
    tipo: str = ""
    data: str = ""
    data_venc: str = ""
    valor: float = 0.0
    status: str = ""
    banco: str = ""
    conta: str = ""


class SaldoRecord(BaseModel):
    empresa: str = ""
    banco: str = ""
    conta: str = ""
    data: str = ""
    saldo: float = 0.0


class SyncResponse(BaseModel):
    ok: bool
    errors: list[str] = []
    last_sync: str | None = None
    count_ap: int = 0
    count_receitas: int = 0
    count_saldo: int = 0


class StatusResponse(BaseModel):
    last_sync: str | None = None
    de: str | None = None
    ate: str | None = None
    count_ap: int = 0
    count_receitas: int = 0
    count_saldo: int = 0


class FilterTree(BaseModel):
    empresas: list[str] = []
    obras_por_empresa: dict[str, list[str]] = {}
    bancos_por_empresa: dict[str, list[str]] = {}
    contas_por_empresa: dict[str, list[str]] = {}
    contas_por_empresa_banco: dict[str, dict[str, list[str]]] = {}


# ── Fluxo de Caixa Gerencial de Obras ────────────────────────────────────────

class FluxoMesRow(BaseModel):
    mes: int
    ano: int = 0
    custo_previsto: float = 0.0
    receita_prevista: float = 0.0
    custo_real: float = 0.0         # TODO: query UAU
    receita_realizada: float = 0.0  # TODO: query UAU


class FluxoPlanejamentoResponse(BaseModel):
    obra_codigo: str
    ano: int
    meses: list[FluxoMesRow]
    custo_global: float = 0.0
    receita_global: float = 0.0


class UpsertPlanejamentoIn(BaseModel):
    obra_codigo: str
    ano: int
    mes: int
    custo_previsto: float = 0.0
    receita_prevista: float = 0.0


class SaveObraPlanejamentoIn(BaseModel):
    custo_global: float = 0.0
    receita_global: float = 0.0
    meses: list[FluxoMesRow] = []


class PlanejamentoLogEntry(BaseModel):
    ano: int
    mes: int
    campo: str
    valor_anterior: float = 0.0
    valor_novo: float = 0.0
    changed_at: datetime
    changed_by_name: str | None = None


class GrupoTotaisPrevistos(BaseModel):
    custo_prev: float = 0.0
    receita_prev: float = 0.0


class BulkImportResult(BaseModel):
    imported: int
    errors: list[str] = []


class FluxoRealMes(BaseModel):
    mes: int
    ano: int = 0
    custo_real: float = 0.0
    receita_realizada: float = 0.0


class FluxoRealResponse(BaseModel):
    obra_codigo: str
    ano: int
    meses: list[FluxoRealMes]


# ── Cache persistido de Dados Reais ──────────────────────────────────────────

class FluxoRealCacheMeta(BaseModel):
    updated_at: datetime
    updated_by: int | None = None
    updated_by_name: str | None = None
    origens: list[str] = []
    status_rec: list[str] = []
    anos_cobertos: list[int] = []


class FluxoRealCachedResponse(BaseModel):
    data: list[FluxoRealResponse]
    meta: FluxoRealCacheMeta | None = None


class GrupoTotaisReais(BaseModel):
    custo_real: float
    receita_realizada: float
    updated_at: datetime
    origens: list[str] = []
    status_rec: list[str] = []


class AtualizarFluxoRealIn(BaseModel):
    origens: list[str] = ["Pago"]
    status_rec: list[str] = ["Recebida"]


# ── Custo Financeiro (Tesouraria) ────────────────────────────────────────────

class CustoFinanceiroSlot(BaseModel):
    ano: int
    mes: int


class CategoriaDescricaoItem(BaseModel):
    tipo: str  # 'transferencia' | 'controle'
    descricao: str


class LancamentoConta(BaseModel):
    empresa: str
    banco: str
    conta: str


class CustoFinanceiroCategoria(BaseModel):
    id: int
    nome: str
    sinal: str  # 'entrada' | 'saida' — apenas rótulo/organização, não força o sinal do valor
    ordem: int = 0
    descricoes: list[CategoriaDescricaoItem] = []
    contas: list[LancamentoConta] = []  # regra por conta (só se aplica a tipo='transferencia')


class CustoFinanceiroCategoriaIn(BaseModel):
    nome: str
    sinal: str = "saida"
    ordem: int = 0
    descricoes: list[CategoriaDescricaoItem] = []
    contas: list[LancamentoConta] = []


class CustoFinanceiroCategoriaLinha(BaseModel):
    categoria_id: int | None  # None = "Não Classificado"
    nome: str
    sinal: str | None
    valores: list[float]  # alinhado a meses; net = entrada - saida
    total: float


class CustoFinanceiroResponse(BaseModel):
    meses: list[CustoFinanceiroSlot]
    categorias: list[CustoFinanceiroCategoriaLinha]
    total_entradas: float
    total_saidas: float
    fluxo_liquido: float


class LancamentoDetalhe(BaseModel):
    id: str
    tipo: str  # 'transferencia' | 'controle'
    data: str
    descricao: str
    valor: float  # valor absoluto do lançamento
    sentido: str  # 'entrada' | 'saida'
    origem: LancamentoConta | None = None
    destino: LancamentoConta | None = None
    banco: str
    conta: str
    categoria_id: int | None = None


class SetLancamentoCategoriaIn(BaseModel):
    categoria_id: int | None = None


class RegraParTransferenciaIn(BaseModel):
    empresa_origem: str
    empresa_destino: str
    banco: str
    conta: str
    rotulo: str | None = None
    anular: bool = False
    categoria_positiva_id: int | None = None
    categoria_negativa_id: int | None = None


class RegraParTransferencia(RegraParTransferenciaIn):
    id: int
