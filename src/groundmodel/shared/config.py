from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://groundmodel:groundmodel@localhost:5432/groundmodel"
    debug: bool = False
    log_level: str = "INFO"
    secret_key: str = "change-me"

    model_config = {"env_file": ".env"}


settings = Settings()
