"""Geological-band geometry helpers for the voxel-litho builder.

A set of ``n`` geological surfaces (each a :class:`SurfaceBound` TIN)
partitions 3-D space into ``n + 1`` vertical **bands**.  Band 0 is above
every surface; band ``n`` is below every surface.  The helpers here turn
that partition into three pure geometric operations that Task 3 (the
per-voxel geo-band-aware labeller) consumes:

1. :func:`band_of` — which band does a 3-D point belong to?
2. :func:`band_extent` — what are the elevation bounds ``(base, top)`` of a
   given band at a given horizontal location?
3. :func:`section_reaches_band` — does an investigation's observed pick stack
   overlap a given band at a given location?

Design notes
------------
* **Band-index rule** — ported verbatim from the retired strat-field
  builder's ``geo_blocks._band_index`` (deleted — git history has it):
  band index = number of surfaces whose elevation at ``(x, y)`` is strictly
  ABOVE the query elevation ``z``.  Strict ``>`` means a point exactly on a
  surface belongs to the deeper band.
* **Open bounds** — the shallowest band's top and the deepest band's base are
  open (no bounding surface).  These are represented as ``None``, not a
  sentinel float, so callers can treat them as ±∞ explicitly.
* **Surface ordering** — surfaces in the input tuple are NOT guaranteed to be
  pre-sorted by elevation.  :func:`band_extent` sorts them by their evaluated
  elevation at ``(x, y)`` (descending = shallowest first) at the query point.
  Geological surfaces do not cross within a project hull (a documented
  assumption), so a local sort at the query point is well-defined.
* **Pure module** — no I/O, no logging, no framework dependencies.
* **``tuple`` vs ``list``** — all three functions take
  ``tuple[SurfaceBound, ...]`` rather than the ``list[SurfaceBound]`` the
  ported original accepted.  This is a deliberate match for the voxel builder's
  frozen-dataclass style: callers assemble surface sets once at build time
  and never mutate them, so the immutable tuple is the natural type at that
  call site.

All three functions share a small internal ``_EPS = 1e-6`` numeric guard.
"""

from __future__ import annotations

from groundmodel.domain.services.surface_bound import SurfaceBound

#: Elevations within this margin are treated as coincident (numeric guard).
_EPS: float = 1e-6


def band_of(
    surfaces: tuple[SurfaceBound, ...],
    x: float,
    y: float,
    z: float,
) -> int:
    """Return the geological band index that the point ``(x, y, z)`` falls in.

    The band index = number of geological surfaces whose elevation at ``(x, y)``
    is strictly ABOVE ``z``.  Band 0 is above every surface; band
    ``len(surfaces)`` is below every surface.  A point exactly on a surface
    boundary belongs to the DEEPER band (strict ``>``).

    This is a thin wrapper over the canonical count rule (ported from the
    retired strat-field builder's ``geo_blocks._band_index`` — git history)
    and accepts a tuple so callers do not need to pass a mutable list.

    It evaluates each surface's TIN at ``(x, y)`` once and delegates to
    :func:`band_of_from_elevs`.  When a caller already holds the precomputed
    surface elevations for this column (the voxel labeller computes them once
    per column to avoid ~12.9 M redundant TIN scans), call
    :func:`band_of_from_elevs` directly instead.

    Parameters
    ----------
    surfaces : tuple of SurfaceBound
        The geological band surfaces.  Order does not matter — we count,
        not index.  An empty tuple → everything is band 0.
    x : float
        Easting of the query point in metres (project CRS).
    y : float
        Northing of the query point in metres (project CRS).
    z : float
        Elevation of the query point in metres (project vertical datum,
        positive upward).

    Returns
    -------
    int
        Zero-based band index, 0 (shallowest) … ``len(surfaces)`` (deepest).
    """
    return band_of_from_elevs(tuple(s.evaluate(x, y) for s in surfaces), z)


def band_of_from_elevs(surf_elevs: tuple[float, ...], z: float) -> int:
    """Return the geological band index from PRECOMPUTED surface elevations.

    The precomputed-elevation variant of :func:`band_of`: it takes the surfaces'
    already-evaluated elevations at the query ``(x, y)`` (a tuple of floats,
    one per surface, in the surfaces' input order) instead of re-scanning each
    TIN.  Byte-identical to :func:`band_of` when ``surf_elevs`` is built with the
    SAME ``surface.evaluate(x, y)`` call, because the band rule is purely the
    count of elevations strictly above ``z`` — order-independent and using the
    identical ``>`` comparison.

    Parameters
    ----------
    surf_elevs : tuple of float
        The geological surfaces' elevations at the query ``(x, y)``, one per
        surface (order irrelevant — we count, not index).  Empty → band 0.
    z : float
        Elevation of the query point in metres (positive upward).

    Returns
    -------
    int
        Zero-based band index, 0 (shallowest) … ``len(surf_elevs)`` (deepest).
    """
    return sum(1 for e in surf_elevs if e > z)


def band_extent(
    surfaces: tuple[SurfaceBound, ...],
    x: float,
    y: float,
    band: int,
) -> tuple[float | None, float | None]:
    """Return the elevation bounds ``(base_elev, top_elev)`` of a geological band.

    Surfaces are sorted by their elevation at ``(x, y)`` descending (shallowest
    first) at the query point.  For ``n`` surfaces there are ``n + 1`` bands:

    * Band 0  — above every surface.
      ``top_elev = None`` (open), ``base_elev = elevation of the 1st surface``.
    * Band k (1 ≤ k ≤ n−1) — between the k-th and (k+1)-th surface (0-based).
      ``top_elev = elevation of the (k−1)-th surface``,
      ``base_elev = elevation of the k-th surface``.
    * Band n — below every surface.
      ``top_elev = elevation of the last surface``,
      ``base_elev = None`` (open).

    **Convention**: a ``z`` strictly inside the open interval
    ``(base_elev, top_elev)`` — treating ``None`` as −∞ / +∞ respectively —
    satisfies ``band_of(surfaces, x, y, z) == band``.  The strict ``>`` in
    ``band_of`` means a surface at the SAME elevation as ``z`` is NOT counted
    as above, so a point exactly on the top boundary belongs to the SHALLOWER
    band (not this one).  Equivalently, the band occupies the half-open
    interval ``[base_elev, top_elev)`` — base inclusive, top exclusive.

    Parameters
    ----------
    surfaces : tuple of SurfaceBound
        The geological band surfaces.  Need not be pre-sorted.
    x : float
        Easting of the query point in metres (project CRS).
    y : float
        Northing of the query point in metres (project CRS).
    band : int
        Zero-based band index (0 = shallowest, ``len(surfaces)`` = deepest).

    Returns
    -------
    tuple of (float or None, float or None)
        ``(base_elev, top_elev)`` where:

        * ``top_elev`` is the elevation of the surface that forms the TOP bound
          of this band, or ``None`` for the shallowest (open-top) band.
        * ``base_elev`` is the elevation of the surface that forms the BASE
          bound of this band, or ``None`` for the deepest (open-base) band.
    """
    # Evaluate each surface once at (x, y) and delegate to the precomputed
    # variant.  Callers that already hold the per-column elevations should call
    # band_extent_from_elevs directly to avoid re-scanning the TINs.
    return band_extent_from_elevs(tuple(s.evaluate(x, y) for s in surfaces), band)


def band_extent_from_elevs(
    surf_elevs: tuple[float, ...],
    band: int,
) -> tuple[float | None, float | None]:
    """Return a geological band's ``(base_elev, top_elev)`` from PRECOMPUTED elevs.

    The precomputed-elevation variant of :func:`band_extent`: it takes the
    surfaces' already-evaluated elevations at the query ``(x, y)`` instead of
    re-scanning each TIN.  Byte-identical to :func:`band_extent` when
    ``surf_elevs`` is built with the SAME ``surface.evaluate(x, y)`` call:

    * The descending-elevation sort is preserved exactly — ``sorted(surf_elevs,
      reverse=True)`` reproduces ``sorted(surfaces, key=evaluate, reverse=True)``
      on the identical float values, and Python's stable sort keeps equal
      elevations in input order in both paths, so the bounding-pair pick is the
      same.
    * The open-bound (``None``) rules and the ``band-1`` / ``band`` index picks
      are identical.

    Parameters
    ----------
    surf_elevs : tuple of float
        The geological surfaces' elevations at the query ``(x, y)`` (input
        order; sorted internally).  Need not be pre-sorted.
    band : int
        Zero-based band index (0 = shallowest, ``len(surf_elevs)`` = deepest).

    Returns
    -------
    tuple of (float or None, float or None)
        ``(base_elev, top_elev)`` — see :func:`band_extent` for the convention.
    """
    # Sort elevations shallowest-first (descending) — the same stable sort the
    # TIN path applies to the surfaces, on the identical float values.
    ordered = sorted(surf_elevs, reverse=True)

    # top_elev: the surface ABOVE this band (index band-1 in ordered), or None.
    top_elev: float | None = ordered[band - 1] if band > 0 else None

    # base_elev: the surface BELOW this band (index band in ordered), or None.
    base_elev: float | None = ordered[band] if band < len(ordered) else None

    return base_elev, top_elev


def section_reaches_band(
    stack: tuple[tuple[str, str, float, float], ...],
    surfaces: tuple[SurfaceBound, ...],
    x: float,
    y: float,
    band: int,
) -> bool:
    """Return whether any interval in ``stack`` overlaps the geological band.

    For each ``(body_id, formation_id, top_elev, base_elev)`` interval in the
    investigation's observed pick stack, check whether its elevation range
    ``[base_elev, top_elev]`` overlaps the band's extent at ``(x, y)`` by more
    than ``_EPS``.  A mere boundary touch (overlap of exactly zero) is NOT
    counted as reaching the band.

    Open band bounds (``None``) are treated as ±∞:
    * ``band_extent`` returns ``top_elev = None`` for the shallowest band (no
      upper geological surface) → treated as +∞.
    * ``band_extent`` returns ``base_elev = None`` for the deepest band (no
      lower geological surface) → treated as −∞.

    Parameters
    ----------
    stack : tuple of (str, str, float, float)
        The investigation's observed body intervals as
        ``(body_id, formation_id, top_elev_m, base_elev_m)`` tuples, where
        ``top_elev_m >= base_elev_m`` (absolute elevation, mTAW, positive up).
        May be empty (investigation has no body-assigned accepted picks).
    surfaces : tuple of SurfaceBound
        The geological band surfaces (order irrelevant).
    x : float
        Easting of the query point in metres (project CRS).
    y : float
        Northing of the query point in metres (project CRS).
    band : int
        Zero-based band index to test against.

    Returns
    -------
    bool
        True iff at least one interval's ``[base_elev, top_elev]`` overlaps the
        band's extent by more than ``_EPS``; False if the stack is empty or all
        intervals only touch (not overlap) the band boundary.
    """
    return section_reaches_band_from_elevs(stack, tuple(s.evaluate(x, y) for s in surfaces), band)


def section_reaches_band_from_elevs(
    stack: tuple[tuple[str, str, float, float], ...],
    surf_elevs: tuple[float, ...],
    band: int,
) -> bool:
    """Return whether any interval in ``stack`` reaches the band — PRECOMPUTED elevs.

    The precomputed-elevation variant of :func:`section_reaches_band`: it takes
    the surfaces' already-evaluated elevations at the query ``(x, y)`` instead of
    re-scanning each TIN.  Byte-identical to :func:`section_reaches_band` when
    ``surf_elevs`` is built with the SAME ``surface.evaluate(x, y)`` call,
    because the band extent comes from :func:`band_extent_from_elevs` (itself
    byte-identical) and the overlap arithmetic is unchanged.

    Parameters
    ----------
    stack : tuple of (str, str, float, float)
        The investigation's observed body intervals — see
        :func:`section_reaches_band`.  May be empty.
    surf_elevs : tuple of float
        The geological surfaces' elevations at the query ``(x, y)`` (input
        order; sorted internally by :func:`band_extent_from_elevs`).
    band : int
        Zero-based band index to test against.

    Returns
    -------
    bool
        True iff at least one interval overlaps the band's extent by more than
        ``_EPS``; False if the stack is empty or all intervals only touch.
    """
    if not stack:
        return False

    band_base, band_top = band_extent_from_elevs(surf_elevs, band)

    # Resolve None → ±∞ using float('inf') for the overlap arithmetic.
    b_top = float("inf") if band_top is None else band_top
    b_base = float("-inf") if band_base is None else band_base

    for _body_id, _formation_id, top_elev, base_elev in stack:
        # Two intervals [a_base, a_top] and [b_base, b_top] overlap by more
        # than epsilon iff their intersection length > _EPS.
        overlap = min(top_elev, b_top) - max(base_elev, b_base)
        if overlap > _EPS:
            return True

    return False
