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

Left / right assignment — nearest target on each side
-----------------------------------------------------
Body extents are section-scoped (2D): ``investigation_along_positions`` is
the active section's along-order.  When it is supplied, the algorithm
partitions a candidate's closure targets by side of the source
(``along[target] < along[source]`` = left) and closes each side to the
**nearest** target — the largest along still below the source on the left,
the smallest along still above it on the right.  This stops a body at the
adjacent correlated contact instead of tapering all the way to the most
distant test (the dogfeed bug, 2026-06-03).  A candidate whose closure
targets all sit on one side of the source on this section is a unilateral
pinch-out, not a bilateral body, and is skipped.

When ``investigation_along_positions`` is absent (a section-less call, e.g.
direct unit tests), the fallback is UUID integer ordering — left =
lowest-UUID target investigation, right = highest.  Deterministic but not
geometrically meaningful; production always supplies the active section.

Each side's ``BodyExtent`` carries:
- ``kind = 'to_target'``
- ``target_contact_id`` — the target contact the closure lands at
- ``neighbour_investigation_id`` — the investigation that contact lives on
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
    # Section mode: a non-None positions map means the caller scoped detection
    # to one active section.  In that mode a candidate whose source is not on
    # the section is skipped (another section's pass owns it); the UUID
    # fallback only applies to section-less calls (None map — tests / legacy).
    section_mode = investigation_along_positions is not None

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

        # Assign left/right.  With section geometry the body closes to the
        # NEAREST target on each side (the contact the correlations land at on
        # the adjacent column); without geometry we fall back to UUID ordering.
        source_along = along.get(source_inv_id)

        if section_mode:
            # Section-aware: this pass is scoped to one active section.
            if source_along is None:
                # Source not projected onto the active section → not this
                # section's body; another section's detect pass owns it.
                continue
            # Partition targets by side of the source along the section line,
            # then pick the NEAREST on each side.  Picking the outermost (the
            # old behaviour) made every body taper all the way to the most-
            # distant test instead of stopping at the adjacent correlated
            # contact (dogfeed 2026-06-03).
            left_side = [
                (along[i], i)
                for i in best_per_inv
                if along.get(i) is not None and along[i] < source_along
            ]
            right_side = [
                (along[i], i)
                for i in best_per_inv
                if along.get(i) is not None and along[i] > source_along
            ]
            if not left_side or not right_side:
                # All closure targets on one side of the source on this
                # section → a unilateral pinch-out, not a bilateral body
                # (owner directive 2026-05-31).  Skip it.
                continue
            # Nearest left = largest along still below the source; nearest right
            # = smallest along still above it.
            left_inv = max(left_side)[1]
            right_inv = min(right_side)[1]
        else:
            # Geometry absent (no active section) — deterministic UUID fallback:
            # left = lowest-UUID target investigation, right = highest.  Not
            # geometrically meaningful, but stable for tests / section-less calls.
            sorted_invs = sorted(best_per_inv.keys(), key=lambda i: i.int)
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
