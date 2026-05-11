# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DashFinance is a financial dashboard for UAU, monitoring Accounts Payable (AP), Revenues, and Cash Flow. It runs as a Docker Swarm stack (4 services: backend, frontend, redis, postgres) behind Traefik and connects to a Microsoft SQL Server.

## Architecture

```
Browser → Nginx (frontend React SPA) → /api/* → FastAPI (backend) → Redis cache
                                                                   ↕ on /api/sync
                                                               queries.py → SQL Server
                                                               excel.py  → SMB share
                                                               pg.py     → PostgreSQL (auth + config)
```

**`backend/`** — FastAPI app (Python 3.12):
- `app/main.py` — FastAPI app with CORS, lifespan (PostgreSQL pool init + APScheduler + initial sync)
- `app/config.py` — Pydantic BaseSettings (all env vars)
- `app/api/` — routers: `auth.py` (login/me), `admin.py` (user CRUD), `financeiro.py` (data endpoints, auth-gated), `sync.py` (sync/status), `filters.py` (filter tree), `config_api.py` (saldo config)
- `app/deps/auth.py` — `get_current_user` and `require_admin` FastAPI dependencies
- `app/services/database.py` — pymssql connection pool (SQL Server)
- `app/services/pg.py` — asyncpg connection pool (PostgreSQL); owns `users`, `user_empresas`, `saldo_config` tables; auto-creates schema on startup
- `app/services/cache.py` — async Redis client
- `app/services/queries.py` — exact SQL queries (get_ap, get_receitas, get_saldo_banco)
- `app/services/sync.py` — sync_all() merges SQL Server + Excel data into Redis; APScheduler
- `app/services/excel.py` — reads COMBRASEN and GAMA 01 Cash Flow Excel files via SMB (pysmb + openpyxl)
- `app/models/auth.py` — Pydantic models for auth (UserOut, Token, UserCreate, UserUpdate, SaldoConfigIn/Out)

**`frontend/`** — React 18 + Vite 5 + TypeScript SPA:
- `src/App.tsx` — React Router v6; routes: `/login`, `/receitas`, `/despesas`, `/fluxo`, `/config`, `/admin`
- `src/pages/` — Login, Receitas, Despesas (formerly ContasAPagar), FluxoCaixa, Configuracoes, Admin
- `src/hooks/useAuth.ts` — Zustand store (persisted as `dashfinance-auth-v1`) + `loginRequest()`
- `src/hooks/useFilters.ts` — Zustand (filter state)
- `src/hooks/useFinanceiro.ts` — TanStack Query hooks for all API calls including auth-aware ones
- `src/components/auth/ProtectedRoute.tsx` — redirects to `/login`; `requireAdmin` prop for admin-only routes
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
npm run dev   # dev server on :5173, proxies /api → localhost:8000
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

## Authorization Model

- Every user has an `empresas: list[str]` field (company names, e.g. `"COMBRASEN"`, `"GAMA 01"`).
- Non-admin users see only records where `record["empresa"] in user.empresas`.
- `require_admin` dependency enforces `user.is_admin == True`; otherwise 403.
- JWT payload: `{"sub": "<user_id>", "exp": ...}`, HS256.

## Data Schemas

**AP record**: `{ empresa, obra, data, fornecedor, banco, conta, categoria, valor, origem }`
- `origem`: `"A Confirmar" | "Emissao" | "Pago"`

**Receitas record**: `{ empresa, obra, cliente, tipo, data, data_venc, valor, status, banco, conta }`
- `status`: `"Recebida" | "A Receber"`

**Saldo record**: `{ empresa, banco, conta, data, saldo }`

## Key Conventions

- Currency is BRL; `formatCurrency()` in `frontend/src/lib/formatters.ts`.
- Dates in API responses are `DD/MM/YYYY` — use `parseDate()` in formatters.ts to parse.
- Company canonical mapping: `{1: 'COMBRASEN', 3: 'DRESDEN', 4: 'TRUST', 5: 'GAMA 01', 6: 'CONSÓRCIO HMSJ'}`.
- SQL queries use parameterized placeholders (`%s`), never f-strings.
- **Banco filter semantics**: Fluxo de Caixa uses permissive filter (empty banco on receitas passes through); Receitas page uses strict filter.
- Excel sync failures are always soft-ignored (logged as warning, never raises); SQL Server errors are also caught per-dataset.
- No test suite, no linter.

## Deployment

CI/CD: push to `master` → GitHub Actions builds and pushes two images:
- `ghcr.io/rlstech/dashfinance-backend:latest`
- `ghcr.io/rlstech/dashfinance-frontend:latest`

Then SSH-deploys both services via `docker service update`.

The app is publicly accessible at `https://dash.railton.eu.org` via Traefik (TLS via Let's Encrypt).

## Legacy Scripts

`_legacy/` contains pre-Flask tools (`export_data.py`, `inject_data.py`, `query_ap.py`, etc.) kept for reference only.
