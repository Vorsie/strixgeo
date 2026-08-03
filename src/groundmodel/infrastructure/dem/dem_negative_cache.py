"""Process-wide memory of DEM tile keys that recently failed upstream.

Why this exists
---------------
Dogfeed 2026-08-02: the backend logged the same WCS ``GetCoverage`` request —
one degenerate strip, ``X(-2.000,1002.000) Y(-2.000,2.000)`` — 404ing dozens of
times in a single session. Nothing remembered the previous answer, so every
re-mount of the section panel (and every retry above it) went back to the
network for a tile that could not exist.

The positive tile cache (``DemTileCache``) only remembers successes. This is
its negative twin: after a PERMANENT upstream failure, the exact key is
suppressed for ``WCS_NEGATIVE_CACHE_TTL_SECONDS`` and the provider raises
``DemUpstreamRecentlyFailedError`` without touching the network.

What may be recorded
--------------------
Only failures that re-asking cannot fix — a 4xx status and an undecodable body
(an OWS ExceptionReport served with 200). Connection errors, timeouts and 5xx
statuses are deliberately NOT recorded: those self-heal, and suppressing them
would answer 503 for five minutes over a network that is already back. The
decision lives in ``wcs_dem_provider._is_permanent_upstream_failure``.

Scope
-----
Deliberately in memory and process-wide (module-level singleton): DEM providers
are constructed per request, so per-instance state would forget everything
between two clicks. The map is tiny (one float per distinct failing tile), and
because only permanent failures land in it, its size is bounded by the number
of distinct impossible tiles a session asks for.
"""

from __future__ import annotations

import time

from groundmodel.infrastructure.dem.dem_wcs_constants import WCS_NEGATIVE_CACHE_TTL_SECONDS

# Tile identity: provider id + the padded bbox + the resolution the request
# used. Rounded to millimetres so float noise in the bbox arithmetic cannot
# produce a "different" key for the same tile.
DemTileKey = tuple[str, int, int, int, int, int]


def make_tile_key(
    provider_id: str,
    min_x: float,
    min_y: float,
    max_x: float,
    max_y: float,
    resolution_m: float,
) -> DemTileKey:
    """Build the identity used by both the failure record and the lookup.

    Parameters
    ----------
    provider_id : str
        Provider that issued the request (``"dhmvii"`` / ``"ahn4"``).
    min_x, min_y, max_x, max_y : float
        The padded tile extent, in the provider's native CRS (metres).
    resolution_m : float
        Cell size the request asked for.

    Returns
    -------
    DemTileKey
        Hashable key, coordinates rounded to millimetres.
    """
    return (
        provider_id,
        round(min_x * 1000),
        round(min_y * 1000),
        round(max_x * 1000),
        round(max_y * 1000),
        round(resolution_m * 1000),
    )


class DemNegativeCache:
    """Short-lived record of tile keys whose upstream fetch failed.

    Parameters
    ----------
    ttl_seconds : float, optional
        How long a failure suppresses retries for the same key. Defaults to
        ``WCS_NEGATIVE_CACHE_TTL_SECONDS``.
    """

    def __init__(self, ttl_seconds: float = WCS_NEGATIVE_CACHE_TTL_SECONDS) -> None:
        """Initialise an empty cache with the given suppression window."""
        self._ttl = ttl_seconds
        self._failed_at: dict[DemTileKey, float] = {}

    def record_failure(self, key: DemTileKey, *, now: float | None = None) -> None:
        """Remember that this tile key just failed upstream.

        Parameters
        ----------
        key : DemTileKey
            The key that failed.
        now : float | None, optional
            Monotonic timestamp to record; defaults to ``time.monotonic()``.
            Injectable so tests can travel forward past the TTL without
            sleeping.
        """
        self._failed_at[key] = time.monotonic() if now is None else now

    def seconds_until_retry(self, key: DemTileKey, *, now: float | None = None) -> float:
        """Return how long this key stays suppressed; ``0.0`` when it may be tried.

        An expired entry is dropped when its own key is read again. A key that
        fails once and is never re-requested therefore stays in the map for the
        life of the process — accepted deliberately: it is one float, and the
        realistic worst case is a handful of impossible tiles per session.

        Parameters
        ----------
        key : DemTileKey
            The key about to be requested.
        now : float | None, optional
            Monotonic timestamp to evaluate against; defaults to
            ``time.monotonic()``.

        Returns
        -------
        float
            Seconds remaining in the suppression window, or ``0.0`` when the
            key is unknown or its window has elapsed.
        """
        stamp = self._failed_at.get(key)
        if stamp is None:
            return 0.0
        elapsed = (time.monotonic() if now is None else now) - stamp
        remaining = self._ttl - elapsed
        if remaining <= 0.0:
            del self._failed_at[key]
            return 0.0
        return remaining

    def clear(self) -> None:
        """Forget every recorded failure.

        Used by tests. There is deliberately no user-facing reset: only
        permanent failures are recorded, so a manual retry would ask the same
        impossible question again.
        """
        self._failed_at.clear()


# Process-wide instance — providers are per-request, the suppression must not be.
DEM_NEGATIVE_CACHE = DemNegativeCache()
