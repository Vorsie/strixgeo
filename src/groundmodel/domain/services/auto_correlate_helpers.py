"""Shared helpers for the auto-correlate algorithms.

These helpers were originally defined inline in ``auto_correlate.py``
(formation-level, #127).  Phase 2+3 of #133 extracts them so the new
contact-level algorithm (``auto_correlate_contact_edges.py``) can reuse
them without depending on the formation-level module — which is being
removed in this same slice.

The module is pure: no I/O, no ORM, no SQLAlchemy, no FastAPI, no logging.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class _CandidatePair:
    """One within-window candidate between two formations at different columns.

    Attributes
    ----------
    formation_a_id : UUID
        The formation at column A.
    formation_b_id : UUID
        The formation at column B.
    depth_a : float
        Depth of the contact at column A (metres).
    depth_b : float
        Depth of the contact at column B (metres).
    residual : float
        Absolute depth residual |depth_b - predicted_b|.
    """

    formation_a_id: UUID
    formation_b_id: UUID
    depth_a: float
    depth_b: float
    residual: float


def _mutual_nearest_neighbour(
    candidates: list[_CandidatePair],
) -> list[_CandidatePair]:
    """Reduce candidates to mutually-nearest-neighbour pairs.

    For each formation on column A, find the candidate on column B with the
    smallest residual.  For each formation on column B, find the candidate
    on column A with the smallest residual.  Accept only pairs where both
    sides nominate each other.

    Parameters
    ----------
    candidates : list[_CandidatePair]
        All within-window candidate pairs for a single (group, column-pair).

    Returns
    -------
    list[_CandidatePair]
        Deduplicated list of mutually-nearest pairs.  At most one pair per
        formation id on either side.
    """
    if not candidates:
        return []

    # best_b_for_a[fa_id] = (residual, candidate)
    best_b_for_a: dict[UUID, tuple[float, _CandidatePair]] = {}
    # best_a_for_b[fb_id] = (residual, candidate)
    best_a_for_b: dict[UUID, tuple[float, _CandidatePair]] = {}

    for cand in candidates:
        cur_b = best_b_for_a.get(cand.formation_a_id)
        if cur_b is None or cand.residual < cur_b[0]:
            best_b_for_a[cand.formation_a_id] = (cand.residual, cand)

        cur_a = best_a_for_b.get(cand.formation_b_id)
        if cur_a is None or cand.residual < cur_a[0]:
            best_a_for_b[cand.formation_b_id] = (cand.residual, cand)

    accepted: list[_CandidatePair] = []
    seen_a: set[UUID] = set()
    seen_b: set[UUID] = set()

    for fa_id, (_, cand) in best_b_for_a.items():
        if fa_id in seen_a or cand.formation_b_id in seen_b:
            continue
        # Mutual check: does B's best-A point back to fa_id?
        b_best = best_a_for_b.get(cand.formation_b_id)
        if b_best is not None and b_best[1].formation_a_id == fa_id:
            accepted.append(cand)
            seen_a.add(fa_id)
            seen_b.add(cand.formation_b_id)

    return accepted


# Public alias — the underscore-prefixed names are kept as the canonical
# spelling for parity with the original inline definitions in
# auto_correlate.py.  ``mutual_nearest_neighbour`` (no leading underscore)
# is the preferred public import going forward.
mutual_nearest_neighbour = _mutual_nearest_neighbour
