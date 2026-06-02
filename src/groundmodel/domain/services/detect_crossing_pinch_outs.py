"""Pure domain — pinch-out lens candidates from correlation crossings.

Auto-lens increment 2 (owner dogfeed 2026-06-02). When two correlation edges
between the same column pair CROSS — the shallower contact on one column maps
to the DEEPER contact on the other — the layer between them cannot be a flat
continuous bed: it must pinch out. ``detect_crossing_pinch_outs`` turns each
such crossing into a ``CrossingPinchOut`` that frames the pinching layer on the
source column (the canonical "left" investigation of the pair) and names the
neighbour it pinches toward.

This complements the tightened auto-correlate window (increment 1): increment 1
stops drawing the steep diagonal, this pass recognises the geometry it left
behind as a lens. The application layer feeds these to the body machinery
(``ClaimBodyExtent`` / ``SuggestBodyPinchOuts``) so the user sees a lens ghost
instead of a missing or diagonal edge.

No I/O, no ORM, no logging — the caller owns all side effects. Reuses the
``ContactEdge`` / ``ContactStack`` snapshot types from ``detect_body_extents``.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from uuid import UUID

from groundmodel.domain.services.detect_body_extents import ContactEdge, ContactStack


@dataclass(frozen=True)
class CrossingPinchOut:
    """A layer inferred to pinch out from a correlation crossing.

    Attributes
    ----------
    source_investigation_id : UUID
        The column carrying the framing contacts — the canonical "left"
        investigation of the crossing pair (lowest UUID int). Deterministic;
        geometric refinement (which side actually wedges out) can layer on top
        when section along-positions are available.
    above_contact_id : UUID
        The shallower framing contact on the source column (top of the
        pinching layer).
    below_contact_id : UUID
        The deeper framing contact on the source column (base of the pinching
        layer).
    neighbour_investigation_id : UUID
        The column the layer pinches out toward (the other end of the crossing
        pair).
    """

    source_investigation_id: UUID
    above_contact_id: UUID
    below_contact_id: UUID
    neighbour_investigation_id: UUID


def detect_crossing_pinch_outs(
    edges: list[ContactEdge],
    stacks: list[ContactStack],
) -> list[CrossingPinchOut]:
    """Detect pinch-out lens candidates from depth-order crossings.

    Parameters
    ----------
    edges : list[ContactEdge]
        Correlation edges to inspect. Typically the freshly-proposed
        auto-correlate candidates (any approval state) for one model.
    stacks : list[ContactStack]
        Per-investigation depth-sorted contact stacks. Every contact id
        referenced by ``edges`` should appear in exactly one stack; edges with
        an unknown endpoint are skipped silently.

    Returns
    -------
    list[CrossingPinchOut]
        One record per detected crossing, sorted by
        ``(source_investigation_id, above_contact_id, below_contact_id)`` for
        determinism.

    Notes
    -----
    Detection is per unordered column pair. Edges are normalised so one column
    is consistently "left" (lowest UUID int), then sorted by left-column depth.
    A drop in the right-column depth between two consecutive edges (the right
    endpoint goes *shallower* while the left endpoint goes *deeper*) is an
    inversion — the crossing. The pinching layer is framed by the two left
    contacts that bound the inversion.
    """
    # contact_id → (investigation_id, depth_top_m)
    meta: dict[UUID, tuple[UUID, float]] = {}
    for stack in stacks:
        for entry in stack.entries:
            meta[entry.contact_id] = (stack.investigation_id, entry.depth_top_m)

    # Group edges by unordered investigation pair, dropping intra-column and
    # dangling edges.
    by_pair: dict[frozenset[UUID], list[tuple[UUID, UUID, float, UUID, float]]] = defaultdict(list)
    for e in edges:
        ma = meta.get(e.contact_a_id)
        mb = meta.get(e.contact_b_id)
        if ma is None or mb is None:
            continue
        inv_a, depth_a = ma
        inv_b, depth_b = mb
        if inv_a == inv_b:
            continue
        # store as (inv_a, contact_a, depth_a, contact_b, depth_b) — orientation
        # is normalised per-pair below.
        by_pair[frozenset((inv_a, inv_b))].append(
            (inv_a, e.contact_a_id, depth_a, e.contact_b_id, depth_b)
        )

    out: list[CrossingPinchOut] = []
    for pair, pair_edges in by_pair.items():
        left_inv, right_inv = sorted(pair, key=lambda i: i.int)

        # Normalise each edge to (left_depth, left_contact, right_depth).
        norm: list[tuple[float, UUID, float]] = []
        for inv_a, cid_a, depth_a, cid_b, depth_b in pair_edges:
            if inv_a == left_inv:
                norm.append((depth_a, cid_a, depth_b))
            else:
                norm.append((depth_b, cid_b, depth_a))
        norm.sort(key=lambda t: t[0])

        # An inversion in right-column depth between consecutive (left-sorted)
        # edges is a crossing → the layer between the two left contacts pinches.
        for k in range(len(norm) - 1):
            _, left_c_above, right_d_above = norm[k]
            _, left_c_below, right_d_below = norm[k + 1]
            if right_d_above > right_d_below:
                out.append(
                    CrossingPinchOut(
                        source_investigation_id=left_inv,
                        above_contact_id=left_c_above,
                        below_contact_id=left_c_below,
                        neighbour_investigation_id=right_inv,
                    )
                )

    out.sort(
        key=lambda c: (
            str(c.source_investigation_id),
            str(c.above_contact_id),
            str(c.below_contact_id),
        )
    )
    return out
