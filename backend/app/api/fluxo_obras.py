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
    FluxoMesRow,
    FluxoPlanejamentoResponse,
    FluxoRealCachedResponse,
    FluxoRealCacheMeta,
    FluxoRealMes,
    FluxoRealResponse,
    GrupoTotaisReais,
    UpsertPlanejamentoIn,
)
from app.services import pg
from app.services.cache import get_cached

log = logging.getLogger(__name__)

router = APIRouter(prefix="/fluxo-obras", tags=["fluxo-obras"])


@router.get("/todas", response_model=list[FluxoPlanejamentoResponse])
async def get_todas(ano: int, _: UserOut = Depends(get_current_user)):
    """Retorna planejamento de todas as obras conhecidas para o ano dado."""
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
    bulk = await pg.get_planejamento_bulk(obras, ano)
    return [
        FluxoPlanejamentoResponse(
            obra_codigo=obra,
            ano=ano,
            meses=[
                FluxoMesRow(
                    mes=r["mes"],
                    custo_previsto=float(r["custo_previsto"]),
                    receita_prevista=float(r["receita_prevista"]),
                    custo_real=0.0,         # TODO: query UAU
                    receita_realizada=0.0,  # TODO: query UAU
                )
                for r in bulk[obra]
            ],
        )
        for obra in obras
    ]


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
        obra: {m: {"custo_real": 0.0, "receita_realizada": 0.0} for m in range(1, 13)}
        for obra in obras
    }

    for item in ap_data:
        if item.get("origem") not in origens_set:
            continue
        obra = str(item.get("obra", ""))
        if obra not in obras_set:
            continue
        mes = _parse_mes(item.get("data", ""), ano)
        if mes is None:
            continue
        by_obra[obra][mes]["custo_real"] += float(item.get("valor", 0))

    for item in receitas_data:
        if item.get("status") not in status_rec_set:
            continue
        obra = str(item.get("obra", ""))
        if obra not in obras_set:
            continue
        mes = _parse_mes(item.get("data", ""), ano)
        if mes is None:
            continue
        by_obra[obra][mes]["receita_realizada"] += float(item.get("valor", 0))

    return by_obra


def _build_real_response(
    obras: list[str], ano: int,
    by_obra: dict[str, dict[int, dict[str, float]]],
) -> list[FluxoRealResponse]:
    return [
        FluxoRealResponse(
            obra_codigo=obra,
            ano=ano,
            meses=[
                FluxoRealMes(
                    mes=m,
                    custo_real=by_obra.get(obra, {}).get(m, {}).get("custo_real", 0.0),
                    receita_realizada=by_obra.get(obra, {}).get(m, {}).get("receita_realizada", 0.0),
                )
                for m in range(1, 13)
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
    return _build_real_response(obras, ano, by_obra)


# ── Cache persistido por grupo ───────────────────────────────────────────────

@router.get("/grupo/{grupo_id}/real", response_model=FluxoRealCachedResponse)
async def get_grupo_real_cache(
    grupo_id: int,
    ano: int,
    user: UserOut = Depends(get_current_user),
):
    """Retorna o snapshot persistido do grupo/ano. Vazio se nunca atualizado."""
    if not await pg.is_grupo_visible_to_user(grupo_id, user.id, user.is_admin):
        raise HTTPException(status_code=403, detail="Sem acesso a este grupo")

    rows, meta_dict = await pg.get_fluxo_real_cache(grupo_id, ano)
    if meta_dict is None:
        return FluxoRealCachedResponse(data=[], meta=None)

    # Agrupa rows por obra
    by_obra: dict[str, dict[int, dict[str, float]]] = {}
    for r in rows:
        obra = r["obra_codigo"]
        by_obra.setdefault(obra, {})[r["mes"]] = {
            "custo_real": float(r["custo_real"]),
            "receita_realizada": float(r["receita_realizada"]),
        }
    obras = sorted(by_obra.keys())
    data = _build_real_response(obras, ano, by_obra)

    meta = FluxoRealCacheMeta(
        updated_at=meta_dict["updated_at"],
        updated_by=meta_dict.get("updated_by"),
        updated_by_name=meta_dict.get("updated_by_name"),
        origens=list(meta_dict.get("origens") or []),
        status_rec=list(meta_dict.get("status_rec") or []),
    )
    return FluxoRealCachedResponse(data=data, meta=meta)


@router.post("/grupo/{grupo_id}/real", response_model=FluxoRealCachedResponse)
async def atualizar_grupo_real(
    grupo_id: int,
    ano: int,
    body: AtualizarFluxoRealIn,
    user: UserOut = Depends(get_current_user),
):
    """Recomputa dados reais para as obras do grupo (e greedy), persiste e devolve."""
    if not await pg.is_grupo_visible_to_user(grupo_id, user.id, user.is_admin):
        raise HTTPException(status_code=403, detail="Sem acesso a este grupo")

    obras_diretas, empresas_greedy = await pg.get_grupo_obras_e_greedy(grupo_id)
    tree = await get_cached("dash:filters:tree") or {}
    greedy_obras = _resolve_greedy_obras(empresas_greedy, tree, set(obras_diretas))
    todas_obras = sorted(set(obras_diretas) | set(greedy_obras))

    by_obra = await _compute_real_for_obras(todas_obras, ano, body.origens, body.status_rec)

    rows_to_save: list[dict] = []
    for obra, by_mes in by_obra.items():
        for mes, vals in by_mes.items():
            if vals["custo_real"] == 0 and vals["receita_realizada"] == 0:
                continue  # economiza linhas com tudo zerado
            rows_to_save.append({
                "obra_codigo": obra,
                "mes": mes,
                "custo_real": vals["custo_real"],
                "receita_realizada": vals["receita_realizada"],
            })

    meta_dict = await pg.save_fluxo_real_cache(
        grupo_id, ano, user.id, rows_to_save, body.origens, body.status_rec,
    )

    data = _build_real_response(todas_obras, ano, by_obra)
    meta = FluxoRealCacheMeta(
        updated_at=meta_dict["updated_at"],
        updated_by=meta_dict.get("updated_by"),
        updated_by_name=meta_dict.get("updated_by_name"),
        origens=list(meta_dict.get("origens") or []),
        status_rec=list(meta_dict.get("status_rec") or []),
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


@router.post("/planejamento", status_code=204)
async def upsert_planejamento(
    body: UpsertPlanejamentoIn,
    _: UserOut = Depends(get_current_user),
):
    if not 1 <= body.mes <= 12:
        raise HTTPException(status_code=400, detail="mes deve ser 1–12")
    await pg.upsert_planejamento(
        body.obra_codigo, body.ano, body.mes,
        body.custo_previsto, body.receita_prevista,
    )


@router.post("/planejamento/importar", response_model=BulkImportResult)
async def importar_planilha(
    file: UploadFile = File(...),
    _: UserOut = Depends(get_current_user),
):
    """
    Importa .xlsx com colunas: obra_codigo | ano | mes | custo_previsto | receita_prevista
    Primeira linha = cabeçalho; linhas seguintes = dados.
    """
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

    count = await pg.bulk_upsert_planejamento(items)
    return BulkImportResult(imported=count, errors=errors)
