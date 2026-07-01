# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DashFinance is a financial dashboard for UAU, monitoring Accounts Payable (AP), Revenues, Cash Flow, and per-obra (construction project) planning vs. actuals. It runs as a Docker Swarm stack (backend, frontend, redis) behind Traefik, connects to a Microsoft SQL Server for source data, and uses a separate/shared PostgreSQL instance for auth and app config.

## Architecture

```
Browser → Nginx (frontend React SPA) → /api/* → FastAPI (backend) → Redis cache
                                                                   ↕ on /api/sync
                                                               queries.py → SQL Server
                                                               excel.py  → SMB share
                                                               pg.py     → PostgreSQL (auth + config + fluxo-obras)
```

**`backend/`** — FastAPI app (Python 3.12):
- `app/main.py` — FastAPI app with CORS, lifespan (PostgreSQL pool init + APScheduler + initial sync)
- `app/config.py` — Pydantic BaseSettings (all env vars)
- `app/api/router.py` — mounts every sub-router under the `/api` prefix
- `app/api/` — routers: `auth.py` (login/me), `admin.py` (user CRUD), `financeiro.py` (AP/receitas/saldo, auth-gated), `sync.py` (sync/status), `filters.py` (filter tree), `config_api.py` (saldo config), `grupos_obras.py` (CRUD for obra groupings + sharing), `fluxo_obras.py` (planning vs. actuals per obra/grupo, Excel bulk import, custo financeiro)
- `app/deps/auth.py` — `get_current_user` and `require_admin` FastAPI dependencies
- `app/services/database.py` — pymssql connection pool (SQL Server)
- `app/services/pg.py` — asyncpg connection pool (PostgreSQL); auto-creates/migrates schema on startup (`_SCHEMA` string with `CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS` for in-place migrations); owns auth tables (`users`, `user_empresas`), `saldo_config`, and the fluxo-obras tables (`grupos_obras`, `grupo_obra_items`, `grupo_shares`, `grupo_empresas_greedy`, `fluxo_planejamento`, `fluxo_obra_global`, `fluxo_planejamento_log`, `fluxo_real_cache` + `_meta`)
- `app/services/cache.py` — async Redis client; keys are namespaced `dash:<prefix>:<...>` (e.g. `dash:ap:all`, `dash:filters:tree`)
- `app/services/queries.py` — exact SQL queries (`get_ap`, `get_receitas`, `get_saldo_banco`, `get_transferencias`, `get_controle_financeiro`) and `EMPRESA_MAP`
- `app/services/sync.py` — `sync_all()` merges SQL Server + Excel data into Redis (each dataset fetched independently, errors collected but non-fatal); APScheduler runs it on `SYNC_INTERVAL_MINUTES`
- `app/services/excel.py` — reads COMBRASEN and GAMA 01 Cash Flow Excel files via SMB (pysmb + openpyxl); merged into AP/receitas data, never the source of truth
- `app/models/auth.py` — Pydantic models for auth + grupos-obras (`UserOut`, `Token`, `UserCreate`, `UserUpdate`, `SaldoConfigIn/Out`, `GrupoObrasIn/Out`, `PeriodoPadrao`, `UserBasic`)
- `app/models/schemas.py` — Pydantic models for financial records and fluxo-obras responses (`APRecord`, `ReceitaRecord`, `SaldoRecord`, `FluxoMesRow`, `FluxoPlanejamentoResponse`, `FluxoRealResponse`, `CustoFinanceiroResponse`, etc.)
- `scripts/create_admin.py` — one-off CLI to bootstrap the first admin user directly in Postgres

**`frontend/`** — React 19 + Vite + TypeScript SPA:
- `src/App.tsx` — React Router v6; routes: `/login`, `/receitas`, `/despesas`, `/fluxo`, `/fluxo-obras`, `/config`, `/admin`
- `src/pages/` — Login, Receitas, Despesas (formerly ContasAPagar), FluxoCaixa, FluxoObras (largest page — grupo management, per-obra planning grid, real-vs-previsto, custo financeiro cards), Configuracoes, Admin
- `src/hooks/useAuth.ts` — Zustand store (persisted as `dashfinance-auth-v1`) + `loginRequest()`
- `src/hooks/useFilters.ts` — Zustand (filter state)
- `src/hooks/useFinanceiro.ts` — TanStack Query hooks for all API calls including auth-aware ones
- `src/hooks/useEmpresaConfig.ts` — TanStack Query hooks for saldo/empresa config
- `src/components/auth/ProtectedRoute.tsx` — redirects to `/login`; `requireAdmin` prop for admin-only routes
- `src/lib/exportFluxoObras.ts`, `src/lib/exportPivot.ts` — Excel/PDF export helpers for the fluxo-obras and pivot tables
- `src/types/index.ts` — TypeScript interfaces + EMPRESA_COLORS/ABBR constants

**`cf_proxy/`** — TCP proxy tunneling SQL Server via Cloudflare Access (used when FortiGate VPN is unavailable).

## Running Locally

```bash
# Backend
cd backend
pip install -r requirements.txt
export DB_HOST=192.168.1.8 DB_PORT=62311 DB_NAME=uau DB_USER=... DB_PASSWORD=...
export REDIS_URL=redis://localhost:6379/0
export PG_DSN=postgresql://user:pass@localhost:5432/dash
export JWT_SECRET=dev-secret
uvicorn app.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev      # dev server on :5173, proxies /api → localhost:8000
npm run build    # tsc -b && vite build
npm run lint     # eslint .
```

## Environment Variables (backend)

| Variable | Required | Description |
|---|---|---|
| `DB_HOST` | ✅ | SQL Server host |
| `DB_PORT` | ❌ (default: 62311) | SQL Server port |
| `DB_NAME` | ✅ | Database name |
| `DB_USER` | ✅ | Database username |
| `DB_PASSWORD` | ✅ | Database password |
| `REDIS_URL` | ❌ (default: redis://redis:6379/0) | Redis connection URL |
| `PG_DSN` | ✅ | PostgreSQL DSN (asyncpg format) |
| `JWT_SECRET` | ✅ | Secret for HS256 JWT signing |
| `JWT_EXPIRE_MINUTES` | ❌ (default: 480) | JWT TTL |
| `CORS_ORIGINS` | ❌ | JSON array of allowed origins |
| `SYNC_INTERVAL_MINUTES` | ❌ (default: 30) | Auto-sync interval (0 = disabled) |
| `SYNC_DATE_FROM` | ❌ (default: 2020-01-01) | Data range start |
| `SYNC_DATE_TO` | ❌ (default: 2030-12-31) | Data range end |
| `EXCEL_COMBRASEN` | ❌ | UNC path to COMBRASEN Cash Flow Excel |
| `EXCEL_GAMA01` | ❌ | UNC path to GAMA 01 Cash Flow Excel |
| `EXCEL_SMB_USER` | ❌ | SMB username (supports `DOMAIN\user` format) |
| `EXCEL_SMB_PASS` | ❌ | SMB password |
| `TZ` | ❌ | Timezone (default: America/Sao_Paulo) |

> **Important**: Configure secrets (`DB_USER`, `DB_PASSWORD`, `JWT_SECRET`) as environment variables in Portainer, NOT in `docker-compose.yml`.

## API Endpoints

All financial data endpoints require `Authorization: Bearer <token>`.

| Route | Auth | Description |
|---|---|---|
| `POST /api/auth/login` | — | Returns JWT + user object |
| `GET /api/auth/me` | user | Current user info |
| `GET /api/admin/users` | admin | List all users |
| `POST /api/admin/users` | admin | Create user |
| `PUT /api/admin/users/{id}` | admin | Update user (name, password, is_admin, empresas) |
| `DELETE /api/admin/users/{id}` | admin | Deactivate user |
| `GET /api/ap` | user | AP records (filtered to user.empresas unless admin) |
| `GET /api/receitas` | user | Revenue records |
| `GET /api/saldo_banco` | user | Bank balance records |
| `GET /api/sync` | user | Re-query DB + Excel, update Redis |
| `GET /api/status` | user | Cache metadata (last sync, counts) |
| `GET /api/filters/tree` | user | Pre-computed filter tree |
| `GET /api/config/saldos` | user | Saldo config (admin sees all; users see their empresas) |
| `PUT /api/config/saldos` | admin | Upsert saldo config entries |
| `GET /api/grupos-obras` | user | List obra groups visible to the user (owned + shared) |
| `POST /api/grupos-obras` | user | Create a group (obras, percentuais, shares, empresas greedy) |
| `PUT /api/grupos-obras/{id}` | owner/editor | Update a group; 403 unless `can_user_edit_grupo` |
| `PUT /api/grupos-obras/{id}/periodo` | owner/editor | Save the group's default período (ano/mês início-fim) |
| `DELETE /api/grupos-obras/{id}` | owner/editor | Delete a group |
| `GET /api/fluxo-obras/todas` | user | Planejamento (previsto) per obra for a período, scoped to a grupo |
| `GET /api/fluxo-obras/real` | user | Custo real / receita realizada per obra/mês, computed live from Redis |
| `GET /api/fluxo-obras/grupo/{id}/real` | user | Persisted (cached) real snapshot for a grupo/período |
| `POST /api/fluxo-obras/grupo/{id}/real` | owner/editor | Recompute + persist the real snapshot for a grupo |
| `POST /api/fluxo-obras/grupo/{id}/obra/{obra}/planejamento` | owner/editor | Save previsto for one obra; 422 if monthly sum ≠ global value |
| `GET /api/fluxo-obras/grupo/{id}/obra/{obra}/logs` | user | Audit log of previsto changes for one obra |
| `POST /api/fluxo-obras/planejamento/importar` | owner/editor | Bulk-import previsto from an `.xlsx` (obra_codigo, ano, mes, custo_previsto, receita_prevista) |
| `GET /api/fluxo-obras/grupos-totais-previstos` | user | Previsto totals per visible grupo, for the card gallery |
| `GET /api/fluxo-obras/grupos-totais-reais` | user | Real totals per visible grupo, for the card gallery |
| `GET /api/fluxo-obras/custo-financeiro` | user | Tesouraria: transferências + controle financeiro aggregated by month/descrição |

## Authorization Model

- Every user has an `empresas: list[str]` field (company names, e.g. `"COMBRASEN"`, `"GAMA 01"`).
- Non-admin users see only records where `record["empresa"] in user.empresas`.
- `require_admin` dependency enforces `user.is_admin == True`; otherwise 403.
- JWT payload: `{"sub": "<user_id>", "exp": ...}`, HS256.
- Grupos de obras have their own permission layer on top: a grupo has an owner (`created_by`) plus `grupo_shares` rows with `permission` = `view` | `edit`. `pg.is_grupo_visible_to_user` gates read access, `pg.can_user_edit_grupo` gates writes (admins bypass both). A grupo can also mark whole `empresas` as "greedy" (`grupo_empresas_greedy`), which pulls in every obra of that empresa not already listed explicitly.

## Data Schemas

**AP record**: `{ empresa, obra, data, fornecedor, banco, conta, categoria, valor, origem }`
- `origem`: `"A Confirmar" | "Emissao" | "Pago"`

**Receitas record**: `{ empresa, obra, cliente, tipo, data, data_venc, valor, status, banco, conta }`
- `status`: `"Recebida" | "A Receber"`

**Saldo record**: `{ empresa, banco, conta, data, saldo }`

**Fluxo-obras**: previsto (planned) values live in Postgres (`fluxo_planejamento`, per obra/ano/mes, plus a `fluxo_obra_global` target that the monthly sum must reconcile against — enforced server-side with a 422 on mismatch). Real (actual) values are computed on demand from the same Redis cache as AP/Receitas (filtered by `origem`/`status`), then optionally persisted per grupo/ano into `fluxo_real_cache` via the `POST .../real` endpoint so the UI can show a stable snapshot with an "updated at/by" meta.

## Key Conventions

- Currency is BRL; `formatCurrency()` in `frontend/src/lib/formatters.ts`.
- Dates in API responses are `DD/MM/YYYY` — use `parseDate()` in formatters.ts to parse.
- Company canonical mapping: `{1: 'COMBRASEN', 3: 'DRESDEN', 4: 'TRUST', 5: 'GAMA 01', 6: 'CONSÓRCIO HMSJ'}` (`EMPRESA_MAP` in `queries.py`).
- SQL queries use parameterized placeholders (`%s`), never f-strings.
- **Banco filter semantics**: Fluxo de Caixa uses permissive filter (empty banco on receitas passes through); Receitas page uses strict filter.
- Excel sync failures are always soft-ignored (logged as warning, never raises); SQL Server errors are also caught per-dataset in `sync_all()` so a single source failing doesn't block the others.
- Redis is the only source financeiro/fluxo-obras "real" endpoints read from — they never hit SQL Server directly; run `/api/sync` first if data looks stale.
- No test suite. Frontend has ESLint (`npm run lint`); backend has no linter.

## Deployment

CI/CD: push to `master` → GitHub Actions builds and pushes two images:
- `ghcr.io/rlstech/dashfinance-backend:latest`
- `ghcr.io/rlstech/dashfinance-frontend:latest`

Then SSH-deploys both services via `docker service update` (Swarm services `uaudash_backend`/`uaudash_frontend`), and polls `/api/sync` until it responds before considering the deploy done.

The app is publicly accessible at `https://dash.railton.eu.org` via Traefik (TLS via Let's Encrypt). PostgreSQL is not part of this stack's `docker-compose.yml` — it's a shared instance reached via `PG_DSN` (host `postgres_postgres` in production).

## Legacy Scripts

`_legacy/` contains pre-Flask tools (`export_data.py`, `inject_data.py`, `query_ap.py`, etc.) kept for reference only.
