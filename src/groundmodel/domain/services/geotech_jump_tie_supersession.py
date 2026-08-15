"""Supersede a tie once the column chain underneath it carries the connection.

Owner ruling 2026-08-14 (dogfeed, verbatim): *"those cpt to cpt ties should be
replaced by cpt to borehole to borehole to cpt ties once i click subdivide
boreholes"* — and on sparing hand-drawn ones: *"just delete all, it'll be a
real bother to delete all by hand once the proper chain is there"*.

Why deletion matters and keep-alongside is wrong:

* the fill treats a spanning tie as a deep-to-deep BRIDGE statement — a
  straight line across the whole span — even after the intervening columns
  carry real bands that may disagree with that line;
* the body resolver unions the two end bands DIRECTLY through it, so an
  intervening band that breaks the chain (different class in the middle) is
  silently overruled.

The rule
--------
Supersession keys on **geometry, never on provenance**.  A tie is superseded
when the ACCEPTED ties whose two columns both lie inside its own along-section
span already connect its two endpoint bands — which, because every such
carrier is strictly SHORTER than the tie itself, means the connection runs
through at least one intervening column.  Hand-drawn or machine, restatement
of a litho declaration or a bridged proposal: this module is not told which,
and that is deliberate.

That is the 2026-08-15 correction.  The first implementation spared any edge
whose two investigations carried a direct litho tie, reading it as a
restatement.  On the owner's model that spared 93 of 103 CPT↔CPT ties, because
he correlates CPT→CPT **across** the boreholes at the litho stage — so the
very tie he wants replaced was the one the carve-out protected, and his
dogfeed answer was *"the ties that jump over boreholes still stay"*.

Three guards survive the change, because they are about the chain's honesty
rather than about who drew what:

* **a PENDING hop carries nothing** — a chain the engineer has not accepted
  does not yet carry his approval, so deleting against it would lose approved
  information;
* **a supersedable tie is never a carrier** — a redundant tie must not license
  deleting another one;
* **no complete chain, no deletion** — until then the tie is the only carrier
  of the connection and stays.

Why the judgment terminates
---------------------------
Candidates are judged in ascending span, and a carrier must be strictly
shorter than the candidate it carries.  So every carrier has already been
judged by the time it is consulted: the recursion is well-founded and no tie
can ever take part in its own replacement.  The strict-shorter rule is also
what makes "through at least one intervening column" true by construction — a
carrier can never bridge the candidate's two columns on its own.

Pure domain module: no I/O, no ORM, no logging.  The application layer
supplies the edges and the section's along-positions; the whole decision lives
here so it can be tested without a database.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from uuid import UUID

# Along-distance tolerance, in metres.  Purely a float-noise guard: the
# projection arithmetic is metres of section length, and two genuinely
# distinct columns are never this close.
_ALONG_TOL_M = 1e-6


@dataclass(frozen=True)
class GeotechEdgeForSupersession:
    """One geotech correlation edge, as the supersession judgment needs it.

    Parameters
    ----------
    edge_id : UUID
        The edge row's id — what a superseded verdict names for deletion.
    layer_a_id, layer_b_id : UUID
        The two endpoint band (``litho_layer``) rows.
    investigation_a, investigation_b : str
        Stringified investigation id of each endpoint's column, the key into
        the section's along-position map.
    user_approved : bool
        Whether the engineer accepted the edge.  Only ACCEPTED edges act as
        chain carriers; a superseded tie is deleted regardless of approval
        (owner: *"just delete all"*).
    """

    edge_id: UUID
    layer_a_id: UUID
    layer_b_id: UUID
    investigation_a: str
    investigation_b: str
    user_approved: bool


def superseded_jump_tie_ids(
    edges: list[GeotechEdgeForSupersession],
    along_by_investigation: Mapping[str, float],
) -> list[UUID]:
    """Name the ties the column chain underneath them has made redundant.

    Parameters
    ----------
    edges : list[GeotechEdgeForSupersession]
        Every geotech edge on ONE section (edges are section-scoped; a chain
        on another section proves nothing about this one's tie).
    along_by_investigation : Mapping[str, float]
        ``investigation id (str) -> along-distance from the section start``,
        for every column the section actually draws.  An edge with an endpoint
        missing from this map is not judged at all: without its span there is
        no way to tell a jump from a neighbouring hop, and nothing is deleted
        on a guess.

    Returns
    -------
    list[UUID]
        Edge ids to delete, in input order.

    Notes
    -----
    Deleting a superseded tie never changes what the model connects: the tie is
    only named once an accepted chain already joins the same two bands, so the
    resolver's components are identical before and after.
    """

    def span_of(edge: GeotechEdgeForSupersession) -> float | None:
        """The edge's along-section length, or ``None`` when it is unjudgeable."""
        a = along_by_investigation.get(edge.investigation_a)
        b = along_by_investigation.get(edge.investigation_b)
        return None if a is None or b is None else abs(a - b)

    spans: dict[UUID, float] = {}
    for edge in edges:
        span = span_of(edge)
        if span is not None:
            spans[edge.edge_id] = span

    superseded: set[UUID] = set()
    # Ascending span: a candidate is judged only against strictly shorter ties,
    # which are therefore already judged. Ties on the edge_id keep the order
    # deterministic run to run.
    for candidate in sorted(
        (e for e in edges if e.edge_id in spans),
        key=lambda e: (spans[e.edge_id], e.edge_id.int),
    ):
        candidate_span = spans[candidate.edge_id]
        along_a = along_by_investigation[candidate.investigation_a]
        along_b = along_by_investigation[candidate.investigation_b]
        low, high = min(along_a, along_b), max(along_a, along_b)

        # Union-find over band ids, built from this candidate's carriers alone.
        parent: dict[UUID, UUID] = {}

        def find(x: UUID) -> UUID:
            """Find x's root with path compression."""
            root = x
            while parent.get(root, root) != root:
                root = parent[root]
            while parent.get(x, x) != x:
                parent[x], x = root, parent[x]
            return root

        for other in edges:
            # "A supersedable tie never carries another." Stated explicitly
            # although span-ordering already implies it: a superseded carrier's
            # own replacement chain lies inside ITS span, hence inside the
            # candidate's, and every hop of it is shorter still — so dropping
            # the carrier can never disconnect what it connected. Kept because
            # the invariant should be readable here rather than inferred, and
            # because it costs one set lookup.
            if other.edge_id == candidate.edge_id or other.edge_id in superseded:
                continue
            if not other.user_approved:
                continue
            other_span = spans.get(other.edge_id)
            if other_span is None or other_span >= candidate_span - _ALONG_TOL_M:
                # A carrier at least as long as the candidate could bridge the
                # two columns on its own — that is not a chain through anything.
                continue
            first = along_by_investigation[other.investigation_a]
            second = along_by_investigation[other.investigation_b]
            if not (
                low - _ALONG_TOL_M <= first <= high + _ALONG_TOL_M
                and low - _ALONG_TOL_M <= second <= high + _ALONG_TOL_M
            ):
                # A hop that leaves the span is a detour around the columns the
                # chain is supposed to run through, not the chain.
                continue
            root_a, root_b = find(other.layer_a_id), find(other.layer_b_id)
            if root_a != root_b:
                parent[root_a] = root_b

        if find(candidate.layer_a_id) == find(candidate.layer_b_id):
            superseded.add(candidate.edge_id)

    return [edge.edge_id for edge in edges if edge.edge_id in superseded]
