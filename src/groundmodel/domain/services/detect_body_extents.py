"""Pure domain algorithm — body extent detection from the contact-edge graph.

Replaces ``detect_lenses_from_graph`` (Task 2.2 / body-with-extent redesign).
Returns ``DetectedBody`` records with per-side ``BodyExtent`` markers instead
of ``LensCandidate`` objects.

Topology — bilateral closure required
--------------------------------------
A body is detected only when its enclosing layer converges to a single
boundary on **at least two distinct neighbouring investigations**.

Concretely, for a candidate body framed by two contacts ``(c_above,
c_below)`` on source investigation A, the algorithm collects every target
contact ``t`` such that BOTH ``c_above`` and ``c_below`` have a user-approved
edge to ``t``.  Each such ``t`` lives on some target investigation; the body
is emitted iff **at least two distinct target investigations** carry such a
``t`` (bilateral closure rule — owner directive 2026-05-31).

Left / right assignment
-----------------------
Once two target investigations I_L and I_R are identified, the algorithm
assigns *left* to the investigation that appears to the left of the source
along the section line.  When ``investigation_along_positions`` is supplied
and both targets appear in it, the comparison is ``along[target] < along[source]``
(left = smaller along value).  When the dict is absent or a target
investigation is missing from it, the fallback is UUID integer ordering
(lower UUID int = left) — deterministic but not geometrically meaningful.

Each side's ``BodyExtent`` carries:
- ``kind = 'to_target'``
- ``target_contact_id`` — the target contact the closure lands at
- ``neighbour_investigation_id`` — the investigation that contact lives on

When more than two target investigations are present (unusual but possible
for a body enclosed by many neighbours), the algorithm picks the
lowest-UUID-investigation target for each side.  This is a conservative
heuristic; spatial refinement can layer on top when section geometry is
available.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from uuid import UUID

from groundmodel.domain.services.body_extent import BodyExtent, DetectedBody
from groundmodel.shared.constants.extent_kind import EXTENT_KIND_TO_TARGET


@dataclass(frozen=True)
class ContactStackEntry:
    """One contact within an investigation's depth-sorted stack.

    Parameters
    ----------
    contact_id : UUID
        The unique id of this contact row.
    formation_id : UUID
        The formation whose top is marked by this contact (Strix convention:
        ``FormationContact.formation_id`` is the formation that starts here
        and extends downward to the next contact).
    depth_top_m : float
        Depth of this contact in metres, positive-down.
    """

    contact_id: UUID
    formation_id: UUID
    depth_top_m: float


@dataclass(frozen=True)
class ContactStack:
    """All contacts on one investigation, sorted by depth_top_m ascending.

    Parameters
    ----------
    investigation_id : UUID
        The investigation this stack belongs to.
    entries : tuple[ContactStackEntry, ...]
        Depth-sorted contact entries for this investigation.
    """

    investigation_id: UUID
    entries: tuple[ContactStackEntry, ...]


@dataclass(frozen=True)
class ContactEdge:
    """User-approved contact-correlation edge.

    Parameters
    ----------
    contact_a_id : UUID
        First endpoint of the edge.
    contact_b_id : UUID
        Second endpoint of the edge.
    """

    contact_a_id: UUID
    contact_b_id: UUID


def detect_body_extents(
    edges: list[ContactEdge],
    stacks: list[ContactStack],
    max_body_thickness_m: float | None = None,
    investigation_along_positions: dict[UUID, float] | None = None,
) -> list[DetectedBody]:
    """Detect enclosed body extents from the user-approved contact-edge graph.

    Parameters
    ----------
    edges : list[ContactEdge]
        All user-approved contact-correlation edges.  The caller filters
        ``user_approved=True`` before calling.
    stacks : list[ContactStack]
        Per-investigation depth-sorted contact stacks.  Each contact_id
        referenced in ``edges`` must appear in exactly one stack.
    max_body_thickness_m : float | None
        Degeneracy guard.  When set, a candidate body thicker than this
        value (``depth_below - depth_above`` on the source investigation) is
        rejected as a spurious detection.  ``None`` disables the guard.
    investigation_along_positions : dict[UUID, float] | None
        Maps investigation_id → along-section distance (metres).  Used to
        assign left/right extents: the target investigation with
        ``along < source_along`` is left; the other is right.  When absent
        or when a target investigation is not in the dict, UUID integer
        ordering is the fallback (lower UUID int = left).

    Returns
    -------
    list[DetectedBody]
        One record per detected body, sorted by
        (source_investigation_id, contact_above_id, contact_below_id) for
        determinism.  Each body has both ``extent_left`` and
        ``extent_right`` populated with ``kind='to_target'``.

    Raises
    ------
    None
        All error cases (unknown contact ids, malformed stacks) are handled
        silently — the algorithm skips entries it cannot resolve.
    """
    # --- Index build ---------------------------------------------------------

    # contact_id → (investigation_id, formation_id, depth)
    contact_meta: dict[UUID, tuple[UUID, UUID, float]] = {}
    for stack in stacks:
        ordered = sorted((e.depth_top_m, e.contact_id, e.formation_id) for e in stack.entries)
        for depth, cid, fid in ordered:
            contact_meta[cid] = (stack.investigation_id, fid, depth)

    # adjacency: contact_id → list of neighbour contact ids (bidirectional)
    neighbours: dict[UUID, list[UUID]] = defaultdict(list)
    for e in edges:
        neighbours[e.contact_a_id].append(e.contact_b_id)
        neighbours[e.contact_b_id].append(e.contact_a_id)

    # --- Step 1: accumulate (source_inv, c_above, c_below) → targets ---------
    # For each target contact t, collect all source-investigation neighbours
    # that share t as a common pinch-out point.  A group of ≥2 contacts on
    # the same source investigation framing an adjacent pair constitutes a
    # closure onto t.
    candidate_acc: dict[tuple[UUID, UUID, UUID], list[tuple[UUID, UUID, UUID]]] = defaultdict(list)
    # key: (source_inv_id, c_above_id, c_below_id)
    # value: list of (target_inv_id, target_contact_id, fid_above)

    for target_id, neigh in neighbours.items():
        target_meta = contact_meta.get(target_id)
        if target_meta is None:
            continue
        target_inv_id, _, _ = target_meta

        # Group neighbouring contacts by their investigation.
        by_inv: dict[UUID, list[tuple[float, UUID, UUID]]] = defaultdict(list)
        for n_id in neigh:
            n_meta = contact_meta.get(n_id)
            if n_meta is None:
                continue
            n_inv_id, n_fid, n_depth = n_meta
            if n_inv_id == target_inv_id:
                # Self-loop guard: contacts on the same investigation as the
                # target cannot frame a body that pinches out to that target.
                continue
            by_inv[n_inv_id].append((n_depth, n_id, n_fid))

        for source_inv_id, source_neigh in by_inv.items():
            if len(source_neigh) < 2:
                # Need ≥2 source contacts to frame a body (top + base).
                continue
            source_neigh.sort()  # depth ascending
            # Adjacent pairs produce (N-1) stacked candidate bodies.
            for k in range(len(source_neigh) - 1):
                depth_above, cid_above, fid_above = source_neigh[k]
                depth_below, cid_below, _ = source_neigh[k + 1]

                # Degeneracy guard: skip bodies exceeding the thickness cap.
                # A real enclosed body is a thin unit; a near-whole-column
                # closure from a loose correlation is a spurious detection.
                if (
                    max_body_thickness_m is not None
                    and depth_below - depth_above > max_body_thickness_m
                ):
                    continue

                candidate_acc[(source_inv_id, cid_above, cid_below)].append(
                    (target_inv_id, target_id, fid_above)
                )

    # --- Step 2: bilateral filter + left/right assignment --------------------
    # Emit only candidates that close on ≥2 distinct target investigations.
    # Assign left/right extents using along-position comparison when available,
    # falling back to UUID ordering otherwise.
    out: list[DetectedBody] = []
    along = investigation_along_positions or {}

    for (source_inv_id, cid_above, cid_below), targets in candidate_acc.items():
        distinct_target_invs = {tinv for tinv, _, _ in targets}
        if len(distinct_target_invs) < 2:
            # Unilateral closure — a pinch-out wedge, not a bilateral body.
            # Owner directive 2026-05-31.
            continue

        # Per investigation, pick the deterministic representative contact
        # (lowest UUID contact) in case multiple contacts from the same
        # target investigation ended up in the list.
        best_per_inv: dict[UUID, tuple[UUID, UUID]] = {}  # inv → (contact_id, fid_above)
        for tinv, tcid, fid_above in targets:
            existing = best_per_inv.get(tinv)
            if existing is None or tcid < existing[0]:
                best_per_inv[tinv] = (tcid, fid_above)

        # Assign left/right: use along-position when available; UUID fallback.
        source_along = along.get(source_inv_id)

        def _sort_key(inv_id: UUID) -> tuple[int, int]:
            """Sort key: (along-position bucket, UUID int).

            Along-position bucket: 0 = left (along < source or fallback),
            1 = right.  When source_along is None or inv not in along dict,
            both sides use UUID ordering (bucket always 0, UUID discriminates).
            """
            inv_along = along.get(inv_id)
            if source_along is not None and inv_along is not None:
                # 0 = left side (smaller along); 1 = right side.
                bucket = 0 if inv_along < source_along else 1
            else:
                # Fallback: sort purely by UUID int; left = smaller UUID.
                bucket = 0
            return (bucket, inv_id.int)

        sorted_invs = sorted(best_per_inv.keys(), key=_sort_key)

        # Pick canonical left and right target investigations.
        # "left" = first in sorted order (lowest along or lowest UUID);
        # "right" = last in sorted order.  When exactly two, this is clean.
        # When more than two, we pick the outermost pair.
        left_inv = sorted_invs[0]
        right_inv = sorted_invs[-1]

        left_contact, fid_above_left = best_per_inv[left_inv]
        right_contact, fid_above_right = best_per_inv[right_inv]

        # formation_id: the body between c_above and c_below carries the
        # formation whose top is c_above (Strix convention).
        fid = fid_above_left  # same formation regardless of which side we read

        extent_left = BodyExtent(
            kind=EXTENT_KIND_TO_TARGET,
            target_contact_id=left_contact,
            neighbour_investigation_id=left_inv,
        )
        extent_right = BodyExtent(
            kind=EXTENT_KIND_TO_TARGET,
            target_contact_id=right_contact,
            neighbour_investigation_id=right_inv,
        )

        out.append(
            DetectedBody(
                formation_id=fid,
                source_investigation_id=source_inv_id,
                contact_above_id=cid_above,
                contact_below_id=cid_below,
                extent_left=extent_left,
                extent_right=extent_right,
            )
        )

    # Deterministic output order.
    out.sort(
        key=lambda b: (
            str(b.source_investigation_id),
            str(b.contact_above_id),
            str(b.contact_below_id),
        )
    )
    return out
