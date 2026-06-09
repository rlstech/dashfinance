from fastapi import APIRouter, Depends, HTTPException

from app.deps.auth import get_current_user
from app.models.auth import GrupoObrasIn, GrupoObrasOut, PeriodoPadrao, UserBasic, UserOut
from app.services import pg
from app.services.cache import get_cached

router = APIRouter(prefix="/grupos-obras", tags=["grupos-obras"])


async def _validate_obras(obras: list[str], user: UserOut) -> None:
    """Garante que todas as obras pertencem a empresas que o usuário pode acessar."""
    if user.is_admin or not obras:
        return
    tree = await get_cached("dash:filters:tree")
    if not tree:
        return  # cache vazio — sem dados para validar
    obras_por_empresa: dict = tree.get("obras_por_empresa", {})
    obras_permitidas = {
        obra
        for emp, obras_emp in obras_por_empresa.items()
        if emp in user.empresas
        for obra in obras_emp
    }
    for obra in obras:
        if obra not in obras_permitidas:
            raise HTTPException(status_code=403, detail=f"Obra não permitida: {obra}")


@router.get("/users", response_model=list[UserBasic])
async def list_users_basic(_: UserOut = Depends(get_current_user)):
    return await pg.get_all_users_basic()


@router.get("", response_model=list[GrupoObrasOut])
async def list_grupos(user: UserOut = Depends(get_current_user)):
    # pg.get_grupos já calcula is_owner e can_edit por grupo
    return await pg.get_grupos(user.id, user.is_admin)


@router.post("", response_model=GrupoObrasOut, status_code=201)
async def create_grupo(body: GrupoObrasIn, user: UserOut = Depends(get_current_user)):
    await _validate_obras(body.obras, user)
    grupo = await pg.create_grupo(
        body.nome, body.descricao, body.obras,
        body.percentuais, body.obra_especial, user.id,
        [s.model_dump() for s in body.shared_with],
        body.empresas_greedy,
    )
    return {**grupo, "is_owner": True, "can_edit": True}


@router.put("/{grupo_id}", response_model=GrupoObrasOut)
async def update_grupo(grupo_id: int, body: GrupoObrasIn, user: UserOut = Depends(get_current_user)):
    if not await pg.grupo_exists(grupo_id):
        raise HTTPException(status_code=404, detail="Grupo não encontrado")
    if not await pg.can_user_edit_grupo(grupo_id, user.id, user.is_admin):
        raise HTTPException(status_code=403, detail="Sem permissão para editar este grupo")

    await _validate_obras(body.obras, user)
    result = await pg.update_grupo(
        grupo_id, body.nome, body.descricao, body.obras,
        body.percentuais, body.obra_especial, user.id,
        [s.model_dump() for s in body.shared_with],
        body.empresas_greedy,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Grupo não encontrado")
    return {
        **result,
        "is_owner": user.is_admin or result.get("created_by") == user.id,
        "can_edit": True,  # quem chega aqui já passou no gate
    }


@router.put("/{grupo_id}/periodo", status_code=204)
async def save_periodo(grupo_id: int, body: PeriodoPadrao, user: UserOut = Depends(get_current_user)):
    if not await pg.grupo_exists(grupo_id):
        raise HTTPException(status_code=404, detail="Grupo não encontrado")
    if not await pg.can_user_edit_grupo(grupo_id, user.id, user.is_admin):
        raise HTTPException(status_code=403, detail="Sem permissão para editar este grupo")
    await pg.save_periodo_grupo(grupo_id, body.ano_inicio, body.mes_inicio, body.ano_fim, body.mes_fim)


@router.delete("/{grupo_id}", status_code=204)
async def delete_grupo(grupo_id: int, user: UserOut = Depends(get_current_user)):
    if not await pg.grupo_exists(grupo_id):
        raise HTTPException(status_code=404, detail="Grupo não encontrado")
    if not await pg.can_user_edit_grupo(grupo_id, user.id, user.is_admin):
        raise HTTPException(status_code=403, detail="Sem permissão para excluir este grupo")
    await pg.delete_grupo(grupo_id)
