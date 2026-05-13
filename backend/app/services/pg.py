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

CREATE TABLE IF NOT EXISTS grupos_obras (
    id         SERIAL PRIMARY KEY,
    nome       VARCHAR(255) NOT NULL UNIQUE,
    descricao  TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    updated_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS grupo_obra_items (
    grupo_id    INTEGER REFERENCES grupos_obras(id) ON DELETE CASCADE,
    obra_codigo VARCHAR(200) NOT NULL,
    PRIMARY KEY (grupo_id, obra_codigo)
);

ALTER TABLE grupos_obras    ADD COLUMN IF NOT EXISTS obra_especial VARCHAR(200);
ALTER TABLE grupo_obra_items ADD COLUMN IF NOT EXISTS percentual   NUMERIC(5,2) DEFAULT 0;
ALTER TABLE grupos_obras    ADD COLUMN IF NOT EXISTS created_by   INTEGER REFERENCES users(id);

CREATE TABLE IF NOT EXISTS grupo_shares (
    grupo_id INTEGER REFERENCES grupos_obras(id) ON DELETE CASCADE,
    user_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (grupo_id, user_id)
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


# ── Grupos de Obras ───────────────────────────────────────────────────────────

async def get_grupos(user_id: int, is_admin: bool) -> list[dict]:
    async with _pool.acquire() as conn:
        if is_admin:
            grupos = await conn.fetch(
                "SELECT id, nome, descricao, obra_especial, created_by FROM grupos_obras ORDER BY nome"
            )
        else:
            grupos = await conn.fetch(
                """SELECT g.id, g.nome, g.descricao, g.obra_especial, g.created_by
                   FROM grupos_obras g
                   WHERE g.created_by = $1
                      OR EXISTS (
                          SELECT 1 FROM grupo_shares gs
                          WHERE gs.grupo_id = g.id AND gs.user_id = $1
                      )
                   ORDER BY g.nome""",
                user_id,
            )

        if not grupos:
            return []

        grupo_ids = [g["id"] for g in grupos]
        items = await conn.fetch(
            "SELECT grupo_id, obra_codigo, percentual FROM grupo_obra_items WHERE grupo_id = ANY($1) ORDER BY obra_codigo",
            grupo_ids,
        )
        shares = await conn.fetch(
            "SELECT grupo_id, user_id FROM grupo_shares WHERE grupo_id = ANY($1)",
            grupo_ids,
        )

    obras_map: dict[int, list[str]] = {}
    pct_map: dict[int, dict[str, float]] = {}
    for item in items:
        obras_map.setdefault(item["grupo_id"], []).append(item["obra_codigo"])
        pct_map.setdefault(item["grupo_id"], {})[item["obra_codigo"]] = float(item["percentual"] or 0)

    shares_map: dict[int, list[int]] = {}
    for share in shares:
        shares_map.setdefault(share["grupo_id"], []).append(share["user_id"])

    return [
        {
            "id": g["id"], "nome": g["nome"], "descricao": g["descricao"],
            "obras": obras_map.get(g["id"], []),
            "obra_especial": g["obra_especial"],
            "percentuais": pct_map.get(g["id"], {}),
            "created_by": g["created_by"],
            "shared_with": shares_map.get(g["id"], []),
        }
        for g in grupos
    ]


async def get_grupo_created_by(grupo_id: int) -> int | None:
    async with _pool.acquire() as conn:
        row = await conn.fetchrow("SELECT created_by FROM grupos_obras WHERE id=$1", grupo_id)
    return row["created_by"] if row else None


async def create_grupo(
    nome: str, descricao: str | None, obras: list[str],
    percentuais: dict[str, float], obra_especial: str | None,
    user_id: int, shared_with: list[int] | None = None,
) -> dict:
    shared_with = shared_with or []
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            "INSERT INTO grupos_obras (nome, descricao, obra_especial, created_by, updated_by) VALUES ($1,$2,$3,$4,$4) RETURNING id",
            nome, descricao, obra_especial or None, user_id,
        )
        grupo_id = row["id"]
        await _set_grupo_obras(conn, grupo_id, obras, percentuais)
        if shared_with:
            await conn.executemany(
                "INSERT INTO grupo_shares (grupo_id, user_id) VALUES ($1, $2)",
                [(grupo_id, uid) for uid in shared_with],
            )
    return {
        "id": grupo_id, "nome": nome, "descricao": descricao,
        "obras": obras, "obra_especial": obra_especial or None,
        "percentuais": percentuais, "created_by": user_id, "shared_with": shared_with,
    }


async def update_grupo(
    grupo_id: int, nome: str, descricao: str | None, obras: list[str],
    percentuais: dict[str, float], obra_especial: str | None,
    user_id: int, shared_with: list[int] | None = None,
) -> dict | None:
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            """UPDATE grupos_obras
               SET nome=$2, descricao=$3, obra_especial=$4, updated_at=NOW(), updated_by=$5
               WHERE id=$1 RETURNING id, created_by""",
            grupo_id, nome, descricao, obra_especial or None, user_id,
        )
        if not row:
            return None
        await _set_grupo_obras(conn, grupo_id, obras, percentuais)
        # Atualiza compartilhamentos (sempre sobrescreve se fornecido)
        if shared_with is not None:
            await conn.execute("DELETE FROM grupo_shares WHERE grupo_id=$1", grupo_id)
            if shared_with:
                await conn.executemany(
                    "INSERT INTO grupo_shares (grupo_id, user_id) VALUES ($1, $2)",
                    [(grupo_id, uid) for uid in shared_with],
                )
            new_shares = shared_with
        else:
            existing = await conn.fetch("SELECT user_id FROM grupo_shares WHERE grupo_id=$1", grupo_id)
            new_shares = [s["user_id"] for s in existing]
    return {
        "id": grupo_id, "nome": nome, "descricao": descricao,
        "obras": obras, "obra_especial": obra_especial or None,
        "percentuais": percentuais, "created_by": row["created_by"], "shared_with": new_shares,
    }


async def delete_grupo(grupo_id: int) -> None:
    async with _pool.acquire() as conn:
        await conn.execute("DELETE FROM grupos_obras WHERE id=$1", grupo_id)


async def get_all_users_basic() -> list[dict]:
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, name FROM users WHERE is_active=TRUE ORDER BY name"
        )
    return [dict(r) for r in rows]


async def _set_grupo_obras(conn, grupo_id: int, obras: list[str], percentuais: dict[str, float]):
    await conn.execute("DELETE FROM grupo_obra_items WHERE grupo_id=$1", grupo_id)
    if obras:
        await conn.executemany(
            "INSERT INTO grupo_obra_items (grupo_id, obra_codigo, percentual) VALUES ($1, $2, $3)",
            [(grupo_id, o, percentuais.get(o, 0.0)) for o in obras],
        )


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
