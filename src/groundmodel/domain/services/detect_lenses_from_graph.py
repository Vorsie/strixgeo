"""Pure domain algorithm — lens detection from the #135 topology (#133 Phase 2+3).

Consumes the user-approved contact-edge graph plus per-investigation
contact stacks; returns ``LensCandidate`` rows the application layer
materialises as ``LithoLensOrm`` records.

Topology
--------
A lens body is detected iff two distinct source contacts on the same
investigation A both have a correlation edge to the same target contact
on another investigation B.  The layer living between the two source
contacts on A is the lens body — it exists on A but pinches out to a
single boundary at B.

Generalisation: N source contacts on A converging on one target on B
produce (N-1) stacked lens candidates (between adjacent source pairs).
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

    out: list[LensCandidate] = []

    # For each target contact t, group its neighbours by their investigation.
    # Any group with ≥2 distinct contacts is the #135 topology.
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
            # Adjacent pairs: (i, i+1) — yields N-1 stacked lens candidates.
            for k in range(len(source_neigh) - 1):
                _, cid_above, _ = source_neigh[k]
                _, cid_below, fid_below = source_neigh[k + 1]

                # The lens body is the formation living between these two
                # contacts on the source investigation.  Convention: a
                # FormationContact's ``formation_id`` is the formation ABOVE
                # the contact (the contact terminates that formation at its
                # bottom).  The body between ``cid_above`` and ``cid_below``
                # therefore carries ``cid_below``'s ``formation_id`` —
                # ``cid_below`` is the bottom of the body.
                out.append(
                    LensCandidate(
                        formation_id=fid_below,
                        contact_above_id=cid_above,
                        contact_below_id=cid_below,
                        source_investigation_id=source_inv_id,
                        target_investigation_id=target_inv_id,
                        target_contact_id=target_id,
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
