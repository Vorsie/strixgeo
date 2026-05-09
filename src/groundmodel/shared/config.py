"""Application settings loaded from environment variables."""

from pathlib import Path

from pydantic_settings import BaseSettings


def _default_dov_cache_dir() -> Path:
    """Return the default DOV XML cache directory under the user's home."""
    return Path.home() / ".groundmodel" / "dov_cache"


class Settings(BaseSettings):
    """Application configuration, resolved in this priority order:

    1. Real environment variables (``DATABASE_URL=...`` in the shell / Docker / k8s).
    2. A ``.env`` file in the project root (local dev convenience).
    3. The Python defaults defined below.

    Add a new setting as a typed field with a sensible default.  Never hardcode
    secrets — always provide them through the environment.
    """

    database_url: str = "postgresql+asyncpg://groundmodel:groundmodel@localhost:5433/groundmodel"
    debug: bool = False
    log_level: str = "INFO"
    secret_key: str = "change-me"
    # Where to cache downloaded DOV sondering XMLs. Reused across imports so the same
    # CPT is never downloaded twice. DOV measurement data is historical, so cached
    # entries are valid indefinitely. Override with DOV_CACHE_DIR env var.
    dov_cache_dir: Path = _default_dov_cache_dir()
    # Per-cache-subdir size cap (bytes). Each DovXmlCache instance — the
    # CPT cache plus four borehole subdirs (boring, interpretatie,
    # monster, observatie) — sweeps oldest-by-mtime until under this
    # cap. Default 256 MiB × 5 instances ≈ 1.25 GiB total ceiling on
    # disk. Overridable via DOV_CACHE_MAX_BYTES (0 disables eviction).
    dov_cache_max_bytes: int = 256 * 1024 * 1024

    model_config = {"env_file": ".env"}


settings = Settings()
