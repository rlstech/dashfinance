from fastapi import APIRouter, Depends, HTTPException, status
from passlib.context import CryptContext

from app.deps.auth import require_admin
from app.models.auth import UserCreate, UserOut, UserUpdate
from app.services import pg

router = APIRouter(prefix="/admin", tags=["admin"])

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")


@router.get("/users", response_model=list[UserOut])
async def list_users(_: UserOut = Depends(require_admin)):
    users = await pg.list_users()
    return [UserOut(**u) for u in users]


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(body: UserCreate, _: UserOut = Depends(require_admin)):
    existing = await pg.get_user_by_email(body.email)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="E-mail já cadastrado")
    hashed = _pwd.hash(body.password)
    user = await pg.create_user(body.email, body.name, hashed, body.is_admin, body.empresas)
    return UserOut(**user)


@router.put("/users/{user_id}", response_model=UserOut)
async def update_user(user_id: int, body: UserUpdate, _: UserOut = Depends(require_admin)):
    fields = {}
    if body.name is not None:
        fields["name"] = body.name
    if body.password is not None:
        fields["password_hash"] = _pwd.hash(body.password)
    if body.is_admin is not None:
        fields["is_admin"] = body.is_admin
    if body.is_active is not None:
        fields["is_active"] = body.is_active

    user = await pg.update_user(user_id, fields, body.empresas)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuário não encontrado")
    return UserOut(**user)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_user(user_id: int, _: UserOut = Depends(require_admin)):
    user = await pg.update_user(user_id, {"is_active": False}, None)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuário não encontrado")
