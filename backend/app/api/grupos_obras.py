from fastapi import APIRouter, Depends, HTTPException

from app.deps.auth import get_current_user
from app.models.auth import GrupoObrasIn, GrupoObrasOut, UserOut
from app.services import pg

router = APIRouter(prefix="/grupos-obras", tags=["grupos-obras"])


@router.get("", response_model=list[GrupoObrasOut])
async def list_grupos(_: UserOut = Depends(get_current_user)):
    return await pg.get_grupos()


@router.post("", response_model=GrupoObrasOut, status_code=201)
async def create_grupo(body: GrupoObrasIn, user: UserOut = Depends(get_current_user)):
    return await pg.create_grupo(body.nome, body.descricao, body.obras, user.id)


@router.put("/{grupo_id}", response_model=GrupoObrasOut)
async def update_grupo(grupo_id: int, body: GrupoObrasIn, user: UserOut = Depends(get_current_user)):
    result = await pg.update_grupo(grupo_id, body.nome, body.descricao, body.obras, user.id)
    if not result:
        raise HTTPException(status_code=404, detail="Grupo não encontrado")
    return result


@router.delete("/{grupo_id}", status_code=204)
async def delete_grupo(grupo_id: int, _: UserOut = Depends(get_current_user)):
    await pg.delete_grupo(grupo_id)
