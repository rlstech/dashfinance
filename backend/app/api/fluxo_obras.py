import io
import logging
from datetime import datetime

import openpyxl
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from app.deps.auth import get_current_user
from app.models.auth import UserOut
from app.models.schemas import (
    BulkImportResult,
    FluxoMesRow,
    FluxoPlanejamentoResponse,
    FluxoRealMes,
    FluxoRealResponse,
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

    obras_set = set(obras)
    origens_set = set(origens)
    status_rec_set = set(status_rec)

    ap_data: list[dict] = await get_cached("dash:ap:all") or []
    receitas_data: list[dict] = await get_cached("dash:receitas:all") or []

    custo_map: dict[str, dict[int, float]] = {}
    for item in ap_data:
        if item.get("origem") not in origens_set:
            continue
        obra = str(item.get("obra", ""))
        if obra not in obras_set:
            continue
        mes = _parse_mes(item.get("data", ""), ano)
        if mes is None:
            continue
        custo_map.setdefault(obra, {})
        custo_map[obra][mes] = custo_map[obra].get(mes, 0.0) + float(item.get("valor", 0))

    rec_map: dict[str, dict[int, float]] = {}
    for item in receitas_data:
        if item.get("status") not in status_rec_set:
            continue
        obra = str(item.get("obra", ""))
        if obra not in obras_set:
            continue
        mes = _parse_mes(item.get("data", ""), ano)
        if mes is None:
            continue
        rec_map.setdefault(obra, {})
        rec_map[obra][mes] = rec_map[obra].get(mes, 0.0) + float(item.get("valor", 0))

    return [
        FluxoRealResponse(
            obra_codigo=obra,
            ano=ano,
            meses=[
                FluxoRealMes(
                    mes=m,
                    custo_real=custo_map.get(obra, {}).get(m, 0.0),
                    receita_realizada=rec_map.get(obra, {}).get(m, 0.0),
                )
                for m in range(1, 13)
            ],
        )
        for obra in obras
    ]


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
