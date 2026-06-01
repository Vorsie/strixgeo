"""Application settings loaded from environment variables."""

import warnings
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings

# Sentinel value written in the codebase default so callers can cheaply
# detect the un-overridden case without importing the whole settings module.
_SECRET_KEY_DEFAULT = "change-me"


def _default_dov_cache_dir() -> Path:
    """Return the default DOV XML cache directory under the user's home."""
    return Path.home() / ".groundmodel" / "dov_cache"


def _default_dem_cache_dir() -> Path:
    """Return the default DEM GeoTIFF tile cache directory under the user's home."""
    return Path.home() / ".groundmodel" / "dem_cache"


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
    # Debt #113: the default is intentionally the well-known sentinel "change-me"
    # so a startup warning fires loudly before auth routes ever use it.  Set
    # SECRET_KEY in the environment or .env — any non-default value silences
    # the warning.  The auth layer (#3/#4) will harden this to a hard error.
    secret_key: str = _SECRET_KEY_DEFAULT

    @model_validator(mode="after")
    def _warn_on_default_secret_key(self) -> "Settings":
        """Emit a RuntimeWarning when secret_key is still the shipped default.

        A hard error would break dev setups that haven't set SECRET_KEY yet;
        a warning surfaces loudly in logs without blocking startup.  When auth
        (#3/#4) lands this becomes a hard assertion.

        Returns
        -------
        Settings
            Self — required by the ``mode="after"`` validator protocol.
        """
        if self.secret_key == _SECRET_KEY_DEFAULT:
            warnings.warn(
                "SECRET_KEY is still the default 'change-me' value.  "
                "Set SECRET_KEY in your environment or .env file before "
                "deploying or enabling auth (debt #113).",
                RuntimeWarning,
                stacklevel=2,
            )
        return self

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
    # Where to cache DEM GeoTIFF tiles fetched from WCS providers
    # (DHMVII for BE, AHN4 for NL). Tiles are keyed by (provider, bbox,
    # resolution) and are valid indefinitely — public LiDAR surveys
    # change on decade timescales, not daily. Override via DEM_CACHE_DIR.
    dem_cache_dir: Path = _default_dem_cache_dir()
    # Soft size cap per provider sub-directory (bytes).
    # Default 512 MiB — DEM tiles are larger than DOV XMLs (multi-MB
    # GeoTIFFs for urban extents); 512 MiB accommodates ~50–200 tiles.
    # Overridable via DEM_CACHE_MAX_BYTES (0 disables eviction).
    dem_cache_max_bytes: int = 512 * 1024 * 1024

    model_config = {"env_file": ".env"}


settings = Settings()
