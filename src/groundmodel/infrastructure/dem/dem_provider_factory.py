"""Factory — select the correct ``DemProvider`` for a project CRS.

The selection rule is explicit and project-owner-confirmed (2026-05-16):

* EPSG:31370 (BD72 / Belgian Lambert 1972) → ``DhmviiDemProvider`` (Flanders, BE)
* EPSG:28992 (Amersfoort / RD New) → ``Ahn4DemProvider`` (Netherlands)
* Any other EPSG → no provider available; caller must surface a
  ``NoDemProviderError`` to the UI rather than crashing.

The explicit-override path is present for future extensibility (a project
in an unsupported CRS whose engineer knows the underlying data is covered
by one of the known providers, or a test that wants to force a specific
provider without mocking the EPSG lookup).

This module is infrastructure — it may import from ``infrastructure/dem/``
but MUST NOT import from ``domain/`` or ``application/``.
"""

from __future__ import annotations

from pathlib import Path

from groundmodel.infrastructure.dem.ahn4_dem_provider import Ahn4DemProvider
from groundmodel.infrastructure.dem.dem_provider import DemProvider
from groundmodel.infrastructure.dem.dem_tile_cache import DemTileCache
from groundmodel.infrastructure.dem.dhmvii_dem_provider import DhmviiDemProvider

# Supported EPSG codes and their provider ids.
_EPSG_TO_PROVIDER_ID: dict[int, str] = {
    31370: "dhmvii",
    28992: "ahn4",
}


class NoDemProviderError(Exception):
    """Raised when no DEM provider is registered for the project's CRS.

    Attributes
    ----------
    epsg : int
        The project's horizontal EPSG code that had no matching provider.
    """

    def __init__(self, epsg: int) -> None:
        """Initialise with the unsupported EPSG code."""
        super().__init__(
            f"No DEM provider available for EPSG:{epsg}. "
            "Supported: EPSG:31370 (BE/Flanders DHMVII) and EPSG:28992 (NL AHN4). "
            "Ground-surface build is not available for this project."
        )
        self.epsg = epsg


def build_dem_provider(
    epsg: int,
    cache_root: Path,
    *,
    max_cache_bytes: int | None = None,
    override_provider_id: str | None = None,
) -> DemProvider:
    """Construct the correct ``DemProvider`` for the given EPSG code.

    Parameters
    ----------
    epsg : int
        Project's ``default_horizontal_epsg``.
    cache_root : Path
        Root directory for DEM tile caches.  One sub-directory per
        provider id is created under it.
    max_cache_bytes : int | None, optional
        Passed to ``DemTileCache`` as the eviction ceiling.  ``None``
        disables eviction (suitable for development and tests).
    override_provider_id : str | None, optional
        When set, uses the named provider regardless of ``epsg``.  Legal
        values: ``"dhmvii"`` and ``"ahn4"``.  Raises ``ValueError`` when
        the id is not recognised.  Use for testing or edge-case overrides;
        do not use in the normal application path.

    Returns
    -------
    DemProvider
        A freshly constructed provider instance.  Callers own the
        lifecycle (close / context-manager).

    Raises
    ------
    NoDemProviderError
        When ``epsg`` is not in the supported set and
        ``override_provider_id`` is not given.
    ValueError
        When ``override_provider_id`` is not a recognised provider id.
    """
    provider_id = override_provider_id or _EPSG_TO_PROVIDER_ID.get(epsg)
    if provider_id is None:
        raise NoDemProviderError(epsg)

    cache = DemTileCache(cache_root, provider_id, max_bytes=max_cache_bytes)

    if provider_id == "dhmvii":
        return DhmviiDemProvider(cache)
    if provider_id == "ahn4":
        return Ahn4DemProvider(cache)

    raise ValueError(f"Unknown provider_id {provider_id!r}. Recognised values: 'dhmvii', 'ahn4'.")


def supported_epsg_codes() -> frozenset[int]:
    """Return the set of EPSG codes for which a DEM provider is registered.

    Returns
    -------
    frozenset[int]
        Currently ``{31370, 28992}``.
    """
    return frozenset(_EPSG_TO_PROVIDER_ID.keys())
