import asyncio
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
    grupo_id   INTEGER REFERENCES grupos_obras(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    permission TEXT NOT NULL DEFAULT 'view',
    PRIMARY KEY (grupo_id, user_id)
);

ALTER TABLE grupo_shares ADD COLUMN IF NOT EXISTS permission TEXT NOT NULL DEFAULT 'view';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_name = 'grupo_shares_permission_chk'
    ) THEN
        ALTER TABLE grupo_shares
            ADD CONSTRAINT grupo_shares_permission_chk
            CHECK (permission IN ('view', 'edit'));
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS grupo_empresas_greedy (
    grupo_id INTEGER REFERENCES grupos_obras(id) ON DELETE CASCADE,
    empresa  VARCHAR(200) NOT NULL,
    PRIMARY KEY (grupo_id, empresa)
);

CREATE TABLE IF NOT EXISTS fluxo_real_cache (
    grupo_id          INTEGER NOT NULL REFERENCES grupos_obras(id) ON DELETE CASCADE,
    ano               INTEGER NOT NULL,
    obra_codigo       VARCHAR(200) NOT NULL,
    mes               INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
    custo_real        NUMERIC(15,2) NOT NULL DEFAULT 0,
    receita_realizada NUMERIC(15,2) NOT NULL DEFAULT 0,
    PRIMARY KEY (grupo_id, ano, obra_codigo, mes)
);

CREATE TABLE IF NOT EXISTS fluxo_real_cache_meta (
    grupo_id   INTEGER NOT NULL REFERENCES grupos_obras(id) ON DELETE CASCADE,
    ano        INTEGER NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by INTEGER REFERENCES users(id),
    origens    TEXT[] NOT NULL DEFAULT '{}',
    status_rec TEXT[] NOT NULL DEFAULT '{}',
    PRIMARY KEY (grupo_id, ano)
);

CREATE INDEX IF NOT EXISTS fluxo_real_cache_obra_idx
    ON fluxo_real_cache (grupo_id, ano, obra_codigo);
"""


async def init_pool():
    global _pool
    for attempt in range(1, 11):
        try:
            _pool = await asyncpg.create_pool(settings.PG_DSN, min_size=2, max_size=10)
            log.info("PostgreSQL pool criado")
            return
        except Exception as e:
            if attempt < 10:
                log.warning("PostgreSQL indisponível (tentativa %d/10): %s — aguardando 5s", attempt, e)
                await asyncio.sleep(5)
            else:
                raise


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
            "SELECT grupo_id, user_id, permission FROM grupo_shares WHERE grupo_id = ANY($1)",
            grupo_ids,
        )
        greedy = await conn.fetch(
            "SELECT grupo_id, empresa FROM grupo_empresas_greedy WHERE grupo_id = ANY($1)",
            grupo_ids,
        )

    obras_map: dict[int, list[str]] = {}
    pct_map: dict[int, dict[str, float]] = {}
    for item in items:
        obras_map.setdefault(item["grupo_id"], []).append(item["obra_codigo"])
        pct_map.setdefault(item["grupo_id"], {})[item["obra_codigo"]] = float(item["percentual"] or 0)

    shares_map: dict[int, list[dict]] = {}
    editor_map: dict[int, set[int]] = {}
    for share in shares:
        shares_map.setdefault(share["grupo_id"], []).append({
            "user_id": share["user_id"],
            "permission": share["permission"],
        })
        if share["permission"] == "edit":
            editor_map.setdefault(share["grupo_id"], set()).add(share["user_id"])

    greedy_map: dict[int, list[str]] = {}
    for row in greedy:
        greedy_map.setdefault(row["grupo_id"], []).append(row["empresa"])

    return [
        {
            "id": g["id"], "nome": g["nome"], "descricao": g["descricao"],
            "obras": obras_map.get(g["id"], []),
            "obra_especial": g["obra_especial"],
            "percentuais": pct_map.get(g["id"], {}),
            "created_by": g["created_by"],
            "is_owner": is_admin or g["created_by"] == user_id,
            "can_edit": (
                is_admin
                or g["created_by"] == user_id
                or user_id in editor_map.get(g["id"], set())
            ),
            "shared_with": shares_map.get(g["id"], []),
            "empresas_greedy": greedy_map.get(g["id"], []),
        }
        for g in grupos
    ]


async def get_grupo_created_by(grupo_id: int) -> int | None:
    async with _pool.acquire() as conn:
        row = await conn.fetchrow("SELECT created_by FROM grupos_obras WHERE id=$1", grupo_id)
    return row["created_by"] if row else None


def _normalize_shares(shared_with: list | None) -> list[dict]:
    """Aceita lista de dicts ({user_id, permission}) ou de ints (legado). Retorna sempre dicts."""
    if not shared_with:
        return []
    out: list[dict] = []
    seen: set[int] = set()
    for item in shared_with:
        if isinstance(item, dict):
            uid = int(item["user_id"])
            perm = item.get("permission", "view")
        else:
            uid = int(item)
            perm = "view"
        if perm not in ("view", "edit"):
            perm = "view"
        if uid in seen:
            continue
        seen.add(uid)
        out.append({"user_id": uid, "permission": perm})
    return out


async def _set_grupo_shares(conn, grupo_id: int, shares: list[dict]) -> None:
    await conn.execute("DELETE FROM grupo_shares WHERE grupo_id=$1", grupo_id)
    if shares:
        await conn.executemany(
            "INSERT INTO grupo_shares (grupo_id, user_id, permission) VALUES ($1, $2, $3)",
            [(grupo_id, s["user_id"], s["permission"]) for s in shares],
        )


async def create_grupo(
    nome: str, descricao: str | None, obras: list[str],
    percentuais: dict[str, float], obra_especial: str | None,
    user_id: int, shared_with: list | None = None,
    empresas_greedy: list[str] | None = None,
) -> dict:
    shares = _normalize_shares(shared_with)
    empresas_greedy = empresas_greedy or []
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            "INSERT INTO grupos_obras (nome, descricao, obra_especial, created_by, updated_by) VALUES ($1,$2,$3,$4,$4) RETURNING id",
            nome, descricao, obra_especial or None, user_id,
        )
        grupo_id = row["id"]
        await _set_grupo_obras(conn, grupo_id, obras, percentuais)
        await _set_grupo_empresas_greedy(conn, grupo_id, empresas_greedy)
        await _set_grupo_shares(conn, grupo_id, shares)
    return {
        "id": grupo_id, "nome": nome, "descricao": descricao,
        "obras": obras, "obra_especial": obra_especial or None,
        "percentuais": percentuais, "created_by": user_id,
        "shared_with": shares,
        "empresas_greedy": empresas_greedy,
    }


async def update_grupo(
    grupo_id: int, nome: str, descricao: str | None, obras: list[str],
    percentuais: dict[str, float], obra_especial: str | None,
    user_id: int, shared_with: list | None = None,
    empresas_greedy: list[str] | None = None,
) -> dict | None:
    empresas_greedy = empresas_greedy or []
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
        await _set_grupo_empresas_greedy(conn, grupo_id, empresas_greedy)
        if shared_with is not None:
            new_shares = _normalize_shares(shared_with)
            await _set_grupo_shares(conn, grupo_id, new_shares)
        else:
            existing = await conn.fetch(
                "SELECT user_id, permission FROM grupo_shares WHERE grupo_id=$1",
                grupo_id,
            )
            new_shares = [
                {"user_id": s["user_id"], "permission": s["permission"]}
                for s in existing
            ]
    return {
        "id": grupo_id, "nome": nome, "descricao": descricao,
        "obras": obras, "obra_especial": obra_especial or None,
        "percentuais": percentuais, "created_by": row["created_by"],
        "shared_with": new_shares,
        "empresas_greedy": empresas_greedy,
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


async def _set_grupo_empresas_greedy(conn, grupo_id: int, empresas: list[str]):
    await conn.execute("DELETE FROM grupo_empresas_greedy WHERE grupo_id=$1", grupo_id)
    if empresas:
        await conn.executemany(
            "INSERT INTO grupo_empresas_greedy (grupo_id, empresa) VALUES ($1, $2)",
            [(grupo_id, e) for e in empresas],
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


# ── Cache de Dados Reais por Grupo ───────────────────────────────────────────

async def get_fluxo_real_cache(
    grupo_id: int, ano: int,
) -> tuple[list[dict], dict | None]:
    """Retorna (rows, meta) ou ([], None) se não houver snapshot."""
    async with _pool.acquire() as conn:
        meta_row = await conn.fetchrow(
            """SELECT m.updated_at, m.updated_by, m.origens, m.status_rec, u.name AS updated_by_name
               FROM fluxo_real_cache_meta m
               LEFT JOIN users u ON u.id = m.updated_by
               WHERE m.grupo_id=$1 AND m.ano=$2""",
            grupo_id, ano,
        )
        if not meta_row:
            return [], None
        rows = await conn.fetch(
            """SELECT obra_codigo, mes, custo_real, receita_realizada
               FROM fluxo_real_cache
               WHERE grupo_id=$1 AND ano=$2
               ORDER BY obra_codigo, mes""",
            grupo_id, ano,
        )
    return [dict(r) for r in rows], dict(meta_row)


async def save_fluxo_real_cache(
    grupo_id: int, ano: int, user_id: int,
    rows: list[dict],
    origens: list[str], status_rec: list[str],
) -> dict:
    """Substitui o snapshot do grupo/ano. Retorna o meta atualizado."""
    async with _pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "DELETE FROM fluxo_real_cache WHERE grupo_id=$1 AND ano=$2",
                grupo_id, ano,
            )
            if rows:
                await conn.executemany(
                    """INSERT INTO fluxo_real_cache
                          (grupo_id, ano, obra_codigo, mes, custo_real, receita_realizada)
                       VALUES ($1, $2, $3, $4, $5, $6)""",
                    [
                        (grupo_id, ano, r["obra_codigo"], r["mes"],
                         r["custo_real"], r["receita_realizada"])
                        for r in rows
                    ],
                )
            meta = await conn.fetchrow(
                """INSERT INTO fluxo_real_cache_meta
                       (grupo_id, ano, updated_at, updated_by, origens, status_rec)
                   VALUES ($1, $2, NOW(), $3, $4, $5)
                   ON CONFLICT (grupo_id, ano) DO UPDATE
                       SET updated_at=NOW(), updated_by=$3, origens=$4, status_rec=$5
                   RETURNING updated_at, updated_by, origens, status_rec""",
                grupo_id, ano, user_id, origens, status_rec,
            )
            name_row = await conn.fetchrow(
                "SELECT name FROM users WHERE id=$1", user_id,
            )
    out = dict(meta)
    out["updated_by_name"] = name_row["name"] if name_row else None
    return out


async def get_grupos_real_totais(
    grupo_ids: list[int], ano: int,
) -> dict[int, dict]:
    """Retorna {grupo_id: {custo_real, receita_realizada, updated_at, origens, status_rec}}."""
    if not grupo_ids:
        return {}
    async with _pool.acquire() as conn:
        totais = await conn.fetch(
            """SELECT grupo_id,
                      COALESCE(SUM(custo_real), 0)        AS custo_real,
                      COALESCE(SUM(receita_realizada), 0) AS receita_realizada
               FROM fluxo_real_cache
               WHERE grupo_id = ANY($1) AND ano = $2
               GROUP BY grupo_id""",
            grupo_ids, ano,
        )
        metas = await conn.fetch(
            """SELECT grupo_id, updated_at, origens, status_rec
               FROM fluxo_real_cache_meta
               WHERE grupo_id = ANY($1) AND ano = $2""",
            grupo_ids, ano,
        )
    tot_map = {r["grupo_id"]: r for r in totais}
    result: dict[int, dict] = {}
    for m in metas:
        gid = m["grupo_id"]
        t = tot_map.get(gid)
        result[gid] = {
            "custo_real": float(t["custo_real"]) if t else 0.0,
            "receita_realizada": float(t["receita_realizada"]) if t else 0.0,
            "updated_at": m["updated_at"],
            "origens": list(m["origens"]),
            "status_rec": list(m["status_rec"]),
        }
    return result


async def can_user_edit_grupo(
    grupo_id: int, user_id: int, is_admin: bool,
) -> bool:
    """True se admin, dono, ou share com permission='edit'."""
    if is_admin:
        async with _pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT 1 FROM grupos_obras WHERE id=$1", grupo_id,
            )
        return row is not None
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT 1 FROM grupos_obras g
               WHERE g.id=$1
                 AND (g.created_by=$2
                      OR EXISTS (SELECT 1 FROM grupo_shares gs
                                 WHERE gs.grupo_id=g.id
                                   AND gs.user_id=$2
                                   AND gs.permission='edit'))""",
            grupo_id, user_id,
        )
    return row is not None


async def is_grupo_visible_to_user(
    grupo_id: int, user_id: int, is_admin: bool,
) -> bool:
    """True se o usuário pode visualizar o grupo (admin, dono ou compartilhado)."""
    if is_admin:
        async with _pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT 1 FROM grupos_obras WHERE id=$1", grupo_id,
            )
        return row is not None
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT 1 FROM grupos_obras g
               WHERE g.id=$1
                 AND (g.created_by=$2
                      OR EXISTS (SELECT 1 FROM grupo_shares gs
                                 WHERE gs.grupo_id=g.id AND gs.user_id=$2))""",
            grupo_id, user_id,
        )
    return row is not None


async def get_grupo_obras_e_greedy(grupo_id: int) -> tuple[list[str], list[str]]:
    """Retorna (obras_diretas, empresas_greedy) do grupo."""
    async with _pool.acquire() as conn:
        obras_rows = await conn.fetch(
            "SELECT obra_codigo FROM grupo_obra_items WHERE grupo_id=$1",
            grupo_id,
        )
        greedy_rows = await conn.fetch(
            "SELECT empresa FROM grupo_empresas_greedy WHERE grupo_id=$1",
            grupo_id,
        )
    return (
        [r["obra_codigo"] for r in obras_rows],
        [r["empresa"] for r in greedy_rows],
    )
