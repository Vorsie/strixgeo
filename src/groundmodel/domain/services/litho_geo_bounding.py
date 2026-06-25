"""Geology-bounding transforms on the litho-3D pick list.

Two pure transforms applied to the ``BodyLayerPick`` list inside
``RecomputeLithoSolids`` before the watertight loft is assembled:

1. :func:`mark_and_truncate_shallow_tests` — FLAG any test whose deepest point
   sits above the lowest geological boundary (it cannot floor the model). The
   test's litho is KEPT in full; the flag is informational. (Owner directive
   2026-06-25: the deepest geological unit a test reaches owns everything down to
   TD, so deep litho is never truncated/dropped — only flagged. The function name
   is retained for call-site stability.)
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

#: ``(x, y) -> [(formation_id, elevation), ...]`` for every finite geological
#: surface at that location, sorted by elevation DESCENDING (top surface first).
BoundarySampler = Callable[[float, float], list[tuple[str, float]]]


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
        All input picks, unchanged — too-shallow tests are flagged (see
        ``marked_investigation_ids``) but never truncated or dropped (owner
        directive 2026-06-25). Retained as an attribute for callers that still
        thread the result through ``divide_picks_by_geology``.
    marked_investigation_ids : list[str]
        Sorted ids of the tests flagged as too shallow.
    """

    picks: list[BodyLayerPick]
    marked_investigation_ids: list[str]


def mark_and_truncate_shallow_tests(
    picks: list[BodyLayerPick],
    lowest_boundary_elevation_at: Callable[[float, float], float | None],
) -> ShallowTestResult:
    """Flag tests that cannot reach the deepest geological band (litho kept).

    A test whose deepest pick base sits ABOVE the lowest geological boundary at
    its location is flagged in ``marked_investigation_ids`` — but ALL its litho is
    retained. Owner directive 2026-06-25: a geological boundary is a TOP, so the
    deepest geological unit a test reaches owns everything from its top down to
    TD; the test's deep litho is geo-assigned by ``divide_picks_by_geology``
    (which bands each segment by the lowest geo surface still above it), never
    truncated or dropped. (The name is kept for call-site stability; truncation
    behaviour was removed.)

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

    out: list[BodyLayerPick] = []
    marked: list[str] = []
    for inv_id, ps in by_inv.items():
        floor = lowest_boundary_elevation_at(ps[0].x_m, ps[0].y_m)
        deepest_base = min(_elev(p, p.base_depth_m) for p in ps)
        if floor is not None and deepest_base > floor + _EPS:
            # The test bottoms ABOVE the lowest geological boundary -> FLAG it
            # (informational), but KEEP all its litho. Owner directive 2026-06-25:
            # a geological boundary is a TOP, so the deepest geological unit a test
            # reaches owns everything from its top down to TD. The deep litho must
            # be retained and geo-assigned by ``divide_picks_by_geology`` (which
            # bands each segment by the lowest geo surface still above it), never
            # dropped -- even when those deep picks are uncorrelated single-test
            # data. (Before 2026-06-25 this truncated a flagged test to its deepest
            # correlated contact and dropped uncorrelated picks below, which left a
            # geotech column shallower than its litho -- the GEO-23/125-S7 dogfeed.)
            marked.append(inv_id)
        out.extend(ps)
    return ShallowTestResult(picks=out, marked_investigation_ids=sorted(marked))


def divide_picks_by_geology(
    picks: list[BodyLayerPick],
    boundary_elevations_at: BoundarySampler,
    snap_tolerance_m: float,
) -> list[BodyLayerPick]:
    """Confine every body to a single geological band.

    Per column, place a litho contact at each geological boundary: SNAP (no
    cut) when the boundary is within ``snap_tolerance_m`` of an existing
    contact (the observed litho contact serves as the divider — geology→litho),
    else DIVIDE (cut the straddling layer at the geological surface). A body
    that ends up in more than one geological unit is re-keyed per unit
    (:func:`_derived_body_id`) so it becomes two distinct band-confined bodies;
    a body that stays within one unit keeps its original ``body_id``.

    Parameters
    ----------
    picks : list[BodyLayerPick]
        Body-assigned picks (already shallow-test handled).
    boundary_elevations_at : BoundarySampler
        ``(x, y) -> [(formation_id, elevation), ...]`` sorted top-first.
    snap_tolerance_m : float
        A geological boundary within this distance of an existing contact is
        treated as coincident with it (no cut).

    Returns
    -------
    list[BodyLayerPick]
        Band-confined picks; split bodies carry derived ids.
    """
    # Sample geology once per investigation location.
    samples_by_inv: dict[str, list[tuple[str, float]]] = {}
    for p in picks:
        if p.investigation_id not in samples_by_inv:
            samples_by_inv[p.investigation_id] = boundary_elevations_at(p.x_m, p.y_m)

    def _segments(p: BodyLayerPick) -> list[tuple[float, float, str]]:
        """Split one pick into ``(seg_top_elev, seg_base_elev, band_key)`` parts."""
        samples = samples_by_inv[p.investigation_id]
        top_e = _elev(p, p.top_depth_m)
        base_e = _elev(p, p.base_depth_m)
        tol = snap_tolerance_m
        # A boundary within ``tol`` of the pick's own top/base is a SNAP (no cut).
        cuts = sorted(
            (elev for _fid, elev in samples if base_e + tol < elev < top_e - tol),
            reverse=True,
        )
        edges = [top_e, *cuts, base_e]
        segs: list[tuple[float, float, str]] = []
        for i in range(len(edges) - 1):
            seg_top, seg_base = edges[i], edges[i + 1]
            mid = 0.5 * (seg_top + seg_base)
            above = [(fid, elev) for fid, elev in samples if elev > mid]
            # band_key = the lowest geological surface still above the segment.
            band_key = min(above, key=lambda fe: fe[1])[0] if above else "TOP"
            segs.append((seg_top, seg_base, band_key))
        return segs

    segs_by_pick: dict[int, list[tuple[float, float, str]]] = {
        idx: _segments(p) for idx, p in enumerate(picks)
    }

    # A body is "split" iff its segments span more than one band_key.
    bands_by_body: dict[str, set[str]] = {}
    for idx, p in enumerate(picks):
        for _t, _b, band_key in segs_by_pick[idx]:
            bands_by_body.setdefault(p.body_id, set()).add(band_key)
    split_bodies = {bid for bid, keys in bands_by_body.items() if len(keys) > 1}

    out: list[BodyLayerPick] = []
    for idx, p in enumerate(picks):
        for seg_top, seg_base, band_key in segs_by_pick[idx]:
            body_id = (
                _derived_body_id(p.body_id, band_key) if p.body_id in split_bodies else p.body_id
            )
            out.append(
                replace(
                    p,
                    body_id=body_id,
                    top_depth_m=p.surface_elev_m - seg_top,
                    base_depth_m=p.surface_elev_m - seg_base,
                )
            )
    return out
