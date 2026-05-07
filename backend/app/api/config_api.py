from fastapi import APIRouter, Depends

from app.deps.auth import get_current_user, require_admin
from app.models.auth import SaldoConfigIn, SaldoConfigOut, UserOut
from app.services import pg

router = APIRouter(prefix="/config", tags=["config"])


@router.get("/saldos", response_model=list[SaldoConfigOut])
async def get_saldos(user: UserOut = Depends(get_current_user)):
    empresas = None if user.is_admin else user.empresas
    return await pg.get_saldos(empresas)


@router.put("/saldos", status_code=204)
async def save_saldos(items: list[SaldoConfigIn], user: UserOut = Depends(require_admin)):
    for item in items:
        await pg.upsert_saldo(item.empresa, item.banco, item.conta, item.enabled, item.saldo, user.id)
