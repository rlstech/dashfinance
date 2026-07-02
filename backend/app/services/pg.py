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

CREATE TABLE IF NOT EXISTS grupo_custo_financeiro_empresas (
    grupo_id INTEGER REFERENCES grupos_obras(id) ON DELETE CASCADE,
    empresa  VARCHAR(200) NOT NULL,
    PRIMARY KEY (grupo_id, empresa)
);

CREATE TABLE IF NOT EXISTS custo_financeiro_categorias (
    id         SERIAL PRIMARY KEY,
    nome       VARCHAR(200) NOT NULL UNIQUE,
    sinal      VARCHAR(10)  NOT NULL DEFAULT 'saida' CHECK (sinal IN ('entrada', 'saida')),
    ordem      INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    updated_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS custo_financeiro_categoria_descricoes (
    tipo         VARCHAR(20)  NOT NULL CHECK (tipo IN ('transferencia', 'controle')),
    descricao    VARCHAR(300) NOT NULL,
    categoria_id INTEGER NOT NULL REFERENCES custo_financeiro_categorias(id) ON DELETE CASCADE,
    PRIMARY KEY (tipo, descricao)
);

CREATE TABLE IF NOT EXISTS custo_financeiro_lancamento_overrides (
    lancamento_id VARCHAR(64) PRIMARY KEY,
    categoria_id  INTEGER NOT NULL REFERENCES custo_financeiro_categorias(id) ON DELETE CASCADE,
    updated_at    TIMESTAMP DEFAULT NOW(),
    updated_by    INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS custo_financeiro_lancamento_log (
    id                    SERIAL PRIMARY KEY,
    lancamento_id         VARCHAR(64) NOT NULL,
    categoria_anterior_id INTEGER,
    categoria_nova_id     INTEGER,
    changed_at            TIMESTAMPTZ DEFAULT NOW(),
    changed_by            INTEGER REFERENCES users(id)
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

-- Valor global de custo/receita previsto por grupo+obra (meta de distribuição)
CREATE TABLE IF NOT EXISTS fluxo_obra_global (
    grupo_id        INTEGER NOT NULL REFERENCES grupos_obras(id) ON DELETE CASCADE,
    obra_codigo     VARCHAR(200) NOT NULL,
    custo_global    NUMERIC(15,2) NOT NULL DEFAULT 0,
    receita_global  NUMERIC(15,2) NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by      INTEGER REFERENCES users(id),
    PRIMARY KEY (grupo_id, obra_codigo)
);

-- Auditoria de alterações de previsto (quem mudou o quê e quando)
CREATE TABLE IF NOT EXISTS fluxo_planejamento_log (
    id              SERIAL PRIMARY KEY,
    grupo_id        INTEGER NOT NULL REFERENCES grupos_obras(id) ON DELETE CASCADE,
    obra_codigo     VARCHAR(200) NOT NULL,
    ano             INTEGER NOT NULL,
    mes             INTEGER NOT NULL,
    campo           TEXT NOT NULL,            -- 'custo_previsto' | 'receita_prevista'
    valor_anterior  NUMERIC(15,2) NOT NULL DEFAULT 0,
    valor_novo      NUMERIC(15,2) NOT NULL DEFAULT 0,
    changed_by      INTEGER REFERENCES users(id),
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS fluxo_plan_log_idx
    ON fluxo_planejamento_log (grupo_id, obra_codigo, ano, mes);
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
        await _migrate_planejamento_per_grupo(conn)
        await _migrate_grupos_periodo_padrao(conn)
        await _migrate_grupos_custo_financeiro(conn)
        await _seed_custo_financeiro_categorias(conn)
    log.info("Tabelas PostgreSQL verificadas/criadas")


async def _migrate_planejamento_per_grupo(conn):
    """One-time: escopa fluxo_planejamento por grupo.

    Antes o previsto era global por (obra, ano, mes) e compartilhado entre todos
    os grupos. Esta migração adiciona grupo_id, copia os valores globais atuais
    para cada grupo que contém a obra (preserva os grupos existentes) e remove as
    linhas globais. Roda apenas uma vez, detectada pela ausência da coluna grupo_id.
    """
    col = await conn.fetchval(
        """SELECT 1 FROM information_schema.columns
           WHERE table_name='fluxo_planejamento' AND column_name='grupo_id'"""
    )
    if col:
        return  # já migrado

    async with conn.transaction():
        await conn.execute(
            "ALTER TABLE fluxo_planejamento "
            "ADD COLUMN grupo_id INTEGER REFERENCES grupos_obras(id) ON DELETE CASCADE"
        )
        await conn.execute(
            "ALTER TABLE fluxo_planejamento "
            "DROP CONSTRAINT IF EXISTS fluxo_planejamento_obra_codigo_ano_mes_key"
        )
        # Copia o previsto global atual para cada grupo que contém a obra.
        await conn.execute(
            """INSERT INTO fluxo_planejamento
                   (grupo_id, obra_codigo, ano, mes, custo_previsto, receita_prevista)
               SELECT gi.grupo_id, fp.obra_codigo, fp.ano, fp.mes,
                      fp.custo_previsto, fp.receita_prevista
               FROM fluxo_planejamento fp
               JOIN grupo_obra_items gi ON gi.obra_codigo = fp.obra_codigo
               WHERE fp.grupo_id IS NULL"""
        )
        await conn.execute("DELETE FROM fluxo_planejamento WHERE grupo_id IS NULL")
        await conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS fluxo_planejamento_grupo_obra_ano_mes_key "
            "ON fluxo_planejamento (grupo_id, obra_codigo, ano, mes)"
        )
    log.info("Migração fluxo_planejamento → por grupo concluída")


async def _migrate_grupos_periodo_padrao(conn):
    """One-time: adiciona colunas de período padrão em grupos_obras."""
    col = await conn.fetchval(
        """SELECT 1 FROM information_schema.columns
           WHERE table_name='grupos_obras' AND column_name='periodo_ano_inicio'"""
    )
    if col:
        return
    await conn.execute(
        """ALTER TABLE grupos_obras
           ADD COLUMN periodo_ano_inicio INTEGER,
           ADD COLUMN periodo_mes_inicio INTEGER,
           ADD COLUMN periodo_ano_fim    INTEGER,
           ADD COLUMN periodo_mes_fim    INTEGER"""
    )
    log.info("Migração grupos_obras: colunas de período padrão adicionadas")


async def _migrate_grupos_custo_financeiro(conn):
    """One-time: adiciona flag incluir_custo_financeiro em grupos_obras."""
    col = await conn.fetchval(
        """SELECT 1 FROM information_schema.columns
           WHERE table_name='grupos_obras' AND column_name='incluir_custo_financeiro'"""
    )
    if col:
        return
    await conn.execute(
        "ALTER TABLE grupos_obras ADD COLUMN incluir_custo_financeiro BOOLEAN DEFAULT FALSE"
    )
    log.info("Migração grupos_obras: coluna incluir_custo_financeiro adicionada")


_DEFAULT_CATEGORIAS = [
    ("Receitas financeiras", "entrada", 1),
    ("Empréstimos tomados", "entrada", 2),
    ("Empréstimos pagos", "saida", 3),
    ("Aportes GAMA 01", "saida", 4),
    ("Despesas financeiras", "saida", 5),
]


async def _seed_custo_financeiro_categorias(conn):
    """One-time: cria as categorias padrão de Custo Financeiro se a tabela estiver vazia."""
    existing = await conn.fetchval("SELECT COUNT(*) FROM custo_financeiro_categorias")
    if existing:
        return
    await conn.executemany(
        "INSERT INTO custo_financeiro_categorias (nome, sinal, ordem) VALUES ($1,$2,$3)",
        _DEFAULT_CATEGORIAS,
    )
    log.info("Seed custo_financeiro_categorias: categorias padrão inseridas")


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


async def get_planejamento_bulk(obras: list[str], ano: int, grupo_id: int) -> dict[str, list[dict]]:
    """Retorna {obra_codigo: [12 dicts]} do previsto do grupo, em uma única query."""
    if not obras:
        return {}
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT obra_codigo, mes, custo_previsto, receita_prevista "
            "FROM fluxo_planejamento WHERE grupo_id = $3 AND obra_codigo = ANY($1) AND ano = $2",
            obras, ano, grupo_id,
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
                """SELECT id, nome, descricao, obra_especial, created_by,
                          periodo_ano_inicio, periodo_mes_inicio, periodo_ano_fim, periodo_mes_fim,
                          incluir_custo_financeiro
                   FROM grupos_obras ORDER BY nome"""
            )
        else:
            grupos = await conn.fetch(
                """SELECT g.id, g.nome, g.descricao, g.obra_especial, g.created_by,
                          g.periodo_ano_inicio, g.periodo_mes_inicio,
                          g.periodo_ano_fim, g.periodo_mes_fim,
                          g.incluir_custo_financeiro
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
        cf_empresas = await conn.fetch(
            "SELECT grupo_id, empresa FROM grupo_custo_financeiro_empresas WHERE grupo_id = ANY($1)",
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

    cf_empresas_map: dict[int, list[str]] = {}
    for row in cf_empresas:
        cf_empresas_map.setdefault(row["grupo_id"], []).append(row["empresa"])

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
            "periodo_padrao": {
                "ano_inicio": g["periodo_ano_inicio"],
                "mes_inicio": g["periodo_mes_inicio"],
                "ano_fim": g["periodo_ano_fim"],
                "mes_fim": g["periodo_mes_fim"],
            } if g["periodo_ano_inicio"] is not None else None,
            "incluir_custo_financeiro": bool(g["incluir_custo_financeiro"] or False),
            "custo_financeiro_empresas": cf_empresas_map.get(g["id"], []),
        }
        for g in grupos
    ]


async def get_grupo_created_by(grupo_id: int) -> int | None:
    async with _pool.acquire() as conn:
        row = await conn.fetchrow("SELECT created_by FROM grupos_obras WHERE id=$1", grupo_id)
    return row["created_by"] if row else None


async def grupo_exists(grupo_id: int) -> bool:
    async with _pool.acquire() as conn:
        row = await conn.fetchrow("SELECT 1 FROM grupos_obras WHERE id=$1", grupo_id)
    return row is not None


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
    incluir_custo_financeiro: bool = False,
    custo_financeiro_empresas: list[str] | None = None,
) -> dict:
    shares = _normalize_shares(shared_with)
    empresas_greedy = empresas_greedy or []
    custo_financeiro_empresas = custo_financeiro_empresas or []
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO grupos_obras
               (nome, descricao, obra_especial, created_by, updated_by, incluir_custo_financeiro)
               VALUES ($1,$2,$3,$4,$4,$5) RETURNING id""",
            nome, descricao, obra_especial or None, user_id, incluir_custo_financeiro,
        )
        grupo_id = row["id"]
        await _set_grupo_obras(conn, grupo_id, obras, percentuais)
        await _set_grupo_empresas_greedy(conn, grupo_id, empresas_greedy)
        await _set_grupo_custo_financeiro_empresas(conn, grupo_id, custo_financeiro_empresas)
        await _set_grupo_shares(conn, grupo_id, shares)
    return {
        "id": grupo_id, "nome": nome, "descricao": descricao,
        "obras": obras, "obra_especial": obra_especial or None,
        "percentuais": percentuais, "created_by": user_id,
        "shared_with": shares,
        "empresas_greedy": empresas_greedy,
        "incluir_custo_financeiro": incluir_custo_financeiro,
        "custo_financeiro_empresas": custo_financeiro_empresas,
    }


async def update_grupo(
    grupo_id: int, nome: str, descricao: str | None, obras: list[str],
    percentuais: dict[str, float], obra_especial: str | None,
    user_id: int, shared_with: list | None = None,
    empresas_greedy: list[str] | None = None,
    incluir_custo_financeiro: bool = False,
    custo_financeiro_empresas: list[str] | None = None,
) -> dict | None:
    empresas_greedy = empresas_greedy or []
    custo_financeiro_empresas = custo_financeiro_empresas or []
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            """UPDATE grupos_obras
               SET nome=$2, descricao=$3, obra_especial=$4, updated_at=NOW(), updated_by=$5,
                   incluir_custo_financeiro=$6
               WHERE id=$1 RETURNING id, created_by""",
            grupo_id, nome, descricao, obra_especial or None, user_id, incluir_custo_financeiro,
        )
        if not row:
            return None
        await _set_grupo_obras(conn, grupo_id, obras, percentuais)
        await _set_grupo_empresas_greedy(conn, grupo_id, empresas_greedy)
        await _set_grupo_custo_financeiro_empresas(conn, grupo_id, custo_financeiro_empresas)
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
        "incluir_custo_financeiro": incluir_custo_financeiro,
        "custo_financeiro_empresas": custo_financeiro_empresas,
    }


async def save_periodo_grupo(
    grupo_id: int, ano_inicio: int, mes_inicio: int, ano_fim: int, mes_fim: int
) -> None:
    async with _pool.acquire() as conn:
        await conn.execute(
            """UPDATE grupos_obras
               SET periodo_ano_inicio=$2, periodo_mes_inicio=$3,
                   periodo_ano_fim=$4, periodo_mes_fim=$5, updated_at=NOW()
               WHERE id=$1""",
            grupo_id, ano_inicio, mes_inicio, ano_fim, mes_fim,
        )


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


async def _set_grupo_custo_financeiro_empresas(conn, grupo_id: int, empresas: list[str]):
    await conn.execute("DELETE FROM grupo_custo_financeiro_empresas WHERE grupo_id=$1", grupo_id)
    if empresas:
        await conn.executemany(
            "INSERT INTO grupo_custo_financeiro_empresas (grupo_id, empresa) VALUES ($1, $2)",
            [(grupo_id, e) for e in empresas],
        )


async def get_grupo_custo_financeiro_empresas(grupo_id: int) -> list[str]:
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT empresa FROM grupo_custo_financeiro_empresas WHERE grupo_id=$1",
            grupo_id,
        )
    return [r["empresa"] for r in rows]


async def bulk_upsert_planejamento(grupo_id: int, items: list[dict]) -> int:
    if not items:
        return 0
    async with _pool.acquire() as conn:
        await conn.executemany(
            """
            INSERT INTO fluxo_planejamento
                (grupo_id, obra_codigo, ano, mes, custo_previsto, receita_prevista, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,NOW())
            ON CONFLICT (grupo_id, obra_codigo, ano, mes) DO UPDATE
                SET custo_previsto=$5, receita_prevista=$6, updated_at=NOW()
            """,
            [
                (grupo_id, r["obra_codigo"], r["ano"], r["mes"],
                 r["custo_previsto"], r["receita_prevista"])
                for r in items
            ],
        )
    return len(items)


async def get_obra_global(grupo_id: int, obras: list[str]) -> dict[str, dict]:
    """Retorna {obra_codigo: {custo_global, receita_global}} do grupo."""
    if not obras:
        return {}
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT obra_codigo, custo_global, receita_global "
            "FROM fluxo_obra_global WHERE grupo_id=$1 AND obra_codigo = ANY($2)",
            grupo_id, obras,
        )
    return {
        r["obra_codigo"]: {
            "custo_global": float(r["custo_global"]),
            "receita_global": float(r["receita_global"]),
        }
        for r in rows
    }


async def save_obra_planejamento(
    grupo_id: int, obra_codigo: str, user_id: int,
    custo_global: float, receita_global: float,
    meses: list[dict],
) -> None:
    """Grava o previsto de uma obra (lote) + valor global, registrando o log das
    células que mudaram. `meses` = [{ano, mes, custo_previsto, receita_prevista}].
    """
    async with _pool.acquire() as conn:
        async with conn.transaction():
            # Estado atual para comparar e logar somente o que mudou
            atuais = await conn.fetch(
                "SELECT ano, mes, custo_previsto, receita_prevista "
                "FROM fluxo_planejamento WHERE grupo_id=$1 AND obra_codigo=$2",
                grupo_id, obra_codigo,
            )
            antes: dict[tuple[int, int], dict] = {
                (r["ano"], r["mes"]): {
                    "custo_previsto": float(r["custo_previsto"]),
                    "receita_prevista": float(r["receita_prevista"]),
                }
                for r in atuais
            }

            logs: list[tuple] = []
            for m in meses:
                key = (m["ano"], m["mes"])
                prev = antes.get(key, {"custo_previsto": 0.0, "receita_prevista": 0.0})
                for campo in ("custo_previsto", "receita_prevista"):
                    novo = float(m.get(campo, 0) or 0)
                    if abs(novo - prev[campo]) > 0.001:
                        logs.append((
                            grupo_id, obra_codigo, m["ano"], m["mes"],
                            campo, prev[campo], novo, user_id,
                        ))

            await conn.executemany(
                """
                INSERT INTO fluxo_planejamento
                    (grupo_id, obra_codigo, ano, mes, custo_previsto, receita_prevista, updated_at)
                VALUES ($1,$2,$3,$4,$5,$6,NOW())
                ON CONFLICT (grupo_id, obra_codigo, ano, mes) DO UPDATE
                    SET custo_previsto=$5, receita_prevista=$6, updated_at=NOW()
                """,
                [
                    (grupo_id, obra_codigo, m["ano"], m["mes"],
                     float(m.get("custo_previsto", 0) or 0),
                     float(m.get("receita_prevista", 0) or 0))
                    for m in meses
                ],
            )

            await conn.execute(
                """
                INSERT INTO fluxo_obra_global
                    (grupo_id, obra_codigo, custo_global, receita_global, updated_by, updated_at)
                VALUES ($1,$2,$3,$4,$5,NOW())
                ON CONFLICT (grupo_id, obra_codigo) DO UPDATE
                    SET custo_global=$3, receita_global=$4, updated_by=$5, updated_at=NOW()
                """,
                grupo_id, obra_codigo, custo_global, receita_global, user_id,
            )

            if logs:
                await conn.executemany(
                    """INSERT INTO fluxo_planejamento_log
                          (grupo_id, obra_codigo, ano, mes, campo,
                           valor_anterior, valor_novo, changed_by)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)""",
                    logs,
                )


async def get_obra_logs(grupo_id: int, obra_codigo: str) -> list[dict]:
    """Histórico de alterações de previsto de uma obra (mais recentes primeiro)."""
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT l.ano, l.mes, l.campo, l.valor_anterior, l.valor_novo,
                      l.changed_at, u.name AS changed_by_name
               FROM fluxo_planejamento_log l
               LEFT JOIN users u ON u.id = l.changed_by
               WHERE l.grupo_id=$1 AND l.obra_codigo=$2
               ORDER BY l.changed_at DESC""",
            grupo_id, obra_codigo,
        )
    return [
        {
            "ano": r["ano"], "mes": r["mes"], "campo": r["campo"],
            "valor_anterior": float(r["valor_anterior"]),
            "valor_novo": float(r["valor_novo"]),
            "changed_at": r["changed_at"],
            "changed_by_name": r["changed_by_name"],
        }
        for r in rows
    ]


async def get_grupos_planejamento_totais(
    grupo_ids: list[int], slots: list[tuple[int, int]],
) -> dict[int, dict]:
    """Retorna {grupo_id: {custo_prev, receita_prev}} somado sobre os meses do período."""
    if not grupo_ids or not slots:
        return {}
    anos = list({s[0] for s in slots})
    slotset = set(slots)
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT grupo_id, ano, mes, custo_previsto, receita_prevista "
            "FROM fluxo_planejamento WHERE grupo_id = ANY($1) AND ano = ANY($2)",
            grupo_ids, anos,
        )
    out: dict[int, dict] = {gid: {"custo_prev": 0.0, "receita_prev": 0.0} for gid in grupo_ids}
    for r in rows:
        if (r["ano"], r["mes"]) in slotset:
            out[r["grupo_id"]]["custo_prev"] += float(r["custo_previsto"])
            out[r["grupo_id"]]["receita_prev"] += float(r["receita_prevista"])
    return out


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


# ── Custo Financeiro — Categorias ────────────────────────────────────────────

async def get_custo_financeiro_categorias() -> list[dict]:
    async with _pool.acquire() as conn:
        cats = await conn.fetch(
            "SELECT id, nome, sinal, ordem FROM custo_financeiro_categorias ORDER BY ordem, nome"
        )
        descs = await conn.fetch(
            "SELECT categoria_id, tipo, descricao FROM custo_financeiro_categoria_descricoes ORDER BY descricao"
        )
    desc_map: dict[int, list[dict]] = {}
    for d in descs:
        desc_map.setdefault(d["categoria_id"], []).append({"tipo": d["tipo"], "descricao": d["descricao"]})
    return [
        {
            "id": c["id"], "nome": c["nome"], "sinal": c["sinal"], "ordem": c["ordem"],
            "descricoes": desc_map.get(c["id"], []),
        }
        for c in cats
    ]


async def _set_categoria_descricoes(conn, categoria_id: int, descricoes: list[dict]) -> None:
    new_keys = {(d["tipo"], d["descricao"]) for d in descricoes}
    current = await conn.fetch(
        "SELECT tipo, descricao FROM custo_financeiro_categoria_descricoes WHERE categoria_id=$1",
        categoria_id,
    )
    current_keys = {(c["tipo"], c["descricao"]) for c in current}
    to_remove = current_keys - new_keys
    if to_remove:
        await conn.executemany(
            "DELETE FROM custo_financeiro_categoria_descricoes WHERE categoria_id=$1 AND tipo=$2 AND descricao=$3",
            [(categoria_id, t, d) for t, d in to_remove],
        )
    if new_keys:
        await conn.executemany(
            """INSERT INTO custo_financeiro_categoria_descricoes (tipo, descricao, categoria_id)
               VALUES ($1, $2, $3)
               ON CONFLICT (tipo, descricao) DO UPDATE SET categoria_id = EXCLUDED.categoria_id""",
            [(t, d, categoria_id) for t, d in new_keys],
        )


async def create_custo_financeiro_categoria(
    nome: str, sinal: str, ordem: int, user_id: int,
    descricoes: list[dict] | None = None,
) -> dict:
    descricoes = descricoes or []
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO custo_financeiro_categorias (nome, sinal, ordem, updated_by)
               VALUES ($1,$2,$3,$4) RETURNING id""",
            nome, sinal, ordem, user_id,
        )
        categoria_id = row["id"]
        await _set_categoria_descricoes(conn, categoria_id, descricoes)
    return {"id": categoria_id, "nome": nome, "sinal": sinal, "ordem": ordem, "descricoes": descricoes}


async def update_custo_financeiro_categoria(
    categoria_id: int, nome: str, sinal: str, ordem: int, user_id: int,
    descricoes: list[dict] | None = None,
) -> dict | None:
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            """UPDATE custo_financeiro_categorias
               SET nome=$2, sinal=$3, ordem=$4, updated_at=NOW(), updated_by=$5
               WHERE id=$1 RETURNING id""",
            categoria_id, nome, sinal, ordem, user_id,
        )
        if not row:
            return None
        if descricoes is not None:
            await _set_categoria_descricoes(conn, categoria_id, descricoes)
    return {"id": categoria_id, "nome": nome, "sinal": sinal, "ordem": ordem, "descricoes": descricoes or []}


async def delete_custo_financeiro_categoria(categoria_id: int) -> None:
    async with _pool.acquire() as conn:
        await conn.execute("DELETE FROM custo_financeiro_categorias WHERE id=$1", categoria_id)


async def get_custo_financeiro_overrides() -> dict[str, int]:
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT lancamento_id, categoria_id FROM custo_financeiro_lancamento_overrides"
        )
    return {r["lancamento_id"]: r["categoria_id"] for r in rows}


async def set_lancamento_categoria(lancamento_id: str, categoria_id: int | None, user_id: int) -> None:
    async with _pool.acquire() as conn:
        async with conn.transaction():
            prev = await conn.fetchval(
                "SELECT categoria_id FROM custo_financeiro_lancamento_overrides WHERE lancamento_id=$1",
                lancamento_id,
            )
            if categoria_id is None:
                await conn.execute(
                    "DELETE FROM custo_financeiro_lancamento_overrides WHERE lancamento_id=$1",
                    lancamento_id,
                )
            else:
                await conn.execute(
                    """INSERT INTO custo_financeiro_lancamento_overrides (lancamento_id, categoria_id, updated_by)
                       VALUES ($1, $2, $3)
                       ON CONFLICT (lancamento_id) DO UPDATE
                       SET categoria_id=EXCLUDED.categoria_id, updated_at=NOW(), updated_by=EXCLUDED.updated_by""",
                    lancamento_id, categoria_id, user_id,
                )
            await conn.execute(
                """INSERT INTO custo_financeiro_lancamento_log
                   (lancamento_id, categoria_anterior_id, categoria_nova_id, changed_by)
                   VALUES ($1, $2, $3, $4)""",
                lancamento_id, prev, categoria_id, user_id,
            )
