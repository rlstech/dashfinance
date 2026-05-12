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


class GrupoObrasIn(BaseModel):
    nome: str
    descricao: str | None = None
    obras: list[str] = []


class GrupoObrasOut(BaseModel):
    id: int
    nome: str
    descricao: str | None = None
    obras: list[str]
