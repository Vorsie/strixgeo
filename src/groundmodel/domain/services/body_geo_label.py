"""Derive a body's geological-formation label by thickness-weighted majority.

A2 (owner directive 2026-06-04): a litho body is geologically agnostic — it
may span geological-formation boundaries. Its geological "name" (e.g.
"Pleistoceen") is a DERIVED attribute, not an identity constraint: the
geological formation that owns the majority of the body's member-layer
thickness. It is computed fresh from the body's current membership + the
geological model's contacts every time it is read, so it stays correct when
either the litho bodies merge/split or the geological surfaces are edited.

Pure — no I/O, no database access. The caller (the bodies API) loads the
members + geological contacts and calls these functions.
"""

from __future__ import annotations

from collections import defaultdict
from uuid import UUID


def geo_formation_at_depth(
    contacts_sorted: list[tuple[float, UUID]], depth_m: float
) -> UUID | None:
    """Return the geological formation id whose interval contains ``depth_m``.

    Geological contacts mark the TOP of each formation. Given one
    investigation's contacts sorted ascending by ``depth_top_m``, the formation
    containing ``depth_m`` is the one with the deepest top at or above it.

    Parameters
    ----------
    contacts_sorted : list[tuple[float, UUID]]
        ``(depth_top_m, geo_formation_id)`` for one investigation, ascending by
        depth.
    depth_m : float
        The depth to classify.

    Returns
    -------
    UUID | None
        The owning geological formation id, or ``None`` when ``depth_m`` is
        above the shallowest contact (no formation defined there).
    """
    result: UUID | None = None
    for depth_top, fid in contacts_sorted:
        if depth_top <= depth_m:
            result = fid
        else:
            break
    return result


def majority_geo_formation(
    members: list[tuple[UUID, float, float]],
    geo_contacts_by_investigation: dict[UUID, list[tuple[float, UUID]]],
) -> UUID | None:
    """Return a body's majority geological formation by member thickness.

    For each member layer, the geological formation owning its MIDPOINT depth
    (at the member's investigation) accrues that member's thickness. The
    formation with the greatest total thickness wins; ties break to the
    smallest UUID for determinism.

    Parameters
    ----------
    members : list[tuple[UUID, float, float]]
        ``(investigation_id, depth_top_m, depth_base_m)`` for each member layer.
    geo_contacts_by_investigation : dict[UUID, list[tuple[float, UUID]]]
        Per-investigation geological contacts, each list ascending by depth.

    Returns
    -------
    UUID | None
        The majority geological formation id, or ``None`` when no member's
        midpoint falls within any geological formation (e.g. no geological
        model defined at these investigations).
    """
    thickness: dict[UUID, float] = defaultdict(float)
    for investigation_id, depth_top_m, depth_base_m in members:
        midpoint = (depth_top_m + depth_base_m) / 2.0
        geo_fid = geo_formation_at_depth(
            geo_contacts_by_investigation.get(investigation_id, []), midpoint
        )
        if geo_fid is not None:
            thickness[geo_fid] += max(0.0, depth_base_m - depth_top_m)
    if not thickness:
        return None
    # Greatest total thickness wins; smallest UUID breaks ties deterministically.
    return min(thickness, key=lambda fid: (-thickness[fid], str(fid)))
