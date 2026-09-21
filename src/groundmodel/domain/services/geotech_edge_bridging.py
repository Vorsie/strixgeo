"""Bridge litho correlations across columns that carry no packing bands.

Geotech packing ties are derived from the parent litho model's APPROVED
correlations: for each correlated litho-unit pair, the two columns' NAD
packing-class stacks inside that unit are aligned and each aligned position
becomes a tie.  That works only when BOTH endpoints of the litho correlation
have geotech bands.

In the four-step pipeline (owner ruling 2026-08-04) auto-correlate runs BEFORE
"Divide boreholes", so every borehole column is deliberately still empty:

    the pairing must connect CPT to CPT ACROSS intervening borehole columns on
    the section (today ties stop at borehole columns because adjacency is
    column-neighbour based; the v2 partition engine already supports jump ties,
    so propose CPT<->CPT pairs that skip undivided borehole columns)

A section drawn CPT - borehole - CPT therefore proposes nothing at all without
this module: each of its two litho correlations has one endpoint with an empty
geotech stack and is skipped.

The rule
--------
Walk the litho correlation graph.  A layer whose column carries packing bands is
a **terminal**; a layer whose column carries none is **transit**.  From every
terminal, walk through transit layers only — stopping at the first terminal
reached — and pair the two terminals.  Expansion stops at terminals on purpose:
a chain A - B - C of three divided columns already has its own two correlations,
and an A-to-C "shortcut" would tie bands the engineer never put next to each
other.

Pure domain module: no I/O, no ORM, no logging.  The application layer supplies
the graph; the whole decision lives here so it can be tested without a database.
"""

from __future__ import annotations

from collections import deque
from uuid import UUID

from groundmodel.shared.constants.db_constraints import LITHO_LAYER_DEPTH_DECIMALS


def bridge_litho_edges_over_bandless_columns(
    *,
    litho_edges: set[tuple[UUID, UUID]],
    layer_investigation: dict[UUID, str],
    layers_with_bands: set[UUID],
) -> set[tuple[UUID, UUID]]:
    """Add CPT-to-CPT litho pairs that skip layers with no packing bands.

    Terminal-vs-transit is a per-LAYER judgment, not per-column (review
    finding 3, 2026-08-05): a column whose bands all live in a DIFFERENT litho
    unit has nothing the derivation could align inside this chain's window, so
    for this walk it is transit — exactly as if it carried no bands at all.
    (And the rule is band-presence, not investigation kind: any bandless
    column — borehole or not-yet-divided CPT — is walked through; in the
    four-step pipeline step 1 bands every CPT, so in practice the transit
    columns are boreholes.)

    Parameters
    ----------
    litho_edges : set[tuple[UUID, UUID]]
        The section's approved litho correlations as canonical ``(min, max)``
        layer-id pairs.
    layer_investigation : dict[UUID, str]
        ``litho_layer_id -> investigation id (stringified)`` for every layer the
        edges name.  Used only to refuse same-column pairs.  A layer missing
        from this map is treated as transit.
    layers_with_bands : set[UUID]
        Litho layer ids whose own depth window contains geotech packing bands
        on their column.  Everything else is what the bridge walks through.

    Returns
    -------
    set[tuple[UUID, UUID]]
        ``litho_edges`` plus one canonical pair per pair of band-carrying layers
        joined by a path whose intermediate layers all sit on bandless columns.
        Pairs on the SAME investigation are never emitted — a tie must connect
        two different columns.

    Notes
    -----
    The result is a superset of the input: this function ADDS, it never drops a
    correlation the engineer approved.
    """
    if not litho_edges:
        return set(litho_edges)

    adjacency: dict[UUID, set[UUID]] = {}
    for a, b in litho_edges:
        adjacency.setdefault(a, set()).add(b)
        adjacency.setdefault(b, set()).add(a)

    def _has_bands(layer_id: UUID) -> bool:
        """Whether this layer's own window carries geotech packing bands."""
        return layer_id in layers_with_bands

    bridged: set[tuple[UUID, UUID]] = set(litho_edges)
    for start in adjacency:
        if not _has_bands(start):
            continue
        start_investigation = layer_investigation.get(start)
        # Breadth-first through TRANSIT layers only; the frontier is seeded with
        # the start's transit neighbours, so a directly-correlated terminal is
        # never re-emitted (it is already in the input set anyway).
        visited: set[UUID] = {start}
        queue: deque[UUID] = deque(
            neighbour
            for neighbour in adjacency[start]
            if not _has_bands(neighbour) and neighbour not in visited
        )
        visited.update(queue)
        while queue:
            current = queue.popleft()
            for neighbour in adjacency.get(current, ()):
                if neighbour in visited:
                    continue
                visited.add(neighbour)
                if _has_bands(neighbour):
                    # Reached the far side of the bandless stretch. Stop here:
                    # anything beyond it has its own correlation to this column.
                    if layer_investigation.get(neighbour) == start_investigation:
                        # A chain that loops back onto the starting column is not
                        # a tie — an edge may never join two bands of one test.
                        continue
                    bridged.add((min(start, neighbour), max(start, neighbour)))
                else:
                    queue.append(neighbour)
    return bridged


def bridged_contact_pairs(
    *,
    litho_sided_ties: set[tuple[UUID, UUID, str, str]],
    layer_depths: dict[UUID, tuple[str, float, float]],
    columns_with_bands: set[str],
) -> set[tuple[tuple[UUID, str], tuple[UUID, str]]]:
    """Chain litho CONTACT ties through bandless columns, packing-agnostic.

    Owner corrections, 2026-08-17 (both in one evening):

    * *"just walk a tie to the next cpt, if it arrives you place a direct
      connection if not then skip"*;
    * *"litho ties are packing agnostic which means you are not emitting the
      litho ties but are interpreting and emitting ties based on packing"* —
      the layer-pair bridge above feeds the class-matched aligner, so a
      chained litho tie whose end bands differ in NAD class simply vanished
      (his red line: the sand top S6 9.82 ↔ S13 9.69 through B6 and B4, D on
      one side and MD read on the other).

    So this walk carries the CONTACT.  A node is a depth on a column — never a
    ``(layer, side)`` label, because the same physical contact is stored as one
    layer's base and its neighbour's top and a label-keyed walk dies exactly at
    the hop where the two rows disagree (the xyz ruling, third appearance).
    Each edge is one of his accepted DIRECT litho ties.  A column carrying
    geotech bands is a terminal; a column carrying none is transit.  From every
    terminal contact, walk transit contacts only and connect to each terminal
    contact reached; a chain that never arrives emits nothing.

    Packing classes are not an input.  What class the arriving bands hold is
    the emitter's problem — the statement being carried is the litho tie.

    Parameters
    ----------
    litho_sided_ties : set[tuple[UUID, UUID, str, str]]
        The section's approved direct litho ties as
        ``(layer_a, layer_b, side_a, side_b)``, any orientation.
    layer_depths : dict[UUID, tuple[str, float, float]]
        ``litho_layer_id → (investigation_id_str, top_m, base_m)``.  A tie
        naming a layer absent from this map is ignored — it cannot be placed.
    columns_with_bands : set[str]
        Investigation ids carrying at least one geotech band.  Everything
        else is what the walk passes through.

    Returns
    -------
    set[tuple[tuple[UUID, str], tuple[UUID, str]]]
        One ``((layer_a, side_a), (layer_b, side_b))`` per pair of terminal
        contacts joined through at least one transit hop, canonically ordered
        by layer id.  Direct terminal↔terminal ties are never re-emitted (they
        restate on their own), and the walk stops at the first terminal — a
        banded column's onward correlations are its own statements.
    """

    def _node(layer_id: UUID, side: str) -> tuple[str, float] | None:
        entry = layer_depths.get(layer_id)
        if entry is None:
            return None
        inv, top, base = entry
        # Millimetre identity: litho depths are stored on the mm grid, so two
        # rows naming one contact agree to well under this rounding.
        return (inv, round(top if side == "top" else base, LITHO_LAYER_DEPTH_DECIMALS))

    # The contact graph: node → {(neighbour node, how the tie names the
    # neighbour end)}. The (layer, side) label rides along so an emitted pair
    # can name real rows, but identity — visited sets, adjacency keys — is the
    # depth node alone.
    adjacency: dict[tuple[str, float], set[tuple[tuple[str, float], tuple[UUID, str]]]] = {}
    label_of: dict[tuple[str, float], tuple[UUID, str]] = {}
    for layer_a, layer_b, side_a, side_b in litho_sided_ties:
        node_a = _node(layer_a, side_a)
        node_b = _node(layer_b, side_b)
        if node_a is None or node_b is None or node_a[0] == node_b[0]:
            continue
        adjacency.setdefault(node_a, set()).add((node_b, (layer_b, side_b)))
        adjacency.setdefault(node_b, set()).add((node_a, (layer_a, side_a)))
        label_of.setdefault(node_a, (layer_a, side_a))
        label_of.setdefault(node_b, (layer_b, side_b))

    def _terminal(node: tuple[str, float]) -> bool:
        return node[0] in columns_with_bands

    out: set[tuple[tuple[UUID, str], tuple[UUID, str]]] = set()
    for start in adjacency:
        if not _terminal(start):
            continue
        start_label = label_of[start]
        visited: set[tuple[str, float]] = {start}
        frontier = [
            node for node, _ in adjacency[start] if not _terminal(node) and node not in visited
        ]
        visited.update(frontier)
        while frontier:
            current = frontier.pop()
            for node, node_label in adjacency.get(current, ()):
                if node in visited:
                    continue
                visited.add(node)
                if _terminal(node):
                    if node[0] == start[0]:
                        continue  # looped back onto the starting column
                    a, b = start_label, node_label
                    out.add((a, b) if a[0] < b[0] else (b, a))
                else:
                    frontier.append(node)
    return out
