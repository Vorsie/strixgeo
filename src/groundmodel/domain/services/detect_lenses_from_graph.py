"""Pure domain algorithm — lens detection from the #135 topology (#133 Phase 2+3).

Consumes the user-approved contact-edge graph plus per-investigation
contact stacks; returns ``LensCandidate`` rows the application layer
materialises as ``LithoLensOrm`` records.

Topology — bilateral pinch-out required
---------------------------------------
A lens body is detected only when its enclosing layer pinches out to a
single boundary on **at least two distinct neighbouring investigations**.

Concretely, for a candidate body framed by two contacts ``(c_above,
c_below)`` on source investigation A, the algorithm collects every
target contact ``t`` such that BOTH ``c_above`` and ``c_below`` have a
user-approved edge to ``t``.  Each such ``t`` lives on some target
investigation; the body is emitted as a lens iff **at least two
distinct target investigations** carry such a ``t``.

Why bilateral
-------------
A single convergent "Z" closure (one pinch-out target) is geometrically
a pinch-out wedge — the body still exists on A but vanishes towards a
single neighbour.  It is NOT enough to declare a lens, because the body
could continue indefinitely on the opposite side of A.  Requiring ≥2
distinct target investigations enforces that the body is enclosed on
both lateral sides (heuristic — investigations are identified by id
here, so two targets that happen to be on the same physical side will
still qualify; refinement to a true left/right-of-source check waits
for spatial info to be threaded into this layer).

Owner directive 2026-05-31 — the unilateral rule used to fire a lens
the moment a user drew "left ↔ right-top" + "left ↔ right-base", which
was premature because the body's right-hand side was still unresolved.

Generalisation: N source contacts on A all converging on the same set
of ≥2 target investigations produce (N-1) stacked lens candidates
(between adjacent source pairs).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class ContactStackEntry:
    """One contact within an investigation's depth-sorted stack."""

    contact_id: UUID
    formation_id: UUID
    depth_top_m: float


@dataclass(frozen=True)
class ContactStack:
    """All contacts on one investigation, sorted by depth_top_m ascending."""

    investigation_id: UUID
    entries: tuple[ContactStackEntry, ...]


@dataclass(frozen=True)
class ContactEdge:
    """User-approved contact-correlation edge.  Canonical-ordered endpoints."""

    contact_a_id: UUID
    contact_b_id: UUID


@dataclass(frozen=True)
class LensCandidate:
    """One detected lens body."""

    formation_id: UUID
    contact_above_id: UUID
    contact_below_id: UUID
    source_investigation_id: UUID
    target_investigation_id: UUID
    target_contact_id: UUID


def detect_lenses_from_graph(
    edges: list[ContactEdge],
    stacks: list[ContactStack],
    max_lens_thickness_m: float | None = None,
) -> list[LensCandidate]:
    """Detect lens bodies from the user-approved contact-edge graph.

    Parameters
    ----------
    edges : list[ContactEdge]
        ALL edges passed in are assumed user-approved.  The caller filters
        ``user_approved=True`` before calling.
    stacks : list[ContactStack]
        Per-investigation depth-sorted contact stacks.  Each contact_id in
        ``edges`` must appear in exactly one stack.
    max_lens_thickness_m : float | None
        Degeneracy guard (dogfeed 2026-05-29).  When set, a candidate whose
        body is thicker than this (``depth_below - depth_above`` on the source
        investigation) is rejected as a spurious detection — a real lens is a
        thin body enclosed within a continuous unit, whereas a loose/marginal
        correlation can make the detector treat a near-whole-column span as a
        "lens" pinching to a point.  ``None`` (default) disables the guard.

    Returns
    -------
    list[LensCandidate]
        One candidate per detected lens body.  Order: by
        (source_investigation_id, depth_above, depth_below) for determinism.
    """
    # Index: contact_id → (investigation_id, formation_id, depth)
    contact_meta: dict[UUID, tuple[UUID, UUID, float]] = {}
    # Index: investigation_id → ordered list of (depth, contact_id, formation_id)
    stack_index: dict[UUID, list[tuple[float, UUID, UUID]]] = {}
    for stack in stacks:
        ordered = sorted((e.depth_top_m, e.contact_id, e.formation_id) for e in stack.entries)
        stack_index[stack.investigation_id] = ordered
        for depth, cid, fid in ordered:
            contact_meta[cid] = (stack.investigation_id, fid, depth)

    # Build adjacency: contact_id → list of neighbour contact ids.
    neighbours: dict[UUID, list[UUID]] = defaultdict(list)
    for e in edges:
        neighbours[e.contact_a_id].append(e.contact_b_id)
        neighbours[e.contact_b_id].append(e.contact_a_id)

    # Step 1: accumulate every (source_inv, c_above, c_below) → list of
    # (target_inv_id, target_contact_id, fid_above) tuples where the
    # `target_contact_id` is shared by edges from BOTH c_above and c_below.
    # Emission is gated on this accumulator in step 2.
    candidate_acc: dict[tuple[UUID, UUID, UUID], list[tuple[UUID, UUID, UUID]]] = defaultdict(list)

    # For each target contact t, group its neighbours by their investigation.
    # Any group with ≥2 distinct contacts is a pinch-out closure (one side).
    for target_id, neigh in neighbours.items():
        target_meta = contact_meta.get(target_id)
        if target_meta is None:
            continue
        target_inv_id, _, _ = target_meta

        by_inv: dict[UUID, list[tuple[float, UUID, UUID]]] = defaultdict(list)
        for n_id in neigh:
            n_meta = contact_meta.get(n_id)
            if n_meta is None:
                continue
            n_inv_id, n_fid, n_depth = n_meta
            if n_inv_id == target_inv_id:
                # Self-loop guard at use-case level prevents this; defensive.
                continue
            by_inv[n_inv_id].append((n_depth, n_id, n_fid))

        for source_inv_id, source_neigh in by_inv.items():
            if len(source_neigh) < 2:
                continue
            source_neigh.sort()  # by depth ascending
            # Adjacent pairs: (i, i+1) — yields N-1 stacked closure entries.
            for k in range(len(source_neigh) - 1):
                depth_above, cid_above, fid_above = source_neigh[k]
                depth_below, cid_below, _ = source_neigh[k + 1]

                # Degeneracy guard: a candidate whose body is thicker than the
                # configured maximum is almost certainly a spurious detection
                # (a near-whole-column "lens" born from a loose correlation),
                # not a real thin enclosed body — skip it.  None = guard off.
                if (
                    max_lens_thickness_m is not None
                    and depth_below - depth_above > max_lens_thickness_m
                ):
                    continue

                candidate_acc[(source_inv_id, cid_above, cid_below)].append(
                    (target_inv_id, target_id, fid_above)
                )

    # Step 2: emit only the candidates that pinch out on ≥2 distinct target
    # investigations (bilateral closure).  A single target investigation is
    # geometrically a pinch-out wedge, not a lens — the body could continue
    # indefinitely on the opposite side of the source (owner directive
    # 2026-05-31).
    out: list[LensCandidate] = []
    for (source_inv_id, cid_above, cid_below), targets in candidate_acc.items():
        distinct_target_invs = {tinv for tinv, _, _ in targets}
        if len(distinct_target_invs) < 2:
            continue

        # Pick a deterministic "primary" target — lowest UUID by investigation,
        # then by contact.  The LithoLensOrm row records ONE target_contact_id
        # via the content_key triple; recording the smallest target keeps that
        # key stable even when the user later adds more pinch-out sides.
        targets_sorted = sorted(targets, key=lambda t: (str(t[0]), str(t[1])))
        primary_inv, primary_contact, fid_above = targets_sorted[0]

        # The lens body is the formation living between these two contacts
        # on the source investigation.  Strix convention:
        # ``FormationContact.formation_id`` is the formation whose TOP is
        # this contact — that formation extends DOWN from ``depth_top_m``
        # until the next deeper contact.  The body between ``cid_above``
        # and ``cid_below`` therefore carries ``cid_above``'s
        # ``formation_id``.
        out.append(
            LensCandidate(
                formation_id=fid_above,
                contact_above_id=cid_above,
                contact_below_id=cid_below,
                source_investigation_id=source_inv_id,
                target_investigation_id=primary_inv,
                target_contact_id=primary_contact,
            )
        )

    # Deterministic order.
    out.sort(
        key=lambda c: (
            str(c.source_investigation_id),
            str(c.contact_above_id),
            str(c.contact_below_id),
        )
    )
    return out
