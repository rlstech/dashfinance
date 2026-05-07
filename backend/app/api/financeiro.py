from fastapi import APIRouter, Depends
from app.services.cache import get_cached
from app.services.queries import get_ap, get_receitas, get_saldo_banco
from app.config import settings
from app.deps.auth import get_current_user
from app.models.auth import UserOut

router = APIRouter(tags=["financeiro"])


def _filter_by_empresa(data: list[dict], user: UserOut) -> list[dict]:
    if user.is_admin:
        return data
    return [r for r in data if r.get("empresa") in user.empresas]


@router.get("/ap")
async def api_ap(user: UserOut = Depends(get_current_user)):
    cached = await get_cached("dash:ap:all")
    data = cached if cached is not None else get_ap(settings.SYNC_DATE_FROM, settings.SYNC_DATE_TO)
    return _filter_by_empresa(data, user)


@router.get("/receitas")
async def api_receitas(user: UserOut = Depends(get_current_user)):
    cached = await get_cached("dash:receitas:all")
    data = cached if cached is not None else get_receitas(settings.SYNC_DATE_FROM, settings.SYNC_DATE_TO)
    return _filter_by_empresa(data, user)


@router.get("/saldo_banco")
async def api_saldo_banco(user: UserOut = Depends(get_current_user)):
    cached = await get_cached("dash:saldo:all")
    data = cached if cached is not None else get_saldo_banco(settings.SYNC_DATE_FROM, settings.SYNC_DATE_TO)
    return _filter_by_empresa(data, user)
