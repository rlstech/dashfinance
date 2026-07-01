import io
import logging
from datetime import datetime

import openpyxl
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from app.deps.auth import get_current_user
from app.models.auth import UserOut
from app.models.schemas import (
    AtualizarFluxoRealIn,
    BulkImportResult,
    CustoFinanceiroLinha,
    CustoFinanceiroResponse,
    CustoFinanceiroSlot,
    FluxoMesRow,
    FluxoPlanejamentoResponse,
    FluxoRealCachedResponse,
    FluxoRealCacheMeta,
    FluxoRealMes,
    FluxoRealResponse,
    GrupoTotaisPrevistos,
    GrupoTotaisReais,
    PlanejamentoLogEntry,
    SaveObraPlanejamentoIn,
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


@router.get("/custo-financeiro", response_model=CustoFinanceiroResponse)
async def get_custo_financeiro(
    ano: int | None = None,
    ano_inicio: int | None = None,
    mes_inicio: int = 1,
    ano_fim: int | None = None,
    mes_fim: int = 12,
    user: UserOut = Depends(get_current_user),
):
    """Tesouraria consolidada: transferências bancárias + controle financeiro, mês a mês."""
    from app.services.queries import EMPRESA_MAP

    yi, mi, yf, mf = _resolve_periodo(ano, ano_inicio, mes_inicio, ano_fim, mes_fim)
    slots = _periodo_slots(yi, mi, yf, mf)

    empresas_visiveis: set[str] = (
        set(EMPRESA_MAP.values()) if user.is_admin else set(user.empresas)
    )

    slots_set: set[tuple[int, int]] = set(slots)
    slot_index: dict[tuple[int, int], int] = {s: i for i, s in enumerate(slots)}
    n = len(slots)

    transf_raw: list[dict] = await get_cached("dash:transferencias:all") or []
    controle_raw: list[dict] = await get_cached("dash:controle:all") or []

    def _aggregate(
        records: list[dict],
    ) -> tuple[dict[str, list[float]], float, float]:
        by_desc: dict[str, list[float]] = {}
        total_ent = 0.0
        total_sai = 0.0
        for item in records:
            if item.get("empresa") not in empresas_visiveis:
                continue
            try:
                dt = datetime.strptime(item["data"], "%d/%m/%Y")
            except (ValueError, TypeError):
                continue
            slot = (dt.year, dt.month)
            if slot not in slots_set:
                continue
            desc = item.get("descricao") or "S/Descrição"
            valor = float(item.get("valor") or 0)
            sentido = item.get("sentido", "saida")
            net = valor if sentido == "entrada" else -valor
            if desc not in by_desc:
                by_desc[desc] = [0.0] * n
            by_desc[desc][slot_index[slot]] += net
            if sentido == "entrada":
                total_ent += valor
            else:
                total_sai += valor
        return by_desc, total_ent, total_sai

    transf_by_desc, t_ent, t_sai = _aggregate(transf_raw)
    ctrl_by_desc, c_ent, c_sai = _aggregate(controle_raw)

    def _to_linhas(by_desc: dict[str, list[float]]) -> list[CustoFinanceiroLinha]:
        linhas = [
            CustoFinanceiroLinha(descricao=desc, valores=vals, total=sum(vals))
            for desc, vals in by_desc.items()
            if any(v != 0 for v in vals)
        ]
        linhas.sort(key=lambda l: abs(l.total), reverse=True)
        return linhas

    total_entradas = t_ent + c_ent
    total_saidas = t_sai + c_sai

    return CustoFinanceiroResponse(
        meses=[CustoFinanceiroSlot(ano=a, mes=m) for a, m in slots],
        transferencias=_to_linhas(transf_by_desc),
        controle=_to_linhas(ctrl_by_desc),
        total_entradas=total_entradas,
        total_saidas=total_saidas,
        fluxo_liquido=total_entradas - total_saidas,
    )
