"""Geology-bounding transforms on the litho-3D pick list.

Two pure transforms applied to the ``BodyLayerPick`` list inside
``RecomputeLithoSolids`` BEFORE ``build_body_solids``:

1. :func:`mark_and_truncate_shallow_tests` — flag, and truncate the deep
   part of, any test whose deepest point sits above the lowest geological
   boundary (it cannot floor the model). A flagged test keeps its litho only
   down to its lowest *correlated* contact; a flagged test with no correlated
   contact is excluded entirely.
2. ``divide_picks_by_geology`` (added in a later task) — give every column a
   litho contact at each geological boundary (snap geology→litho within
   tolerance, else divide a straddling layer), re-keying split bodies per
   geological unit so a body never crosses a boundary.

Both are pure (no I/O); the caller supplies geology-surface samplers built over
the parent geological model's ``FormationSurfaceOrm`` TINs. The geological
model itself is never modified (build-only).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, replace
from uuid import NAMESPACE_OID, uuid5

from groundmodel.domain.services.litho_body_pick import BodyLayerPick

#: Elevations within this margin are treated as coincident (numeric guard).
_EPS = 1e-6


def _elev(pick: BodyLayerPick, depth_m: float) -> float:
    """Convert a depth-below-surface to an absolute elevation.

    Parameters
    ----------
    pick : BodyLayerPick
        The pick whose surface elevation is used as the datum.
    depth_m : float
        Depth below the pick's surface elevation.

    Returns
    -------
    float
        Absolute elevation (surface_elev_m - depth_m).
    """
    return pick.surface_elev_m - depth_m


def _derived_body_id(parent_body_id: str, band_key: str) -> str:
    """Deterministic body id for a geology-split body half.

    Stable across rebuilds (``uuid5``) so a re-Build does not churn the solid
    cache. ``band_key`` is the formation id of the geological surface directly
    above the segment, or ``"TOP"`` when nothing is above it.

    Parameters
    ----------
    parent_body_id : str
        The original (resolver-assigned) body id.
    band_key : str
        Stable identity of the geological unit the segment lies in.

    Returns
    -------
    str
        A valid UUID string.
    """
    return str(uuid5(NAMESPACE_OID, f"{parent_body_id}:{band_key}"))


@dataclass(frozen=True)
class ShallowTestResult:
    """Result of :func:`mark_and_truncate_shallow_tests`.

    Attributes
    ----------
    picks : list[BodyLayerPick]
        The surviving picks (deep tests untouched; shallow tests truncated or
        dropped).
    marked_investigation_ids : list[str]
        Sorted ids of the tests flagged as too shallow.
    """

    picks: list[BodyLayerPick]
    marked_investigation_ids: list[str]


def mark_and_truncate_shallow_tests(
    picks: list[BodyLayerPick],
    lowest_boundary_elevation_at: Callable[[float, float], float | None],
) -> ShallowTestResult:
    """Flag + truncate tests that cannot reach the deepest geological band.

    A test whose deepest pick base sits ABOVE the lowest geological boundary at
    its location is flagged; its litho is kept only down to its lowest
    *correlated* contact (a contact whose body spans >= 2 investigations) and
    dropped below that. A flagged test with no correlated contact is excluded
    entirely. Every other test passes through unchanged.

    Parameters
    ----------
    picks : list[BodyLayerPick]
        Every body-assigned pick in the model.
    lowest_boundary_elevation_at : Callable[[float, float], float | None]
        ``(x, y) -> elevation`` of the deepest geological surface at that
        location, or ``None`` when no surface covers it.

    Returns
    -------
    ShallowTestResult
        Surviving picks + the flagged investigation ids.
    """
    by_inv: dict[str, list[BodyLayerPick]] = {}
    for p in picks:
        by_inv.setdefault(p.investigation_id, []).append(p)

    # A body is "correlated" iff it spans >= 2 distinct investigations.
    inv_by_body: dict[str, set[str]] = {}
    for p in picks:
        inv_by_body.setdefault(p.body_id, set()).add(p.investigation_id)
    correlated = {bid for bid, invs in inv_by_body.items() if len(invs) >= 2}

    out: list[BodyLayerPick] = []
    marked: list[str] = []
    for inv_id, ps in by_inv.items():
        floor = lowest_boundary_elevation_at(ps[0].x_m, ps[0].y_m)
        deepest_base = min(_elev(p, p.base_depth_m) for p in ps)
        if floor is None or deepest_base <= floor + _EPS:
            out.extend(ps)  # reaches the deepest band (or no floor to check)
            continue
        # The test bottoms above the lowest geological boundary — truncate it.
        corr = [p for p in ps if p.body_id in correlated]
        if not corr:
            # No lateral tie anywhere -> exclude entirely; test is marked.
            marked.append(inv_id)
            continue
        endpoint = min(_elev(p, p.base_depth_m) for p in corr)
        kept: list[BodyLayerPick] = []
        for p in ps:
            top_e = _elev(p, p.top_depth_m)
            if top_e <= endpoint + _EPS:
                continue  # entirely below the endpoint -> drop
            base_e = _elev(p, p.base_depth_m)
            if base_e < endpoint - _EPS:
                # straddles the endpoint -> truncate its base to the endpoint
                kept.append(replace(p, base_depth_m=p.surface_elev_m - endpoint))
            else:
                kept.append(p)
        out.extend(kept)
        # Only mark if the pick list actually changed (something was dropped or
        # truncated).  A test whose picks fit entirely within the correlated
        # endpoint is passed through without being listed as "marked" — it did
        # not need truncation even though it is technically above the floor.
        if kept != ps:
            marked.append(inv_id)
    return ShallowTestResult(picks=out, marked_investigation_ids=sorted(marked))
