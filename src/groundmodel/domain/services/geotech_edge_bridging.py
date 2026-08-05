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
