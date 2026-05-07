from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt

from app.config import settings
from app.models.auth import UserOut
from app.services import pg

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


async def get_current_user(token: str = Depends(oauth2_scheme)) -> UserOut:
    exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token inválido ou expirado",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
        user_id: int | None = payload.get("sub")
        if user_id is None:
            raise exc
    except JWTError:
        raise exc

    user = await pg.get_user_by_id(int(user_id))
    if not user or not user["is_active"]:
        raise exc

    return UserOut(**user)


async def require_admin(user: UserOut = Depends(get_current_user)) -> UserOut:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Acesso restrito a administradores")
    return user
