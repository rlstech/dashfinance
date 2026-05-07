from fastapi import APIRouter
from app.api.financeiro import router as financeiro_router
from app.api.sync import router as sync_router
from app.api.filters import router as filters_router
from app.api.auth import router as auth_router
from app.api.admin import router as admin_router
from app.api.config_api import router as config_router

router = APIRouter(prefix="/api")
router.include_router(auth_router)
router.include_router(financeiro_router)
router.include_router(sync_router)
router.include_router(filters_router)
router.include_router(admin_router)
router.include_router(config_router)
