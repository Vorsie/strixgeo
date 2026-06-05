"""Plan enclosed-lens body merges — pure domain helper.

On *Fill bands* the owner wants a lithology that is split on one column only by a
LOCAL lens to read as ONE body (owner directive 2026-06-05: "the big sand is one
body"). A sand split by a silt/clay that pinches out toward a neighbour is one
sand; the silt/clay is the lens that wedges out.

This planner finds, per column, each *enclosed lens* — a ``host · lens · host``
triple where the two bracketing host units share a lithology and the middle unit
differs — whose lens lithology is **absent on a section-adjacent neighbour where
the host lithology runs continuously across the lens depth**. That neighbour is
proof the lens is a TRUE pinch-out, not a continuous interbed. For each such lens
it returns the cross-column edges joining the bracketing host halves to that
neighbour's continuous host unit, so the resolver groups them into one body.

The absent-on-a-neighbour guard is the safety rail: a genuine continuous clay
interbed (present on every neighbour) is never merged.

Cross-column depth is compared in absolute ELEVATION (mTAW), since adjacent
investigations have different surface levels. Pure function — no I/O, no DB, no
logging — so it is unit-testable and callable from any layer.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

# Elevation comparison tolerance (m). Boundaries within 1 cm are "coincident".
_EPS = 0.01


@dataclass(frozen=True)
class MergeLayer:
    """One accepted litho layer on a column, in absolute elevation.

    Attributes
    ----------
    layer_id : UUID
        The litho_layer id (post-A4 also its top contact id).
    inv_id : UUID
        The anchor investigation (cpt or borehole) id.
    top_elev : float
        Absolute elevation (mTAW) of the unit's top (the SHALLOWER, higher value).
    base_elev : float
        Absolute elevation (mTAW) of the unit's base (the deeper, lower value).
    soil : str
        ``litho_main_soil_code`` (KLEI / ZAND / SILT / …) — the merge axis.
    """

    layer_id: UUID
    inv_id: UUID
    top_elev: float
    base_elev: float
    soil: str


@dataclass(frozen=True)
class MergeEdge:
    """A cross-column correlation edge to create (host half ↔ neighbour host)."""

    host_layer_id: UUID
    neighbour_layer_id: UUID


def _overlaps(unit: MergeLayer, lo: float, hi: float) -> bool:
    """Return True iff ``unit``'s elevation span overlaps ``[lo, hi]``."""
    return unit.top_elev > lo + _EPS and unit.base_elev < hi - _EPS


def plan_enclosed_lens_merges(
    stacks: dict[UUID, list[MergeLayer]],
    along: dict[UUID, float],
) -> list[MergeEdge]:
    """Plan the host-half → neighbour edges that merge enclosed-lens hosts.

    Parameters
    ----------
    stacks : dict[UUID, list[MergeLayer]]
        ``investigation_id -> layers`` for the model, each list ordered by
        DEPTH ascending (top_elev descending — shallowest first), gap-free.
    along : dict[UUID, float]
        ``investigation_id -> along-section distance``. Only investigations
        present here are considered; the section's column order defines which
        neighbours are adjacent.

    Returns
    -------
    list[MergeEdge]
        De-duplicated edges to create (``user_approved`` correlation edges).
        Empty when no enclosed lens is a true pinch-out. After creating them
        and re-resolving, every bracketing host half joins the neighbour's
        continuous host unit → one body.
    """
    ordered = sorted((i for i in stacks if i in along), key=lambda i: along[i])
    edges: list[MergeEdge] = []
    seen: set[tuple[UUID, UUID]] = set()

    for idx, inv in enumerate(ordered):
        units = stacks[inv]
        n = len(units)
        neighbours: list[UUID] = []
        if idx > 0:
            neighbours.append(ordered[idx - 1])
        if idx < len(ordered) - 1:
            neighbours.append(ordered[idx + 1])

        for i in range(1, n - 1):
            host_above, lens, host_below = units[i - 1], units[i], units[i + 1]
            # Enclosed-lens pattern: same host lithology bracketing a different one.
            if host_above.soil != host_below.soil or lens.soil == host_above.soil:
                continue
            host_soil = host_above.soil
            lens_soil = lens.soil
            lo = min(lens.base_elev, lens.top_elev)
            hi = max(lens.base_elev, lens.top_elev)

            for nb in neighbours:
                nb_units = stacks[nb]
                # GUARD: the lens lithology must be ABSENT on the neighbour over
                # the lens band — otherwise it is a continuous interbed, not a
                # pinch, and the hosts must stay separate.
                if any(u.soil == lens_soil and _overlaps(u, lo, hi) for u in nb_units):
                    continue
                # The neighbour's continuous host unit covering the lens band
                # (prefer one that fully spans it; fall back to any overlap).
                host_unit = next(
                    (
                        u
                        for u in nb_units
                        if u.soil == host_soil
                        and u.top_elev >= hi - _EPS
                        and u.base_elev <= lo + _EPS
                    ),
                    None,
                )
                if host_unit is None:
                    host_unit = next(
                        (u for u in nb_units if u.soil == host_soil and _overlaps(u, lo, hi)),
                        None,
                    )
                if host_unit is None:
                    continue
                for h in (host_above, host_below):
                    key = (h.layer_id, host_unit.layer_id)
                    if key not in seen:
                        seen.add(key)
                        edges.append(MergeEdge(h.layer_id, host_unit.layer_id))
                break  # one neighbour is enough to merge this lens's hosts

    return edges
