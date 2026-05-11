import logging
import asyncpg
from app.config import settings

log = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_empresas (
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    empresa VARCHAR(100) NOT NULL,
    PRIMARY KEY (user_id, empresa)
);

CREATE TABLE IF NOT EXISTS saldo_config (
    id SERIAL PRIMARY KEY,
    empresa VARCHAR(100) NOT NULL,
    banco VARCHAR(100) NOT NULL,
    conta VARCHAR(100) NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    saldo NUMERIC(15,2) DEFAULT 0,
    updated_at TIMESTAMP DEFAULT NOW(),
    updated_by INTEGER REFERENCES users(id),
    UNIQUE (empresa, banco, conta)
);

CREATE TABLE IF NOT EXISTS fluxo_planejamento (
    id               SERIAL PRIMARY KEY,
    obra_codigo      VARCHAR(200)  NOT NULL,
    ano              INTEGER       NOT NULL,
    mes              INTEGER       NOT NULL CHECK (mes BETWEEN 1 AND 12),
    custo_previsto   NUMERIC(15,2) NOT NULL DEFAULT 0,
    receita_prevista NUMERIC(15,2) NOT NULL DEFAULT 0,
    created_at       TIMESTAMP DEFAULT NOW(),
    updated_at       TIMESTAMP DEFAULT NOW(),
    UNIQUE (obra_codigo, ano, mes)
);
"""


async def init_pool():
    global _pool
    _pool = await asyncpg.create_pool(settings.PG_DSN, min_size=2, max_size=10)
    log.info("PostgreSQL pool criado")


async def close_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def init_tables():
    async with _pool.acquire() as conn:
        await conn.execute(_SCHEMA)
    log.info("Tabelas PostgreSQL verificadas/criadas")


def _pool_conn():
    return _pool.acquire()


# ── Users ─────────────────────────────────────────────────────────────────────

async def get_user_by_email(email: str) -> dict | None:
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, email, name, password_hash, is_admin, is_active FROM users WHERE email=$1",
            email,
        )
        if not row:
            return None
        user = dict(row)
        user["empresas"] = await _get_empresas(conn, user["id"])
        return user


async def get_user_by_id(user_id: int) -> dict | None:
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, email, name, password_hash, is_admin, is_active FROM users WHERE id=$1",
            user_id,
        )
        if not row:
            return None
        user = dict(row)
        user["empresas"] = await _get_empresas(conn, user_id)
        return user


async def list_users() -> list[dict]:
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, email, name, is_admin, is_active, created_at FROM users ORDER BY id"
        )
        users = []
        for row in rows:
            u = dict(row)
            u["empresas"] = await _get_empresas(conn, u["id"])
            users.append(u)
        return users


async def create_user(email: str, name: str, password_hash: str, is_admin: bool, empresas: list[str]) -> dict:
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            "INSERT INTO users (email, name, password_hash, is_admin) VALUES ($1,$2,$3,$4) RETURNING id, email, name, is_admin, is_active",
            email, name, password_hash, is_admin,
        )
        user = dict(row)
        await _set_empresas(conn, user["id"], empresas)
        user["empresas"] = empresas
        return user


async def update_user(user_id: int, fields: dict, empresas: list[str] | None) -> dict | None:
    if fields:
        set_clauses = ", ".join(f"{k}=${i+2}" for i, k in enumerate(fields))
        values = list(fields.values())
        async with _pool.acquire() as conn:
            await conn.execute(
                f"UPDATE users SET {set_clauses} WHERE id=$1",
                user_id, *values,
            )
            if empresas is not None:
                await _set_empresas(conn, user_id, empresas)
    elif empresas is not None:
        async with _pool.acquire() as conn:
            await _set_empresas(conn, user_id, empresas)

    return await get_user_by_id(user_id)


async def _get_empresas(conn, user_id: int) -> list[str]:
    rows = await conn.fetch("SELECT empresa FROM user_empresas WHERE user_id=$1 ORDER BY empresa", user_id)
    return [r["empresa"] for r in rows]


async def _set_empresas(conn, user_id: int, empresas: list[str]):
    await conn.execute("DELETE FROM user_empresas WHERE user_id=$1", user_id)
    if empresas:
        await conn.executemany(
            "INSERT INTO user_empresas (user_id, empresa) VALUES ($1, $2)",
            [(user_id, e) for e in empresas],
        )


# ── Saldo Config ──────────────────────────────────────────────────────────────

async def get_saldos(empresas: list[str] | None = None) -> list[dict]:
    async with _pool.acquire() as conn:
        if empresas:
            rows = await conn.fetch(
                "SELECT empresa, banco, conta, enabled, saldo FROM saldo_config WHERE empresa = ANY($1) ORDER BY empresa, banco, conta",
                empresas,
            )
        else:
            rows = await conn.fetch(
                "SELECT empresa, banco, conta, enabled, saldo FROM saldo_config ORDER BY empresa, banco, conta"
            )
        return [dict(r) for r in rows]


async def upsert_saldo(empresa: str, banco: str, conta: str, enabled: bool, saldo: float, updated_by: int):
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO saldo_config (empresa, banco, conta, enabled, saldo, updated_by, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6, NOW())
            ON CONFLICT (empresa, banco, conta)
            DO UPDATE SET enabled=$4, saldo=$5, updated_by=$6, updated_at=NOW()
            """,
            empresa, banco, conta, enabled, saldo, updated_by,
        )


# ── Fluxo de Caixa Gerencial de Obras ────────────────────────────────────────

async def get_planejamento(obra_codigo: str, ano: int) -> list[dict]:
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT mes, custo_previsto, receita_prevista "
            "FROM fluxo_planejamento WHERE obra_codigo=$1 AND ano=$2 ORDER BY mes",
            obra_codigo, ano,
        )
    by_mes = {r["mes"]: dict(r) for r in rows}
    return [
        by_mes.get(m, {"mes": m, "custo_previsto": 0, "receita_prevista": 0})
        for m in range(1, 13)
    ]


async def upsert_planejamento(
    obra_codigo: str, ano: int, mes: int,
    custo_previsto: float, receita_prevista: float,
) -> None:
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO fluxo_planejamento
                (obra_codigo, ano, mes, custo_previsto, receita_prevista, updated_at)
            VALUES ($1,$2,$3,$4,$5,NOW())
            ON CONFLICT (obra_codigo, ano, mes) DO UPDATE
                SET custo_previsto=$4, receita_prevista=$5, updated_at=NOW()
            """,
            obra_codigo, ano, mes, custo_previsto, receita_prevista,
        )


async def get_planejamento_bulk(obras: list[str], ano: int) -> dict[str, list[dict]]:
    """Retorna {obra_codigo: [12 dicts]} para todas as obras em uma única query."""
    if not obras:
        return {}
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT obra_codigo, mes, custo_previsto, receita_prevista "
            "FROM fluxo_planejamento WHERE obra_codigo = ANY($1) AND ano = $2",
            obras, ano,
        )
    by_obra: dict[str, dict[int, dict]] = {}
    for r in rows:
        by_obra.setdefault(r["obra_codigo"], {})[r["mes"]] = dict(r)
    return {
        obra: [
            by_obra.get(obra, {}).get(m, {"mes": m, "custo_previsto": 0, "receita_prevista": 0})
            for m in range(1, 13)
        ]
        for obra in obras
    }


async def bulk_upsert_planejamento(items: list[dict]) -> int:
    if not items:
        return 0
    async with _pool.acquire() as conn:
        await conn.executemany(
            """
            INSERT INTO fluxo_planejamento
                (obra_codigo, ano, mes, custo_previsto, receita_prevista, updated_at)
            VALUES ($1,$2,$3,$4,$5,NOW())
            ON CONFLICT (obra_codigo, ano, mes) DO UPDATE
                SET custo_previsto=$4, receita_prevista=$5, updated_at=NOW()
            """,
            [
                (r["obra_codigo"], r["ano"], r["mes"],
                 r["custo_previsto"], r["receita_prevista"])
                for r in items
            ],
        )
    return len(items)
