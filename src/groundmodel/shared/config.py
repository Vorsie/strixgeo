"""Application settings loaded from environment variables."""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Pydantic-settings class — reads values from .env or environment."""
    database_url: str = "postgresql+asyncpg://groundmodel:groundmodel@localhost:5432/groundmodel"
    debug: bool = False
    log_level: str = "INFO"
    secret_key: str = "change-me"

    model_config = {"env_file": ".env"}


settings = Settings()
