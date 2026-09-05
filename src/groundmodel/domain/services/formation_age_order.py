"""Infer formation age ordering from per-investigation contact depths.

A geologist reads stratigraphy bottom-up on a single borehole: shallower
contact = younger formation, deeper contact = older. One investigation
gives an unambiguous *local* partial order. Across many investigations
the union of those partial orders is a DAG of "is younger than"
relationships; topologically sorting it produces a globally consistent
youngest-to-oldest sequence — the substrate's age axis derived purely
from data.

This is more robust than ranking by mean surface elevation: regional
dip shifts each formation's mean elevation across the project, and a
steeply-dipping deeper formation can have a higher mean elevation
than a flatter shallower one. The per-investigation pairwise constraint
is immune to dip because each anchor sees the column locally.

The function is pure: pass it the contacts grouped by anchor, plus
the full formation id set (so orphans without contacts are still placed
in the result), and it returns the ordered list. No SQL, no I/O.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from uuid import UUID

from groundmodel.domain.services.formation_age_order_constants import is_anthropogenic


def infer_age_order(
    *,
    contacts_by_anchor: Mapping[UUID, Sequence[tuple[float, UUID]]],
    all_formation_ids: Iterable[UUID],
    labels_by_formation: Mapping[UUID, str | None] | None = None,
) -> list[UUID]:
    """Topologically order formations from per-investigation contact depths.

    For each anchor (borehole or CPT) with at least two contacts in
    the model, sort its contacts by depth ascending — the shallower
    contact's formation is YOUNGER than the deeper contact's, on this
    anchor. Every such pair casts one vote. After collecting evidence
    across all anchors, contradictory votes for the same unordered
    pair are resolved by majority (with mean-depth tiebreak), the
    DAG is built, and Kahn's algorithm walks it youngest-first.

    Parameters
    ----------
    contacts_by_anchor : Mapping[UUID, Sequence[tuple[float, UUID]]]
        Per-anchor list of ``(depth_top_m, formation_id)`` tuples.
        One anchor may carry contacts for several formations. Anchors
        with fewer than two contacts contribute no constraints (but
        their contacts still inform the mean-depth tiebreaker).
    all_formation_ids : Iterable[UUID]
        Every formation that should appear in the output, including
        those with zero contacts in any anchor (orphans).
    labels_by_formation : Mapping[UUID, str or None] or None, optional
        Optional per-formation label (its display name, or its
        regional-reference code) used only to recognise the
        anthropogenic unit. Any formation whose label identifies it as
        Antropogeen (see :func:`is_anthropogenic`) is pinned to the
        youngest end of the result — man-made fill is younger than every
        natural formation by definition, regardless of the per-borehole
        contact evidence (owner ruling 2026-09-05). ``None`` (default)
        applies no pin, preserving the pure data-driven order.

    Returns
    -------
    list[UUID]
        formation_ids in youngest-first order: ``result[0]`` is the
        youngest, ``result[-1]`` is the oldest. The caller assigns
        ``display_order = i`` to the formation at index ``i``.

    Notes
    -----
    Edge cases handled deterministically:

    * **Orphan formations** (no contacts on any anchor) are appended
      at the end in ascending UUID order, so a Build never reshuffles
      them randomly.
    * **Single-contact-only formations** never appear in a pair edge
      but contribute to mean depth — they slot in via the tiebreaker.
    * **Contradictory anchors** (one says A above B, another says B
      above A — geologically possible with overturned strata) keep
      the direction with more supporting anchors; if equal, the
      formation with the lower mean depth wins as "younger".
    * **DAG cycles after conflict resolution** (rare; would require
      a true odd-length contradiction cycle) — any formations not
      reached by the toposort are appended by mean depth ascending.
    * **Anthropogenic unit** (``Antropogeen`` / DOV code ``A``, matched
      via ``labels_by_formation``) is moved to the youngest end after
      the data-driven order is built, overriding any contact evidence
      or tie-break — it is younger than everything by definition.

    The order is deterministic given the same input — same inputs
    always produce the same list. Important for reproducibility and
    bundle round-trips.
    """
    # Step 1: collect votes + depths
    votes: dict[tuple[UUID, UUID], int] = defaultdict(int)  # (younger, older)
    depths: dict[UUID, list[float]] = defaultdict(list)

    for anchor_contacts in contacts_by_anchor.values():
        sorted_contacts = sorted(anchor_contacts, key=lambda x: x[0])
        for depth, fid in sorted_contacts:
            depths[fid].append(depth)
        for i in range(len(sorted_contacts)):
            for j in range(i + 1, len(sorted_contacts)):
                y_fid = sorted_contacts[i][1]
                o_fid = sorted_contacts[j][1]
                if y_fid != o_fid:
                    votes[(y_fid, o_fid)] += 1

    mean_depth: dict[UUID, float] = {fid: sum(ds) / len(ds) for fid, ds in depths.items()}

    # Step 2: resolve conflicts, keep one direction per unordered pair
    edges: set[tuple[UUID, UUID]] = set()  # (younger, older)
    seen_pairs: set[frozenset[UUID]] = set()
    for (y, o), count in votes.items():
        pair = frozenset((y, o))
        if pair in seen_pairs:
            continue
        opposite = votes.get((o, y), 0)
        if count > opposite:
            edges.add((y, o))
        elif opposite > count:
            edges.add((o, y))
        else:
            # Tie on vote count: shallower mean depth = younger.
            if mean_depth[y] <= mean_depth[o]:
                edges.add((y, o))
            else:
                edges.add((o, y))
        seen_pairs.add(pair)

    # Step 3: Kahn's algorithm with mean-depth tiebreaker
    all_ids = set(all_formation_ids)
    with_contacts = set(mean_depth.keys())
    orphans = sorted(all_ids - with_contacts)

    in_degree: dict[UUID, int] = {fid: 0 for fid in with_contacts}
    adj: dict[UUID, set[UUID]] = defaultdict(set)
    for y, o in edges:
        if y in with_contacts and o in with_contacts:
            if o not in adj[y]:
                adj[y].add(o)
                in_degree[o] += 1

    def _tiebreak_key(fid: UUID) -> tuple[float, str]:
        # Lower mean depth = younger → emitted first. UUID as the
        # final stable tiebreaker so the output is fully deterministic.
        return (mean_depth.get(fid, float("inf")), str(fid))

    ready = sorted(
        [fid for fid, d in in_degree.items() if d == 0],
        key=_tiebreak_key,
    )
    result: list[UUID] = []
    while ready:
        next_fid = ready.pop(0)
        result.append(next_fid)
        for child in sorted(adj[next_fid], key=_tiebreak_key):
            in_degree[child] -= 1
            if in_degree[child] == 0:
                ready.append(child)
        ready.sort(key=_tiebreak_key)

    # Cycle fallback: any unresolved formations land sorted by mean depth.
    placed = set(result)
    remaining = sorted(with_contacts - placed, key=_tiebreak_key)
    result.extend(remaining)

    # Orphans last, UUID-sorted for stability.
    result.extend(orphans)

    # Anthropogenic pin (owner ruling 2026-09-05): man-made fill is
    # younger than every natural formation by definition, so no amount
    # of contact evidence — nor an orphan placement at the oldest end —
    # can make it older. After the data-driven youngest-first order is
    # built, move every anthropogenic formation to the front (result[0]
    # is the youngest), keeping their relative order stable. Only applied
    # when the caller supplies labels; the pure data path is unchanged.
    if labels_by_formation:
        anthropogenic = [fid for fid in result if is_anthropogenic(labels_by_formation.get(fid))]
        if anthropogenic:
            anthro_set = set(anthropogenic)
            result = anthropogenic + [fid for fid in result if fid not in anthro_set]

    return result
