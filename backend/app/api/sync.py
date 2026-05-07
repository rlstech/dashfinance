from fastapi import APIRouter, Depends
from app.services.sync import sync_all
from app.services.cache import get_cached
from app.models.schemas import SyncResponse, StatusResponse
from app.deps.auth import get_current_user, require_admin
from app.models.auth import UserOut

router = APIRouter(tags=["sync"])


@router.get("/sync", response_model=SyncResponse)
async def api_sync(_: UserOut = Depends(require_admin)):
    result = await sync_all()
    return result


@router.get("/status", response_model=StatusResponse)
async def api_status(_: UserOut = Depends(get_current_user)):
    meta = await get_cached("dash:meta")
    ap = await get_cached("dash:ap:all")
    rec = await get_cached("dash:receitas:all")
    saldo = await get_cached("dash:saldo:all")
    return {
        "last_sync": meta.get("last_sync") if meta else None,
        "de": meta.get("de") if meta else None,
        "ate": meta.get("ate") if meta else None,
        "count_ap": len(ap) if ap else 0,
        "count_receitas": len(rec) if rec else 0,
        "count_saldo": len(saldo) if saldo else 0,
    }
