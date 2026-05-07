from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # SQL Server
    DB_HOST: str = "192.168.1.8"
    DB_PORT: int = 62311
    DB_NAME: str = "uau"
    DB_USER: str = ""
    DB_PASSWORD: str = ""

    # Redis
    REDIS_URL: str = "redis://redis:6379/0"
    CACHE_TTL_SECONDS: int = 300

    # SMB / Excel
    EXCEL_COMBRASEN: str = r"\\192.168.1.8\FINAN\FLUXO DE CAIXA\FLUXO DE CAIXA COMBRASEN 2026.xlsx"
    EXCEL_GAMA01: str = r"\\192.168.1.8\FINAN\FLUXO DE CAIXA\FLUXO DE CAIXA GAMA 01 2026.xlsx"
    EXCEL_SMB_USER: str = ""
    EXCEL_SMB_PASS: str = ""

    # App
    CORS_ORIGINS: list[str] = ["http://localhost:5173"]
    SYNC_INTERVAL_MINUTES: int = 30
    SYNC_DATE_FROM: str = "2020-01-01"
    SYNC_DATE_TO: str = "2030-12-31"

    # PostgreSQL (auth + configurações)
    PG_DSN: str = "postgresql://postgres:Mfcd62!!Mfcd62Az@postgres_postgres:5432/dash"

    # JWT
    JWT_SECRET: str = "change-me-in-production"
    JWT_EXPIRE_MINUTES: int = 480

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
