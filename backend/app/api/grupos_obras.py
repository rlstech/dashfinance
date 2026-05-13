from fastapi import APIRouter, Depends, HTTPException

from app.deps.auth import get_current_user
from app.models.auth import GrupoObrasIn, GrupoObrasOut, UserBasic, UserOut
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
    grupos = await pg.get_grupos(user.id, user.is_admin)
    return [
        {**g, "is_owner": user.is_admin or g.get("created_by") == user.id}
        for g in grupos
    ]


@router.post("", response_model=GrupoObrasOut, status_code=201)
async def create_grupo(body: GrupoObrasIn, user: UserOut = Depends(get_current_user)):
    await _validate_obras(body.obras, user)
    grupo = await pg.create_grupo(
        body.nome, body.descricao, body.obras,
        body.percentuais, body.obra_especial, user.id, body.shared_with,
        body.empresas_greedy,
    )
    return {**grupo, "is_owner": True}


@router.put("/{grupo_id}", response_model=GrupoObrasOut)
async def update_grupo(grupo_id: int, body: GrupoObrasIn, user: UserOut = Depends(get_current_user)):
    if not user.is_admin:
        created_by = await pg.get_grupo_created_by(grupo_id)
        if created_by is None:
            raise HTTPException(status_code=404, detail="Grupo não encontrado")
        if created_by != user.id:
            raise HTTPException(status_code=403, detail="Sem permissão para editar este grupo")

    await _validate_obras(body.obras, user)
    result = await pg.update_grupo(
        grupo_id, body.nome, body.descricao, body.obras,
        body.percentuais, body.obra_especial, user.id, body.shared_with,
        body.empresas_greedy,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Grupo não encontrado")
    return {**result, "is_owner": user.is_admin or result.get("created_by") == user.id}


@router.delete("/{grupo_id}", status_code=204)
async def delete_grupo(grupo_id: int, user: UserOut = Depends(get_current_user)):
    if not user.is_admin:
        created_by = await pg.get_grupo_created_by(grupo_id)
        if created_by is None:
            raise HTTPException(status_code=404, detail="Grupo não encontrado")
        if created_by != user.id:
            raise HTTPException(status_code=403, detail="Sem permissão para excluir este grupo")
    await pg.delete_grupo(grupo_id)
