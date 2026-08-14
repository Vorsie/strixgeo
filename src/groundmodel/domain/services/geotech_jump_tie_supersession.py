"""Supersede CPT↔CPT jump ties once the borehole-mediated chain carries them.

Owner ruling 2026-08-14 (dogfeed, verbatim): *"those cpt to cpt ties should be
replaced by cpt to borehole to borehole to cpt ties once i click subdivide
boreholes"* — and on sparing hand-drawn ones: *"just delete all, it'll be a
real bother to delete all by hand once the proper chain is there"*.

Why deletion matters and keep-alongside is wrong:

* the fill treats a jump tie as a deep-to-deep BRIDGE statement — a straight
  line across the whole span — even after the boreholes carry real bands that
  may disagree with that line;
* the body resolver unions the two CPT bands DIRECTLY through the jump tie,
  so a borehole band that breaks the chain (different class in the middle)
  is silently overruled.

The rule
--------
An edge is a **jump tie** when its two investigations have NO direct approved
litho tie on the section — it was born by bridging over bandless columns
(:mod:`geotech_edge_bridging`), not by restating a litho declaration.  A jump
tie is **superseded** when its two endpoint BANDS are connected by a path of
ACCEPTED direct-litho-backed edges (the mediated chain).  Superseded means
delete — approval state and who drew it do not matter (the ruling above).

Until the chain exists — a borehole got no band in that window, or a chain
hop is still a pending proposal — the jump tie is the only carrier of the
connection and stays.  An edge whose investigations ARE directly litho-tied
(e.g. the restatement of a hand-drawn litho jump tie) is never superseded:
it carries the engineer's own litho declaration.

Pure domain module: no I/O, no ORM, no logging.  The application layer
supplies the edges and the direct-pair set; the whole decision lives here so
it can be tested without a database.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID


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
        Stringified investigation id of each endpoint's column.
    user_approved : bool
        Whether the engineer accepted the edge.  Only ACCEPTED direct-family
        edges act as chain carriers; a jump tie is deleted regardless.
    """

    edge_id: UUID
    layer_a_id: UUID
    layer_b_id: UUID
    investigation_a: str
    investigation_b: str
    user_approved: bool


def _canonical_pair(a: str, b: str) -> tuple[str, str]:
    """Return the investigation pair in canonical (sorted) order."""
    return (a, b) if a <= b else (b, a)


def superseded_jump_tie_ids(
    edges: list[GeotechEdgeForSupersession],
    directly_tied_investigation_pairs: set[tuple[str, str]],
) -> list[UUID]:
    """Name the jump ties the mediated chain has made redundant.

    Parameters
    ----------
    edges : list[GeotechEdgeForSupersession]
        Every geotech edge on ONE section (edges are section-scoped; a chain
        on another section proves nothing about this one's jump tie).
    directly_tied_investigation_pairs : set[tuple[str, str]]
        Canonical ``(min, max)`` investigation-id pairs that carry a DIRECT
        approved litho tie on the section.  Edges between such a pair are
        restatements of a litho declaration, never bridged jump ties.

    Returns
    -------
    list[UUID]
        Edge ids to delete, in input order: every jump tie whose two endpoint
        bands are connected through accepted direct-family edges alone.

    Notes
    -----
    The carrier graph deliberately excludes jump ties themselves — one
    redundant jump tie must never license deleting another — and excludes
    pending edges: a chain the engineer has not accepted does not yet carry
    his approval, so deleting the accepted jump tie against it would lose
    approved information.
    """

    def is_direct_family(edge: GeotechEdgeForSupersession) -> bool:
        """Whether the edge's investigations carry a direct litho tie."""
        pair = _canonical_pair(edge.investigation_a, edge.investigation_b)
        return pair in directly_tied_investigation_pairs

    # Union-find over band ids, built from the accepted direct-family edges.
    parent: dict[UUID, UUID] = {}

    def find(x: UUID) -> UUID:
        """Find x's root with path compression."""
        root = x
        while parent.get(root, root) != root:
            root = parent[root]
        while parent.get(x, x) != x:
            parent[x], x = root, parent[x]
        return root

    def union(a: UUID, b: UUID) -> None:
        """Merge the components of a and b."""
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for edge in edges:
        if edge.user_approved and is_direct_family(edge):
            union(edge.layer_a_id, edge.layer_b_id)

    return [
        edge.edge_id
        for edge in edges
        if not is_direct_family(edge) and find(edge.layer_a_id) == find(edge.layer_b_id)
    ]
