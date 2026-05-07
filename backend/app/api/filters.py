from fastapi import APIRouter, Depends
from app.services.cache import get_cached
from app.models.schemas import FilterTree
from app.deps.auth import get_current_user
from app.models.auth import UserOut

router = APIRouter(tags=["filters"])


@router.get("/filters/tree", response_model=FilterTree)
async def get_filter_tree(user: UserOut = Depends(get_current_user)):
    tree = await get_cached("dash:filters:tree")
    if not tree:
        return FilterTree()

    ft = FilterTree(**tree)

    if user.is_admin:
        return ft

    allowed = set(user.empresas)
    ft.empresas = [e for e in ft.empresas if e in allowed]
    ft.obras_por_empresa = {k: v for k, v in ft.obras_por_empresa.items() if k in allowed}
    ft.bancos_por_empresa = {k: v for k, v in ft.bancos_por_empresa.items() if k in allowed}
    ft.contas_por_empresa = {k: v for k, v in ft.contas_por_empresa.items() if k in allowed}
    ft.contas_por_empresa_banco = {k: v for k, v in ft.contas_por_empresa_banco.items() if k in allowed}
    return ft
