"""Application settings loaded from environment variables."""

import tempfile
import warnings
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings

# Sentinel value written in the codebase default so callers can cheaply
# detect the un-overridden case without importing the whole settings module.
_SECRET_KEY_DEFAULT = "change-me"
# Values that are NOT a real secret. An empty string (e.g. a bare
# ``SECRET_KEY=`` line) is as weak as the shipped default, so both are
# rejected outside development (audit #16).
_SECRET_KEY_WEAK = frozenset({_SECRET_KEY_DEFAULT, ""})


def _default_dov_cache_dir() -> Path:
    """Return the default DOV XML cache directory under the user's home."""
    return Path.home() / ".groundmodel" / "dov_cache"


def _default_dem_cache_dir() -> Path:
    """Return the default DEM GeoTIFF tile cache directory under the user's home."""
    return Path.home() / ".groundmodel" / "dem_cache"


def _default_cpt_pdf_store_dir() -> Path:
    """Return the default spool directory for uploaded PDF CPT reports (the OS temp dir)."""
    return Path(tempfile.gettempdir()) / "strixgeo-cpt-pdf"


def _default_borehole_pdf_store_dir() -> Path:
    """Return the default spool directory for uploaded PDF borehole reports (the OS temp dir)."""
    return Path(tempfile.gettempdir()) / "strixgeo-borehole-pdf"


class Settings(BaseSettings):
    """Application configuration, resolved in this priority order:

    1. Real environment variables (``DATABASE_URL=...`` in the shell / Docker / k8s).
    2. A ``.env`` file in the project root (local dev convenience).
    3. The Python defaults defined below.

    Add a new setting as a typed field with a sensible default.  Never hardcode
    secrets — always provide them through the environment.
    """

    database_url: str = "postgresql+asyncpg://groundmodel:groundmodel@127.0.0.1:5433/groundmodel"
    debug: bool = False
    # SQLAlchemy engine echo. OFF by default and decoupled from `debug`
    # because echo logs every statement WITH the bound DSN — leaking the DB
    # password into backend.log on any debug run (audit #6). Opt in explicitly
    # via SQLALCHEMY_ECHO=true only for local query debugging.
    sqlalchemy_echo: bool = False
    log_level: str = "INFO"
    # Deployment environment. "development" keeps relaxed dev ergonomics
    # (e.g. the SECRET_KEY default is a warning, not an error). Any other
    # value ("production", "staging", a packaged coworker binary) is treated
    # as non-dev and hardens those checks. Override with ENVIRONMENT env var.
    environment: str = "development"
    # Debt #113: the default is intentionally the well-known sentinel "change-me"
    # so a startup warning fires loudly before auth routes ever use it.  Set
    # SECRET_KEY in the environment or .env — any non-default value silences
    # the warning.  The auth layer (#3/#4) will harden this to a hard error.
    secret_key: str = _SECRET_KEY_DEFAULT

    @model_validator(mode="after")
    def _enforce_secret_key(self) -> "Settings":
        """Block the shipped default SECRET_KEY outside local development.

        In ``environment == "development"`` the default key only warns, so a
        first-run dev setup is not blocked. In any non-dev environment
        (production / staging / a packaged coworker binary) the default key is
        a hard error, because it would forge any future signed token
        (audit #16).

        Returns
        -------
        Settings
            Self — required by the ``mode="after"`` validator protocol.

        Raises
        ------
        ValueError
            If ``secret_key`` is the shipped default and ``environment`` is
            not ``"development"``.
        """
        if self.secret_key not in _SECRET_KEY_WEAK:
            return self
        if self.environment == "development":
            warnings.warn(
                "SECRET_KEY is still the default 'change-me' value.  "
                "Set SECRET_KEY in your environment or .env file before "
                "deploying or enabling auth (debt #113).",
                RuntimeWarning,
                stacklevel=2,
            )
            return self
        raise ValueError(
            "SECRET_KEY must be set to a non-default value when "
            f"environment={self.environment!r}.  Set SECRET_KEY in the "
            "environment before running outside local development."
        )

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
    # Where uploaded PDF CPT reports are spooled for the import dialog, one
    # sub-directory per project, one file per report SHA-256 (so the triage,
    # the re-extracts and the import read the same bytes without re-uploading
    # a 50 MB report). A temp location: the stored CPT keeps the provenance,
    # not the file. Override with CPT_PDF_STORE_DIR.
    cpt_pdf_store_dir: Path = _default_cpt_pdf_store_dir()
    # The same for uploaded PDF borehole-log reports. A directory of its own:
    # each store prunes its project folder to a few reports, so a borehole
    # report and a CPT report never push each other out, and the same PDF
    # triaged for both keeps two independent triages. Override with
    # BOREHOLE_PDF_STORE_DIR.
    borehole_pdf_store_dir: Path = _default_borehole_pdf_store_dir()

    model_config = {"env_file": ".env"}


settings = Settings()
