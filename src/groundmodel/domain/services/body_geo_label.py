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


def _accrue_members(
    members: list[tuple[UUID, float, float]],
    geo_contacts_by_investigation: dict[UUID, list[tuple[float, UUID]]],
) -> tuple[dict[UUID, float], dict[UUID, float]]:
    """Attribute each member to a geological formation by its midpoint depth.

    The single accrual pass shared by both public derivations
    (``majority_geo_formation`` and ``geo_formations_present``): for each member
    layer, the geological formation owning its MIDPOINT depth accrues that
    member's thickness, and the formation records the shallowest member top
    attributed to it. A member whose midpoint falls in no formation contributes
    nothing. The two derivations differ only in how they REDUCE these two dicts.

    Parameters
    ----------
    members : list[tuple[UUID, float, float]]
        ``(investigation_id, depth_top_m, depth_base_m)`` for each member layer.
    geo_contacts_by_investigation : dict[UUID, list[tuple[float, UUID]]]
        Per-investigation geological contacts, each list ascending by depth.

    Returns
    -------
    tuple[dict[UUID, float], dict[UUID, float]]
        ``(thickness_by_formation, shallowest_top_by_formation)``. The two dicts
        share the same key set — a formation appears in both exactly when a
        member's midpoint resolved to it.
    """
    thickness: dict[UUID, float] = defaultdict(float)
    shallowest_top: dict[UUID, float] = {}
    for investigation_id, depth_top_m, depth_base_m in members:
        midpoint = (depth_top_m + depth_base_m) / 2.0
        geo_fid = geo_formation_at_depth(
            geo_contacts_by_investigation.get(investigation_id, []), midpoint
        )
        if geo_fid is None:
            continue
        thickness[geo_fid] += max(0.0, depth_base_m - depth_top_m)
        if geo_fid not in shallowest_top or depth_top_m < shallowest_top[geo_fid]:
            shallowest_top[geo_fid] = depth_top_m
    return thickness, shallowest_top


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
    thickness, _ = _accrue_members(members, geo_contacts_by_investigation)
    if not thickness:
        return None
    # Greatest total thickness wins; smallest UUID breaks ties deterministically.
    return min(thickness, key=lambda fid: (-thickness[fid], str(fid)))


def geo_formations_present(
    members: list[tuple[UUID, float, float]],
    geo_contacts_by_investigation: dict[UUID, list[tuple[float, UUID]]],
) -> list[UUID]:
    """Return every geological formation this body's members fall in.

    R2 (owner ruling 2026-08-31): a body crossing two geological formations
    LISTS them both — the unit row and the exports carry the full set, not a
    single majority stamp. Attribution is the SAME midpoint rule the majority
    uses: a formation appears exactly when it owns at least one member's
    midpoint, so there is no invented inclusion threshold.

    The list is ordered by the shallowest member attributed to each formation
    (shallowest first). Ties break to the formation owning the greater member
    thickness, then to the smallest UUID, so the order is total and
    deterministic. The singular ``majority_geo_formation`` stays the
    thickness-weighted winner and is unaffected by this function.

    Parameters
    ----------
    members : list[tuple[UUID, float, float]]
        ``(investigation_id, depth_top_m, depth_base_m)`` for each member layer.
    geo_contacts_by_investigation : dict[UUID, list[tuple[float, UUID]]]
        Per-investigation geological contacts, each list ascending by depth.

    Returns
    -------
    list[UUID]
        The geological formation ids the body's members fall in, shallowest
        first. Empty when no member's midpoint falls within any geological
        formation (e.g. no geological model defined at these investigations).
    """
    # Shared accrual: thickness (tie-break) + the shallowest attributed member
    # top (primary sort). Both dicts share the same key set.
    thickness, shallowest_top = _accrue_members(members, geo_contacts_by_investigation)
    # Shallowest first; larger thickness share first on a tie; smallest UUID last.
    return sorted(
        thickness,
        key=lambda fid: (shallowest_top[fid], -thickness[fid], str(fid)),
    )
