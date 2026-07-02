import io
import logging
from datetime import datetime

import openpyxl
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from app.deps.auth import get_current_user, require_admin
from app.models.auth import UserOut
from app.models.schemas import (
    AtualizarFluxoRealIn,
    BulkImportResult,
    CustoFinanceiroCategoria,
    CustoFinanceiroCategoriaIn,
    CustoFinanceiroCategoriaLinha,
    CustoFinanceiroResponse,
    CustoFinanceiroSlot,
    DescricaoDisponivel,
    FluxoMesRow,
    FluxoPlanejamentoResponse,
    FluxoRealCachedResponse,
    FluxoRealCacheMeta,
    FluxoRealMes,
    FluxoRealResponse,
    GrupoTotaisPrevistos,
    GrupoTotaisReais,
    LancamentoConta,
    LancamentoDetalhe,
    PlanejamentoLogEntry,
    SaveObraPlanejamentoIn,
    SetLancamentoCategoriaIn,
)
from app.services import pg
from app.services.cache import get_cached

log = logging.getLogger(__name__)

router = APIRouter(prefix="/fluxo-obras", tags=["fluxo-obras"])


def _periodo_slots(
    ano_inicio: int, mes_inicio: int,
    ano_fim: int, mes_fim: int,
) -> list[tuple[int, int]]:
    slots: list[tuple[int, int]] = []
    ano, mes = ano_inicio, mes_inicio
    while (ano, mes) <= (ano_fim, mes_fim):
        slots.append((ano, mes))
        mes += 1
        if mes > 12:
            mes = 1
            ano += 1
    return slots


def _resolve_periodo(
    ano: int | None,
    ano_inicio: int | None, mes_inicio: int,
    ano_fim: int | None, mes_fim: int,
) -> tuple[int, int, int, int]:
    if ano_inicio is not None and ano_fim is not None:
        return ano_inicio, mes_inicio, ano_fim, mes_fim
    yr = ano or datetime.now().year
    return yr, 1, yr, 12


@router.get("/todas", response_model=list[FluxoPlanejamentoResponse])
async def get_todas(
    grupo_id: int,
    ano: int | None = None,
    ano_inicio: int | None = None,
    mes_inicio: int = 1,
    ano_fim: int | None = None,
    mes_fim: int = 12,
    user: UserOut = Depends(get_current_user),
):
    """Retorna o planejamento das obras para o período, escopado ao grupo."""
    if not await pg.is_grupo_visible_to_user(grupo_id, user.id, user.is_admin):
        raise HTTPException(status_code=403, detail="Sem acesso a este grupo")

    yi, mi, yf, mf = _resolve_periodo(ano, ano_inicio, mes_inicio, ano_fim, mes_fim)
    slots = _periodo_slots(yi, mi, yf, mf)
    anos = list(dict.fromkeys(s[0] for s in slots))

    tree = await get_cached("dash:filters:tree")
    if not tree:
        return []
    obras: list[str] = sorted({
        obra
        for obras_list in tree.get("obras_por_empresa", {}).values()
        for obra in obras_list
    })
    if not obras:
        return []

    # Fetch each year in one DB call, build lookup {yr: {obra: {mes: row}}}
    plano: dict[int, dict[str, dict[int, dict]]] = {}
    for yr in anos:
        bulk = await pg.get_planejamento_bulk(obras, yr, grupo_id)
        plano[yr] = {ob: {r["mes"]: r for r in rows} for ob, rows in bulk.items()}

    globais = await pg.get_obra_global(grupo_id, obras)

    return [
        FluxoPlanejamentoResponse(
            obra_codigo=obra,
            ano=yi,
            custo_global=globais.get(obra, {}).get("custo_global", 0.0),
            receita_global=globais.get(obra, {}).get("receita_global", 0.0),
            meses=[
                FluxoMesRow(
                    mes=mes,
                    ano=ano,
                    custo_previsto=float(plano.get(ano, {}).get(obra, {}).get(mes, {}).get("custo_previsto", 0)),
                    receita_prevista=float(plano.get(ano, {}).get(obra, {}).get(mes, {}).get("receita_prevista", 0)),
                    custo_real=0.0,
                    receita_realizada=0.0,
                )
                for (ano, mes) in slots
            ],
        )
        for obra in obras
    ]


@router.get("/grupos-totais-previstos", response_model=dict[int, GrupoTotaisPrevistos])
async def get_grupos_totais_previstos(
    ano: int | None = None,
    ano_inicio: int | None = None,
    mes_inicio: int = 1,
    ano_fim: int | None = None,
    mes_fim: int = 12,
    user: UserOut = Depends(get_current_user),
):
    """Totais de custo/receita previstos por grupo visível, para a galeria de cards."""
    yi, mi, yf, mf = _resolve_periodo(ano, ano_inicio, mes_inicio, ano_fim, mes_fim)
    slots = _periodo_slots(yi, mi, yf, mf)
    grupos = await pg.get_grupos(user.id, user.is_admin)
    grupo_ids = [g["id"] for g in grupos]
    totais = await pg.get_grupos_planejamento_totais(grupo_ids, slots)
    return {
        gid: GrupoTotaisPrevistos(custo_prev=t["custo_prev"], receita_prev=t["receita_prev"])
        for gid, t in totais.items()
    }


@router.get("/planejamento", response_model=FluxoPlanejamentoResponse)
async def get_planejamento(
    obra_codigo: str,
    ano: int,
    _: UserOut = Depends(get_current_user),
):
    rows = await pg.get_planejamento(obra_codigo, ano)
    meses = [
        FluxoMesRow(
            mes=r["mes"],
            custo_previsto=float(r["custo_previsto"]),
            receita_prevista=float(r["receita_prevista"]),
            custo_real=0.0,         # TODO: query UAU
            receita_realizada=0.0,  # TODO: query UAU
        )
        for r in rows
    ]
    return FluxoPlanejamentoResponse(obra_codigo=obra_codigo, ano=ano, meses=meses)


def _parse_mes(data_str: str, ano: int) -> int | None:
    try:
        dt = datetime.strptime(data_str, "%d/%m/%Y")
        return dt.month if dt.year == ano else None
    except (ValueError, TypeError):
        return None


async def _compute_real_for_obras(
    obras: list[str], ano: int,
    origens: list[str], status_rec: list[str],
    mes_inicio: int = 1, mes_fim: int = 12,
) -> dict[str, dict[int, dict[str, float]]]:
    """Agrega custo_real e receita_realizada por (obra, mes) a partir do Redis."""
    if not obras:
        return {}
    obras_set = set(obras)
    origens_set = set(origens)
    status_rec_set = set(status_rec)

    ap_data: list[dict] = await get_cached("dash:ap:all") or []
    receitas_data: list[dict] = await get_cached("dash:receitas:all") or []

    by_obra: dict[str, dict[int, dict[str, float]]] = {
        obra: {m: {"custo_real": 0.0, "receita_realizada": 0.0} for m in range(mes_inicio, mes_fim + 1)}
        for obra in obras
    }

    for item in ap_data:
        if item.get("origem") not in origens_set:
            continue
        obra = str(item.get("obra", ""))
        if obra not in obras_set:
            continue
        mes = _parse_mes(item.get("data", ""), ano)
        if mes is None or mes not in by_obra.get(obra, {}):
            continue
        by_obra[obra][mes]["custo_real"] += float(item.get("valor", 0))

    for item in receitas_data:
        if item.get("status") not in status_rec_set:
            continue
        obra = str(item.get("obra", ""))
        if obra not in obras_set:
            continue
        mes = _parse_mes(item.get("data", ""), ano)
        if mes is None or mes not in by_obra.get(obra, {}):
            continue
        by_obra[obra][mes]["receita_realizada"] += float(item.get("valor", 0))

    return by_obra


def _build_real_response(
    obras: list[str],
    slots: list[tuple[int, int]],
    by_obra_by_year: dict[int, dict[str, dict[int, dict[str, float]]]],
) -> list[FluxoRealResponse]:
    ano_inicio = slots[0][0] if slots else 0
    return [
        FluxoRealResponse(
            obra_codigo=obra,
            ano=ano_inicio,
            meses=[
                FluxoRealMes(
                    mes=mes,
                    ano=ano,
                    custo_real=by_obra_by_year.get(ano, {}).get(obra, {}).get(mes, {}).get("custo_real", 0.0),
                    receita_realizada=by_obra_by_year.get(ano, {}).get(obra, {}).get(mes, {}).get("receita_realizada", 0.0),
                )
                for (ano, mes) in slots
            ],
        )
        for obra in obras
    ]


def _resolve_greedy_obras(
    empresas_greedy: list[str], tree: dict, obras_diretas: set[str],
) -> list[str]:
    """Obras das empresas greedy que não pertencem ao grupo."""
    if not empresas_greedy or not tree:
        return []
    obras_por_empresa: dict = tree.get("obras_por_empresa", {})
    greedy: set[str] = set()
    for emp in empresas_greedy:
        for obra in obras_por_empresa.get(emp, []):
            if obra not in obras_diretas:
                greedy.add(obra)
    return sorted(greedy)


@router.get("/real", response_model=list[FluxoRealResponse])
async def get_real(
    ano: int,
    origens: list[str] = Query(default=["Pago"]),
    status_rec: list[str] = Query(default=["Recebida"]),
    _: UserOut = Depends(get_current_user),
):
    """Retorna custo real e receita realizada por obra/mês a partir do cache Redis."""
    tree = await get_cached("dash:filters:tree")
    if not tree:
        return []
    obras: list[str] = sorted({
        obra
        for obras_list in tree.get("obras_por_empresa", {}).values()
        for obra in obras_list
    })
    if not obras:
        return []
    by_obra = await _compute_real_for_obras(obras, ano, origens, status_rec)
    slots = _periodo_slots(ano, 1, ano, 12)
    return _build_real_response(obras, slots, {ano: by_obra})


# ── Cache persistido por grupo ───────────────────────────────────────────────

@router.get("/grupo/{grupo_id}/real", response_model=FluxoRealCachedResponse)
async def get_grupo_real_cache(
    grupo_id: int,
    ano: int | None = None,
    ano_inicio: int | None = None,
    mes_inicio: int = 1,
    ano_fim: int | None = None,
    mes_fim: int = 12,
    user: UserOut = Depends(get_current_user),
):
    """Retorna o snapshot persistido do grupo/período. Vazio se nunca atualizado."""
    if not await pg.is_grupo_visible_to_user(grupo_id, user.id, user.is_admin):
        raise HTTPException(status_code=403, detail="Sem acesso a este grupo")

    yi, mi, yf, mf = _resolve_periodo(ano, ano_inicio, mes_inicio, ano_fim, mes_fim)
    slots = _periodo_slots(yi, mi, yf, mf)
    anos = list(dict.fromkeys(s[0] for s in slots))

    # Busca cache de cada ano
    rows_by_year: dict[int, list[dict]] = {}
    metas: dict[int, dict | None] = {}
    for yr in anos:
        rows, meta = await pg.get_fluxo_real_cache(grupo_id, yr)
        rows_by_year[yr] = rows
        metas[yr] = meta

    valid_metas = [(yr, m) for yr, m in metas.items() if m is not None]
    if not valid_metas:
        return FluxoRealCachedResponse(data=[], meta=None)

    # Monta by_obra_by_year
    by_obra_by_year: dict[int, dict[str, dict[int, dict[str, float]]]] = {}
    obras_set: set[str] = set()
    for yr, rows in rows_by_year.items():
        by_obra_by_year[yr] = {}
        for r in rows:
            obra = r["obra_codigo"]
            obras_set.add(obra)
            by_obra_by_year[yr].setdefault(obra, {})[r["mes"]] = {
                "custo_real": float(r["custo_real"]),
                "receita_realizada": float(r["receita_realizada"]),
            }

    obras = sorted(obras_set)
    data = _build_real_response(obras, slots, by_obra_by_year)

    _, latest_meta = max(valid_metas, key=lambda x: x[1]["updated_at"])
    anos_cobertos = [yr for yr, _ in sorted(valid_metas)]

    meta = FluxoRealCacheMeta(
        updated_at=latest_meta["updated_at"],
        updated_by=latest_meta.get("updated_by"),
        updated_by_name=latest_meta.get("updated_by_name"),
        origens=list(latest_meta.get("origens") or []),
        status_rec=list(latest_meta.get("status_rec") or []),
        anos_cobertos=anos_cobertos,
    )
    return FluxoRealCachedResponse(data=data, meta=meta)


@router.post("/grupo/{grupo_id}/real", response_model=FluxoRealCachedResponse)
async def atualizar_grupo_real(
    grupo_id: int,
    body: AtualizarFluxoRealIn,
    ano: int | None = None,
    ano_inicio: int | None = None,
    mes_inicio: int = 1,
    ano_fim: int | None = None,
    mes_fim: int = 12,
    user: UserOut = Depends(get_current_user),
):
    """Recomputa dados reais para as obras do grupo (e greedy), persiste e devolve."""
    if not await pg.can_user_edit_grupo(grupo_id, user.id, user.is_admin):
        raise HTTPException(status_code=403, detail="Sem permissão de edição neste grupo")

    yi, mi, yf, mf = _resolve_periodo(ano, ano_inicio, mes_inicio, ano_fim, mes_fim)
    slots = _periodo_slots(yi, mi, yf, mf)
    anos = list(dict.fromkeys(s[0] for s in slots))

    obras_diretas, empresas_greedy = await pg.get_grupo_obras_e_greedy(grupo_id)
    tree = await get_cached("dash:filters:tree") or {}
    greedy_obras = _resolve_greedy_obras(empresas_greedy, tree, set(obras_diretas))
    todas_obras = sorted(set(obras_diretas) | set(greedy_obras))

    by_obra_by_year: dict[int, dict[str, dict[int, dict[str, float]]]] = {}
    last_meta: dict | None = None

    for yr in anos:
        yr_mi = mi if yr == yi else 1
        yr_mf = mf if yr == yf else 12
        by_obra = await _compute_real_for_obras(
            todas_obras, yr, body.origens, body.status_rec, yr_mi, yr_mf,
        )
        by_obra_by_year[yr] = by_obra

        rows_to_save: list[dict] = []
        for obra, by_mes in by_obra.items():
            for mes, vals in by_mes.items():
                if vals["custo_real"] == 0 and vals["receita_realizada"] == 0:
                    continue
                rows_to_save.append({
                    "obra_codigo": obra,
                    "mes": mes,
                    "custo_real": vals["custo_real"],
                    "receita_realizada": vals["receita_realizada"],
                })
        last_meta = await pg.save_fluxo_real_cache(
            grupo_id, yr, user.id, rows_to_save, body.origens, body.status_rec,
        )

    data = _build_real_response(todas_obras, slots, by_obra_by_year)
    meta = FluxoRealCacheMeta(
        updated_at=last_meta["updated_at"],
        updated_by=last_meta.get("updated_by"),
        updated_by_name=last_meta.get("updated_by_name"),
        origens=list(last_meta.get("origens") or []),
        status_rec=list(last_meta.get("status_rec") or []),
        anos_cobertos=anos,
    )
    return FluxoRealCachedResponse(data=data, meta=meta)


@router.get("/grupos-totais-reais", response_model=dict[int, GrupoTotaisReais])
async def get_grupos_totais_reais(
    ano: int,
    user: UserOut = Depends(get_current_user),
):
    """Totais reais (sum) por grupo visível, para alimentar a galeria de cards."""
    grupos = await pg.get_grupos(user.id, user.is_admin)
    grupo_ids = [g["id"] for g in grupos]
    totais = await pg.get_grupos_real_totais(grupo_ids, ano)
    return {
        gid: GrupoTotaisReais(
            custo_real=t["custo_real"],
            receita_realizada=t["receita_realizada"],
            updated_at=t["updated_at"],
            origens=t["origens"],
            status_rec=t["status_rec"],
        )
        for gid, t in totais.items()
    }


@router.post("/grupo/{grupo_id}/obra/{obra_codigo}/planejamento", status_code=204)
async def save_obra_planejamento(
    grupo_id: int,
    obra_codigo: str,
    body: SaveObraPlanejamentoIn,
    user: UserOut = Depends(get_current_user),
):
    """Salva o previsto de uma obra (todos os meses + valor global).

    Valida que a soma dos meses bate com o valor global (custo e receita);
    caso contrário retorna 422 com a divergência.
    """
    if not await pg.can_user_edit_grupo(grupo_id, user.id, user.is_admin):
        raise HTTPException(status_code=403, detail="Sem permissão de edição neste grupo")

    soma_custo = round(sum(m.custo_previsto for m in body.meses), 2)
    soma_receita = round(sum(m.receita_prevista for m in body.meses), 2)
    custo_global = round(body.custo_global, 2)
    receita_global = round(body.receita_global, 2)

    erros: list[dict] = []
    if abs(soma_custo - custo_global) > 0.01:
        erros.append({
            "campo": "custo_previsto",
            "global": custo_global, "soma": soma_custo,
            "divergencia": round(soma_custo - custo_global, 2),
        })
    if abs(soma_receita - receita_global) > 0.01:
        erros.append({
            "campo": "receita_prevista",
            "global": receita_global, "soma": soma_receita,
            "divergencia": round(soma_receita - receita_global, 2),
        })
    if erros:
        raise HTTPException(
            status_code=422,
            detail={"message": "Soma dos meses diferente do valor global", "erros": erros},
        )

    await pg.save_obra_planejamento(
        grupo_id, obra_codigo, user.id,
        custo_global, receita_global,
        [m.model_dump() for m in body.meses],
    )


@router.get(
    "/grupo/{grupo_id}/obra/{obra_codigo}/logs",
    response_model=list[PlanejamentoLogEntry],
)
async def get_obra_logs(
    grupo_id: int,
    obra_codigo: str,
    user: UserOut = Depends(get_current_user),
):
    if not await pg.is_grupo_visible_to_user(grupo_id, user.id, user.is_admin):
        raise HTTPException(status_code=403, detail="Sem acesso a este grupo")
    rows = await pg.get_obra_logs(grupo_id, obra_codigo)
    return [PlanejamentoLogEntry(**r) for r in rows]


@router.post("/planejamento/importar", response_model=BulkImportResult)
async def importar_planilha(
    grupo_id: int,
    file: UploadFile = File(...),
    user: UserOut = Depends(get_current_user),
):
    """
    Importa .xlsx com colunas: obra_codigo | ano | mes | custo_previsto | receita_prevista
    Primeira linha = cabeçalho; linhas seguintes = dados. Escopado ao grupo informado.
    """
    if not await pg.can_user_edit_grupo(grupo_id, user.id, user.is_admin):
        raise HTTPException(status_code=403, detail="Sem permissão de edição neste grupo")
    if not (file.filename or "").endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Apenas arquivos .xlsx são aceitos")

    contents = await file.read()
    errors: list[str] = []
    items: list[dict] = []

    try:
        wb = openpyxl.load_workbook(io.BytesIO(contents), read_only=True, data_only=True)
        rows = list(wb.active.iter_rows(values_only=True))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Erro ao ler planilha: {e}")

    for i, row in enumerate(rows[1:], start=2):
        try:
            obra_codigo, ano, mes, custo_previsto, receita_prevista = row[:5]
            item = {
                "obra_codigo": str(obra_codigo).strip(),
                "ano": int(ano),
                "mes": int(mes),
                "custo_previsto": float(custo_previsto or 0),
                "receita_prevista": float(receita_prevista or 0),
            }
            if not 1 <= item["mes"] <= 12:
                errors.append(f"Linha {i}: mes={item['mes']} inválido")
                continue
            items.append(item)
        except Exception as e:
            errors.append(f"Linha {i}: {e}")

    count = await pg.bulk_upsert_planejamento(grupo_id, items)
    return BulkImportResult(imported=count, errors=errors)


async def _empresas_visiveis_custo_financeiro(grupo_id: int, user: UserOut) -> set[str]:
    from app.services.queries import EMPRESA_MAP

    empresas: set[str] = set(EMPRESA_MAP.values()) if user.is_admin else set(user.empresas)
    custo_financeiro_empresas = await pg.get_grupo_custo_financeiro_empresas(grupo_id)
    if custo_financeiro_empresas:
        empresas &= set(custo_financeiro_empresas)
    return empresas


async def _contas_transferencias_visiveis(grupo_id: int) -> set[tuple[str, str, str]] | None:
    """Contas (empresa, banco, conta) permitidas para Transferências Bancárias no grupo.
    None = sem filtro adicional (todas as contas das empresas visíveis)."""
    contas = await pg.get_grupo_custo_financeiro_contas(grupo_id)
    if not contas:
        return None
    return {(c["empresa"], c["banco"], c["conta"]) for c in contas}


async def _lancamentos_classificados(
    empresas_visiveis: set[str],
    contas_transferencias: set[tuple[str, str, str]] | None = None,
    slots_set: set[tuple[int, int]] | None = None,
) -> tuple[list[dict], list[dict]]:
    """Carrega transferências + controle financeiro do Redis e resolve a categoria de cada lançamento
    (override manual > regra por descrição > não classificado)."""
    transf_raw: list[dict] = await get_cached("dash:transferencias:all") or []
    controle_raw: list[dict] = await get_cached("dash:controle:all") or []

    categorias = await pg.get_custo_financeiro_categorias()
    regra_map: dict[tuple[str, str], int] = {}
    for cat in categorias:
        for d in cat["descricoes"]:
            regra_map[(d["tipo"], d["descricao"])] = cat["id"]
    overrides = await pg.get_custo_financeiro_overrides()

    out: list[dict] = []
    for item in transf_raw + controle_raw:
        if item.get("empresa") not in empresas_visiveis:
            continue
        if (
            contas_transferencias is not None
            and item["tipo"] == "transferencia"
            and (item["empresa"], item["banco"], item["conta"]) not in contas_transferencias
        ):
            continue
        try:
            dt = datetime.strptime(item["data"], "%d/%m/%Y")
        except (ValueError, TypeError):
            continue
        if slots_set is not None and (dt.year, dt.month) not in slots_set:
            continue
        categoria_id = overrides.get(item["id"]) or regra_map.get((item["tipo"], item["descricao"]))
        out.append({**item, "categoria_id": categoria_id, "_dt": dt})
    return out, categorias


@router.get("/custo-financeiro", response_model=CustoFinanceiroResponse)
async def get_custo_financeiro(
    grupo_id: int,
    ano: int | None = None,
    ano_inicio: int | None = None,
    mes_inicio: int = 1,
    ano_fim: int | None = None,
    mes_fim: int = 12,
    user: UserOut = Depends(get_current_user),
):
    """Tesouraria consolidada: transferências bancárias + controle financeiro, classificados por
    categoria, mês a mês, escopado às empresas do grupo."""
    if not await pg.is_grupo_visible_to_user(grupo_id, user.id, user.is_admin):
        raise HTTPException(status_code=403, detail="Sem acesso a este grupo")

    yi, mi, yf, mf = _resolve_periodo(ano, ano_inicio, mes_inicio, ano_fim, mes_fim)
    slots = _periodo_slots(yi, mi, yf, mf)
    slots_set: set[tuple[int, int]] = set(slots)
    slot_index: dict[tuple[int, int], int] = {s: i for i, s in enumerate(slots)}
    n = len(slots)

    empresas_visiveis = await _empresas_visiveis_custo_financeiro(grupo_id, user)
    contas_transferencias = await _contas_transferencias_visiveis(grupo_id)
    lancamentos, categorias = await _lancamentos_classificados(empresas_visiveis, contas_transferencias, slots_set)

    valores_por_categoria: dict[int | None, list[float]] = {}
    total_entradas = 0.0
    total_saidas = 0.0
    for lc in lancamentos:
        idx = slot_index[(lc["_dt"].year, lc["_dt"].month)]
        cat_id = lc["categoria_id"]
        valores_por_categoria.setdefault(cat_id, [0.0] * n)[idx] += (
            lc["valor"] if lc["sentido"] == "entrada" else -lc["valor"]
        )
        if lc["sentido"] == "entrada":
            total_entradas += lc["valor"]
        else:
            total_saidas += lc["valor"]

    cat_by_id = {c["id"]: c for c in categorias}
    linhas: list[CustoFinanceiroCategoriaLinha] = []
    for cat_id, vals in valores_por_categoria.items():
        if not any(v != 0 for v in vals):
            continue
        if cat_id is None:
            nome, sinal = "Não Classificado", None
        else:
            cat = cat_by_id.get(cat_id)
            if cat is None:
                continue  # categoria removida entre a classificação e a leitura
            nome, sinal = cat["nome"], cat["sinal"]
        linhas.append(CustoFinanceiroCategoriaLinha(
            categoria_id=cat_id, nome=nome, sinal=sinal, valores=vals, total=sum(vals),
        ))

    ordem_map = {c["id"]: c["ordem"] for c in categorias}
    linhas.sort(key=lambda l: (l.categoria_id is None, ordem_map.get(l.categoria_id, 0)))

    return CustoFinanceiroResponse(
        meses=[CustoFinanceiroSlot(ano=a, mes=m) for a, m in slots],
        categorias=linhas,
        total_entradas=total_entradas,
        total_saidas=total_saidas,
        fluxo_liquido=total_entradas - total_saidas,
    )


@router.get("/custo-financeiro/lancamentos", response_model=list[LancamentoDetalhe])
async def get_custo_financeiro_lancamentos(
    grupo_id: int,
    categoria_id: int = 0,  # 0 = Não Classificado
    ano: int | None = None,
    ano_inicio: int | None = None,
    mes_inicio: int = 1,
    ano_fim: int | None = None,
    mes_fim: int = 12,
    user: UserOut = Depends(get_current_user),
):
    """Detalha os lançamentos de uma categoria (ou não classificados) no período, para o grupo informado."""
    if not await pg.is_grupo_visible_to_user(grupo_id, user.id, user.is_admin):
        raise HTTPException(status_code=403, detail="Sem acesso a este grupo")

    yi, mi, yf, mf = _resolve_periodo(ano, ano_inicio, mes_inicio, ano_fim, mes_fim)
    slots_set = set(_periodo_slots(yi, mi, yf, mf))

    empresas_visiveis = await _empresas_visiveis_custo_financeiro(grupo_id, user)
    contas_transferencias = await _contas_transferencias_visiveis(grupo_id)
    lancamentos, _ = await _lancamentos_classificados(empresas_visiveis, contas_transferencias, slots_set)

    alvo = categoria_id or None
    filtrados = sorted(
        (lc for lc in lancamentos if lc["categoria_id"] == alvo),
        key=lambda lc: lc["_dt"],
    )

    return [
        LancamentoDetalhe(
            id=lc["id"],
            tipo=lc["tipo"],
            data=lc["data"],
            descricao=lc["descricao"],
            valor=lc["valor"],
            sentido=lc["sentido"],
            origem=lc.get("origem"),
            destino=lc.get("destino"),
            banco=lc["banco"],
            conta=lc["conta"],
            categoria_id=lc["categoria_id"],
        )
        for lc in filtrados
    ]


@router.post("/custo-financeiro/lancamentos/{lancamento_id}/categoria", status_code=204)
async def set_custo_financeiro_lancamento_categoria(
    lancamento_id: str,
    body: SetLancamentoCategoriaIn,
    user: UserOut = Depends(require_admin),
):
    """Reclassifica manualmente um lançamento (transferência ou controle financeiro) para outra categoria."""
    await pg.set_lancamento_categoria(lancamento_id, body.categoria_id, user.id)


@router.get("/custo-financeiro/descricoes", response_model=list[DescricaoDisponivel])
async def get_custo_financeiro_descricoes(user: UserOut = Depends(require_admin)):
    """Lista as descrições/naturezas distintas presentes nos dados, com a categoria já atribuída (se houver)
    e o sinal observado nos lançamentos (entrada, saída ou mista). Usado para montar a UI de gerenciamento
    de categorias e orientar o usuário sobre a que sinal cada descrição costuma pertencer."""
    transf_raw: list[dict] = await get_cached("dash:transferencias:all") or []
    controle_raw: list[dict] = await get_cached("dash:controle:all") or []

    categorias = await pg.get_custo_financeiro_categorias()
    regra_map: dict[tuple[str, str], int] = {}
    for cat in categorias:
        for d in cat["descricoes"]:
            regra_map[(d["tipo"], d["descricao"])] = cat["id"]

    sentidos_por_desc: dict[tuple[str, str], set[str]] = {}
    for item in transf_raw + controle_raw:
        key = (item["tipo"], item["descricao"])
        sentidos_por_desc.setdefault(key, set()).add(item["sentido"])

    out: list[DescricaoDisponivel] = []
    for key, sentidos in sentidos_por_desc.items():
        sentido = sentidos.pop() if len(sentidos) == 1 else "mista"
        out.append(DescricaoDisponivel(
            tipo=key[0], descricao=key[1], categoria_id=regra_map.get(key), sentido=sentido,
        ))
    out.sort(key=lambda d: (d.tipo, d.descricao))
    return out


@router.get("/custo-financeiro/descricao-lancamentos", response_model=list[LancamentoDetalhe])
async def get_custo_financeiro_descricao_lancamentos(
    tipo: str, descricao: str, user: UserOut = Depends(require_admin),
):
    """Prévia dos lançamentos brutos de uma descrição específica, independente de já estar classificada
    em categoria — ajuda a decidir a categoria e o sinal corretos antes de salvar a regra."""
    transf_raw: list[dict] = await get_cached("dash:transferencias:all") or []
    controle_raw: list[dict] = await get_cached("dash:controle:all") or []

    categorias = await pg.get_custo_financeiro_categorias()
    regra_map: dict[tuple[str, str], int] = {}
    for cat in categorias:
        for d in cat["descricoes"]:
            regra_map[(d["tipo"], d["descricao"])] = cat["id"]
    overrides = await pg.get_custo_financeiro_overrides()

    def _dt(item: dict) -> datetime:
        try:
            return datetime.strptime(item["data"], "%d/%m/%Y")
        except (ValueError, TypeError):
            return datetime.min

    matched = [
        item for item in (transf_raw + controle_raw)
        if item["tipo"] == tipo and item["descricao"] == descricao
    ]
    matched.sort(key=_dt, reverse=True)
    matched = matched[:200]

    return [
        LancamentoDetalhe(
            id=item["id"],
            tipo=item["tipo"],
            data=item["data"],
            descricao=item["descricao"],
            valor=item["valor"],
            sentido=item["sentido"],
            origem=item.get("origem"),
            destino=item.get("destino"),
            banco=item["banco"],
            conta=item["conta"],
            categoria_id=overrides.get(item["id"]) or regra_map.get((item["tipo"], item["descricao"])),
        )
        for item in matched
    ]


@router.get("/custo-financeiro/transferencias-contas", response_model=list[LancamentoConta])
async def get_custo_financeiro_transferencias_contas(user: UserOut = Depends(get_current_user)):
    """Lista as contas (empresa, banco, conta) distintas presentes nos dados de Transferências Bancárias,
    escopadas às empresas do usuário (admin vê todas), usada para montar a UI de seleção de contas
    consideradas por grupo."""
    from app.services.queries import EMPRESA_MAP

    empresas_visiveis = set(EMPRESA_MAP.values()) if user.is_admin else set(user.empresas)
    transf_raw: list[dict] = await get_cached("dash:transferencias:all") or []
    vistos: set[tuple[str, str, str]] = set()
    out: list[LancamentoConta] = []
    for item in transf_raw:
        if item["empresa"] not in empresas_visiveis:
            continue
        key = (item["empresa"], item["banco"], item["conta"])
        if key in vistos:
            continue
        vistos.add(key)
        out.append(LancamentoConta(empresa=key[0], banco=key[1], conta=key[2]))
    out.sort(key=lambda c: (c.empresa, c.banco, c.conta))
    return out


@router.get("/custo-financeiro/categorias", response_model=list[CustoFinanceiroCategoria])
async def list_custo_financeiro_categorias(user: UserOut = Depends(get_current_user)):
    return await pg.get_custo_financeiro_categorias()


@router.post("/custo-financeiro/categorias", response_model=CustoFinanceiroCategoria, status_code=201)
async def create_custo_financeiro_categoria(
    body: CustoFinanceiroCategoriaIn, user: UserOut = Depends(require_admin),
):
    return await pg.create_custo_financeiro_categoria(
        body.nome, body.sinal, body.ordem, user.id,
        [d.model_dump() for d in body.descricoes],
    )


@router.put("/custo-financeiro/categorias/{categoria_id}", response_model=CustoFinanceiroCategoria)
async def update_custo_financeiro_categoria(
    categoria_id: int, body: CustoFinanceiroCategoriaIn, user: UserOut = Depends(require_admin),
):
    result = await pg.update_custo_financeiro_categoria(
        categoria_id, body.nome, body.sinal, body.ordem, user.id,
        [d.model_dump() for d in body.descricoes],
    )
    if not result:
        raise HTTPException(status_code=404, detail="Categoria não encontrada")
    return result


@router.delete("/custo-financeiro/categorias/{categoria_id}", status_code=204)
async def delete_custo_financeiro_categoria(categoria_id: int, user: UserOut = Depends(require_admin)):
    await pg.delete_custo_financeiro_categoria(categoria_id)
