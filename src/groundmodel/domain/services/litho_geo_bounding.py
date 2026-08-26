"""The shallow-test flag applied to the litho-3D pick list.

ONE pure transform, applied to the ``BodyLayerPick`` list by the geotech-model
builders (``SubdivideAllBodies``, ``DivideBoreholes``) before their per-band
work:

:func:`mark_and_truncate_shallow_tests` — FLAG any test whose deepest point sits
above the lowest geological boundary (it cannot floor the model). The test's
litho is KEPT in full; the flag is informational. (Owner directive 2026-06-25:
the deepest geological unit a test reaches owns everything down to TD, so deep
litho is never truncated/dropped — only flagged. The function name is retained
for call-site stability.)

**There is no second transform.** Until 2026-08-26 this module also carried
``divide_picks_by_geology``, which gave every column a litho contact at each
geological boundary and re-keyed the split bodies per geological unit — the
geological "wall". The owner deleted it: *"just drop the wall everywhere, user
wil have to manually do it"*. A geological surface no longer divides anything;
it only LABELS, and the label is applied where the geotech builders group their
segments (``GeotechBoreholeMaterialiser._geo_formation_at_midpoint``). Where the
engineer wants a division at a geological line he makes it by hand with the
split tool.

The transform is pure (no I/O); the caller supplies a geology-surface sampler
built over the parent geological model's ``FormationSurfaceOrm`` TINs. The
geological model itself is never modified (build-only).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

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


@dataclass(frozen=True)
class ShallowTestResult:
    """Result of :func:`mark_and_truncate_shallow_tests`.

    Attributes
    ----------
    picks : list[BodyLayerPick]
        All input picks, unchanged — too-shallow tests are flagged (see
        ``marked_investigation_ids``) but never truncated or dropped (owner
        directive 2026-06-25). Retained as an attribute because the callers
        thread this list on to their grouping pass; it is grouped by
        investigation, which is the order the builders depend on.
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
    TD; the test's deep litho is geo-LABELLED by the builders' grouping pass
    (``_geo_formation_at_midpoint``, which names the lowest geo surface still
    above the segment), never truncated or dropped. (The name is kept for
    call-site stability; truncation behaviour was removed.)

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
            # be retained and geo-LABELLED by the builders' grouping pass (which
            # names the lowest geo surface still above the segment), never
            # dropped -- even when those deep picks are uncorrelated single-test
            # data. (Before 2026-06-25 this truncated a flagged test to its deepest
            # correlated contact and dropped uncorrelated picks below, which left a
            # geotech column shallower than its litho -- the GEO-23/125-S7 dogfeed.)
            marked.append(inv_id)
        out.extend(ps)
    return ShallowTestResult(picks=out, marked_investigation_ids=sorted(marked))
