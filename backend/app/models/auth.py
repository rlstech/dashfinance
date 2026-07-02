from typing import Literal

from pydantic import BaseModel


class LoginRequest(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    is_admin: bool
    is_active: bool
    empresas: list[str]


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserCreate(BaseModel):
    email: str
    name: str
    password: str
    is_admin: bool = False
    empresas: list[str] = []


class UserUpdate(BaseModel):
    name: str | None = None
    password: str | None = None
    is_admin: bool | None = None
    is_active: bool | None = None
    empresas: list[str] | None = None


class SaldoConfigIn(BaseModel):
    empresa: str
    banco: str
    conta: str
    enabled: bool = True
    saldo: float = 0.0


class SaldoConfigOut(BaseModel):
    empresa: str
    banco: str
    conta: str
    enabled: bool
    saldo: float


class GrupoShareItem(BaseModel):
    user_id: int
    permission: Literal["view", "edit"] = "view"


class ContaItem(BaseModel):
    empresa: str
    banco: str
    conta: str


class GrupoObrasIn(BaseModel):
    nome: str
    descricao: str | None = None
    obras: list[str] = []
    percentuais: dict[str, float] = {}
    obra_especial: str | None = None
    shared_with: list[GrupoShareItem] = []
    empresas_greedy: list[str] = []
    incluir_custo_financeiro: bool = False
    custo_financeiro_empresas: list[str] = []
    custo_financeiro_contas: list[ContaItem] = []


class PeriodoPadrao(BaseModel):
    ano_inicio: int
    mes_inicio: int
    ano_fim: int
    mes_fim: int


class GrupoObrasOut(BaseModel):
    id: int
    nome: str
    descricao: str | None = None
    obras: list[str]
    percentuais: dict[str, float] = {}
    obra_especial: str | None = None
    created_by: int | None = None
    is_owner: bool = False
    can_edit: bool = False
    shared_with: list[GrupoShareItem] = []
    empresas_greedy: list[str] = []
    periodo_padrao: PeriodoPadrao | None = None
    incluir_custo_financeiro: bool = False
    custo_financeiro_empresas: list[str] = []
    custo_financeiro_contas: list[ContaItem] = []


class UserBasic(BaseModel):
    id: int
    name: str
