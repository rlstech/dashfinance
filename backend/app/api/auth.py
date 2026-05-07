from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from jose import jwt
from passlib.context import CryptContext

from app.config import settings
from app.deps.auth import get_current_user
from app.models.auth import LoginRequest, Token, UserOut
from app.services import pg

router = APIRouter(prefix="/auth", tags=["auth"])

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _make_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    return jwt.encode({"sub": str(user_id), "exp": expire}, settings.JWT_SECRET, algorithm="HS256")


@router.post("/login", response_model=Token)
async def login(body: LoginRequest):
    user = await pg.get_user_by_email(body.email)
    if not user or not user["is_active"] or not _pwd.verify(body.password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciais inválidas")
    token = _make_token(user["id"])
    return Token(access_token=token, user=UserOut(**user))


@router.get("/me", response_model=UserOut)
async def me(user: UserOut = Depends(get_current_user)):
    return user
