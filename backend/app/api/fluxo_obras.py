import io
import logging

import openpyxl
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.deps.auth import get_current_user
from app.models.auth import UserOut
from app.models.schemas import (
    BulkImportResult,
    FluxoMesRow,
    FluxoPlanejamentoResponse,
    UpsertPlanejamentoIn,
)
from app.services import pg

log = logging.getLogger(__name__)

router = APIRouter(prefix="/fluxo-obras", tags=["fluxo-obras"])


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
