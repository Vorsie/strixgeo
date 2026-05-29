"""Pure domain algorithm — contact-level auto-correlate (#133 Phase 2+3).

Takes a snapshot of contacts + investigation locations + lithology context,
returns ``ContactCorrelationCandidate`` rows the application layer may
persist as ``litho_contact_correlation_edge`` records with
``user_approved=False``.

No I/O, no ORM, no SQLAlchemy, no FastAPI, no logging.  The caller owns
all side effects.

Algorithm
---------
1. Group contacts by boundary signature
   ``(parent_formation_id, litho_main_soil_code, litho_below_code)`` —
   the third element ensures we only match horizons that have the same
   lithology above AND below.  ``litho_below_code`` is ``None`` for the
   deepest contact on a column; nulls match only against nulls.
2. Restrict candidate column-pairs to relative-neighbourhood-graph
   neighbours (#163a) so an edge never jumps over an intervening test.
   For collinear tests this is the consecutive chain (1-2, 2-3, ...).
3. Per adjacent column-pair within ``MAX_COLUMN_DISTANCE_M``: pair contacts
   whose ``|depth_A - depth_B| < BASE_DEPTH_THRESHOLD_M + DISTANCE_FACTOR ·
   column_distance``.
4. Mutual-nearest-neighbour disambiguation via the shared ``_mnn_by_id``
   generic core, applied PER adjacent column-pair (not group-wide) so a
   contact can link to both its neighbours along a chain without one pair
   stealing a shared endpoint from the other (#163 dogfeed 2026-05-29).
5. Emit canonical-ordered ``(contact_a_id, contact_b_id)`` candidates.

No Theil-Sen dip transfer — see spec for the trade-off discussion.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from uuid import UUID

from groundmodel.domain.services.auto_correlate_contact_edges_constants import (
    AUTO_SOURCE,
    BASE_DEPTH_THRESHOLD_M,
    DISTANCE_FACTOR,
    MAX_COLUMN_DISTANCE_M,
)
from groundmodel.domain.services.auto_correlate_helpers import _mnn_by_id


@dataclass(frozen=True)
class ContactRecord:
    """Minimal snapshot of one formation_contact for the algorithm.

    Attributes
    ----------
    contact_id : UUID
        Primary key of the contact row.
    formation_id : UUID
        The formation (litho unit) whose top this contact defines.
    investigation_id : UUID
        The column (CPT or borehole) on which this contact lives.
    depth_top_m : float
        Depth of the contact below the column head (metres, positive
        down).  Same sign convention as the rest of the litho stack.
    parent_formation_id : UUID | None
        The geological parent of the litho unit, used as the first
        component of the boundary signature.
    litho_main_soil_code : str
        Main soil-type token of the litho unit ABOVE the contact (the
        unit this contact tops).  Boundary signature component 2.
    litho_below_code : str | None
        Main soil-type token of the litho unit immediately BELOW the
        contact.  ``None`` for the deepest contact on a column.  Nulls
        only match other nulls.
    """

    contact_id: UUID
    formation_id: UUID
    investigation_id: UUID
    depth_top_m: float
    parent_formation_id: UUID | None
    litho_main_soil_code: str
    litho_below_code: str | None


@dataclass(frozen=True)
class InvestigationLocation:
    """Planar location of one investigation (CPT or borehole).

    Attributes
    ----------
    investigation_id : UUID
        Primary key of the investigation (matches ContactRecord).
    x, y : float
        Projected planar coordinates in the project CRS (metres).
    """

    investigation_id: UUID
    x: float
    y: float


@dataclass(frozen=True)
class AutoCorrelateContactParams:
    """Tunable inputs.  Defaults from the constants module.

    Attributes
    ----------
    max_column_distance_m : float
        Maximum planar separation between investigations for which a
        contact pair is even considered.
    base_depth_threshold_m : float
        Depth-residual window at zero column distance.
    distance_factor : float
        Linear relaxation of the depth window per metre of horizontal
        column separation.
    """

    max_column_distance_m: float = MAX_COLUMN_DISTANCE_M
    base_depth_threshold_m: float = BASE_DEPTH_THRESHOLD_M
    distance_factor: float = DISTANCE_FACTOR


@dataclass(frozen=True)
class _ContactCandidatePair:
    """Internal MNN row carrying contact endpoints + depth residual.

    Canonical-ordered (a_id < b_id) so the MNN reduction operates on
    symmetric pairs without double-counting.

    Attributes
    ----------
    contact_a_id, contact_b_id : UUID
        Endpoint contact ids, ``contact_a_id < contact_b_id``.
    residual : float
        Absolute depth residual ``|depth_a - depth_b|`` (metres).
    """

    contact_a_id: UUID
    contact_b_id: UUID
    residual: float


@dataclass(frozen=True)
class ContactCorrelationCandidate:
    """One proposed correlation edge (canonical-ordered).

    Attributes
    ----------
    contact_a_id, contact_b_id : UUID
        Endpoint contact ids, ``contact_a_id < contact_b_id``.
    source : str
        Provenance tag — always ``AUTO_SOURCE`` for this algorithm's
        output; downstream may persist it verbatim into
        ``litho_contact_correlation_edge.source``.
    """

    contact_a_id: UUID
    contact_b_id: UUID
    source: str = AUTO_SOURCE


def _dist(a: InvestigationLocation, b: InvestigationLocation) -> float:
    """Euclidean distance between two investigation locations (metres).

    Parameters
    ----------
    a, b : InvestigationLocation
        Locations in the project's projected CRS.

    Returns
    -------
    float
        Planar distance, metres.
    """
    return math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)


def _relative_neighbourhood_adjacency(
    investigation_ids: set[UUID],
    loc_by_id: dict[UUID, InvestigationLocation],
    max_distance_m: float,
) -> set[frozenset[UUID]]:
    """Relative-neighbourhood-graph adjacency over investigation locations.

    Two investigations A and B are adjacent iff no third investigation C
    lies in the RNG "lune": ``dist(A, C) < dist(A, B)`` AND
    ``dist(B, C) < dist(A, B)``.  For tests strung along a line this reduces
    to consecutive neighbours (1-2, 2-3, ...) — a non-adjacent pair (1-3) is
    rejected because the in-between test sits in the lune.  Generalises the
    "only correlate adjacent tests" rule to a 2-D scatter so auto-correlate
    never draws an edge that jumps over an intervening test (#163a).

    Only pairs within ``max_distance_m`` are returned (farther pairs are
    pruned downstream anyway), but every located investigation — including
    ones beyond ``max_distance_m`` from the pair — acts as a potential
    blocker ``C``.

    Parameters
    ----------
    investigation_ids : set[UUID]
        Investigations participating in the model (those carrying contacts).
    loc_by_id : dict[UUID, InvestigationLocation]
        Location lookup; investigations without a location are skipped.
    max_distance_m : float
        Upper bound on edge length to even consider (mirrors the pair gate).

    Returns
    -------
    set[frozenset[UUID]]
        Canonical unordered adjacent investigation pairs.
    """
    located = [iid for iid in investigation_ids if iid in loc_by_id]
    adjacency: set[frozenset[UUID]] = set()
    for i in range(len(located)):
        for j in range(i + 1, len(located)):
            a_id, b_id = located[i], located[j]
            loc_a, loc_b = loc_by_id[a_id], loc_by_id[b_id]
            d_ab = _dist(loc_a, loc_b)
            if d_ab > max_distance_m:
                continue
            blocked = any(
                c_id != a_id
                and c_id != b_id
                and _dist(loc_a, loc_by_id[c_id]) < d_ab
                and _dist(loc_b, loc_by_id[c_id]) < d_ab
                for c_id in located
            )
            if not blocked:
                adjacency.add(frozenset((a_id, b_id)))
    return adjacency


def auto_correlate_contact_edges(
    contacts: list[ContactRecord],
    locations: list[InvestigationLocation],
    params: AutoCorrelateContactParams | None = None,
    adjacency: set[frozenset[UUID]] | None = None,
) -> list[ContactCorrelationCandidate]:
    """Run the contact-level auto-correlate algorithm.

    Parameters
    ----------
    contacts : list[ContactRecord]
        Every contact in scope (typically model-wide).
    locations : list[InvestigationLocation]
        Locations for every investigation referenced by ``contacts``.
    params : AutoCorrelateContactParams | None
        Algorithm tunables; defaults via the constants module.
    adjacency : set[frozenset[UUID]] | None
        Pre-computed adjacency gate — the set of investigation pairs eligible
        to correlate.  When ``None`` (default) the function falls back to the
        model-wide relative-neighbourhood graph in TRUE map (x, y) space.  The
        section workflow passes SECTION-ALONG-ORDER adjacency instead (each
        in-corridor column paired only with its immediate along-section
        neighbours), because RNG neighbours in map space do NOT match the
        section's left-to-right column order for off-line investigations — a
        map-plane-adjacent pair renders as a CROSSING ribbon on the section
        (dogfeed 2026-05-29: the anti-spaghetti gate produced section
        spaghetti).  See ``AutoCorrelateContactEdges`` for the section gate.

    Returns
    -------
    list[ContactCorrelationCandidate]
        Canonical-ordered candidates the application layer may persist
        with ``source='auto', user_approved=False``.
    """
    p = params or AutoCorrelateContactParams()
    loc_by_id = {loc.investigation_id: loc for loc in locations}

    # Adjacency gate (#163a): restrict candidate column-pairs so auto-correlate
    # never links two tests with a third test between them ("spaghetti").  The
    # caller may supply the gate (section-along-order); otherwise we compute the
    # model-wide relative-neighbourhood graph over the participating
    # investigations as the default (a property of the physical test layout,
    # independent of the boundary-signature grouping).
    if adjacency is None:
        participant_ids = {c.investigation_id for c in contacts}
        adjacency = _relative_neighbourhood_adjacency(
            participant_ids, loc_by_id, p.max_column_distance_m
        )

    # Group by boundary signature: same parent geology, same lithology
    # above the contact, same lithology below.  The three-tuple key
    # encodes the full "is this the same horizon?" predicate at the
    # contact level — peer to the formation-level (parent, code) grouping
    # in #127 but tightened by including ``litho_below_code`` so a
    # ZAND→KLEI top is not paired with a ZAND→SILT top.
    groups: dict[tuple[UUID | None, str, str | None], list[ContactRecord]] = {}
    for c in contacts:
        key = (c.parent_formation_id, c.litho_main_soil_code, c.litho_below_code)
        groups.setdefault(key, []).append(c)

    out: list[ContactCorrelationCandidate] = []

    for group_contacts in groups.values():
        # Bucket contacts by investigation for cheap pair iteration.
        by_inv: dict[UUID, list[ContactRecord]] = {}
        for c in group_contacts:
            by_inv.setdefault(c.investigation_id, []).append(c)

        inv_ids = list(by_inv.keys())
        for i in range(len(inv_ids)):
            for j in range(i + 1, len(inv_ids)):
                inv_a, inv_b = inv_ids[i], inv_ids[j]
                # #163a: only correlate geometrically-adjacent tests.
                if frozenset((inv_a, inv_b)) not in adjacency:
                    continue
                loc_a, loc_b = loc_by_id.get(inv_a), loc_by_id.get(inv_b)
                if loc_a is None or loc_b is None:
                    continue
                col_dist = _dist(loc_a, loc_b)
                if col_dist > p.max_column_distance_m:
                    continue
                window = p.base_depth_threshold_m + p.distance_factor * col_dist
                # #163 dogfeed 2026-05-29: MNN is applied PER investigation
                # pair, not group-wide.  A group-wide reduction keyed on the
                # canonical (min, max) contact ids lets one column "win" a
                # shared contact and orphans the matching boundary on the
                # other neighbour — the owner's "bottom layer never
                # auto-suggests" symptom.  RNG adjacency already blocks
                # skip-over spaghetti, so disambiguating only WITHIN each
                # adjacent pair is sufficient and lets a contact link to
                # both its neighbours along a chain.
                pair_candidates: list[_ContactCandidatePair] = []
                for ca in by_inv[inv_a]:
                    for cb in by_inv[inv_b]:
                        residual = abs(ca.depth_top_m - cb.depth_top_m)
                        if residual < window:
                            a_id = min(ca.contact_id, cb.contact_id)
                            b_id = max(ca.contact_id, cb.contact_id)
                            pair_candidates.append(
                                _ContactCandidatePair(
                                    contact_a_id=a_id,
                                    contact_b_id=b_id,
                                    residual=residual,
                                )
                            )

                for survivor in _mnn_by_id(
                    pair_candidates,
                    key_a=lambda c: c.contact_a_id,
                    key_b=lambda c: c.contact_b_id,
                    residual=lambda c: c.residual,
                ):
                    out.append(
                        ContactCorrelationCandidate(
                            contact_a_id=survivor.contact_a_id,
                            contact_b_id=survivor.contact_b_id,
                        )
                    )

    return out
