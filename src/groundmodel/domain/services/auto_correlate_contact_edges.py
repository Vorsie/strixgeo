"""Pure domain algorithm — contact-level auto-correlate (#133 Phase 2+3).

Takes a snapshot of contacts + investigation locations + lithology context,
returns ``ContactCorrelationCandidate`` rows the application layer may
persist as ``litho_contact_correlation_edge`` records with
``user_approved=False``.

No I/O, no ORM, no SQLAlchemy, no FastAPI, no logging.  The caller owns
all side effects.

Algorithm
---------
1. Group contacts by MAIN LITHOLOGY (``litho_main_soil_code``) — silt
   correlates to silt, sand to sand, clay to clay.  The lateral constraint is
   carried entirely by the adjacency gate + depth window + MNN below, NOT by
   the geological parent or the unit below (dogfeed 2026-05-29: the older
   ``(parent, above, below)`` triple blocked obvious same-lithology
   correlations whenever a column had an extra interbed or a boundary-edge
   parent mis-assignment).
2. Restrict candidate column-pairs to the adjacency gate.  The application
   passes SECTION-ALONG-ORDER adjacency (consecutive columns on the section);
   the model-wide fallback is the relative-neighbourhood graph (#163a) so an
   edge never jumps over an intervening test.
3. Per adjacent column-pair within ``MAX_COLUMN_DISTANCE_M``: pair contacts
   whose ``|depth_A - depth_B| < BASE_DEPTH_THRESHOLD_M + DISTANCE_FACTOR ·
   column_distance``.  The window is tested on the RAW depth residual.
4. Rank each pair by ``residual + ADMIXTURE_MISMATCH_PENALTY_M`` when the two
   units' admixtures mismatch, else by the raw residual (owner ruling
   2026-09-06).  A matching admixture therefore ranks above a mismatching one
   at the same depth, but a mismatch never blocks a pair the window admitted:
   the penalty touches ranking only, never the window test.
5. Mutual-nearest-neighbour disambiguation via the shared ``_mnn_by_id``
   generic core, applied PER adjacent column-pair (not group-wide) so a
   contact can link to both its neighbours along a chain without one pair
   stealing a shared endpoint from the other (#163 dogfeed 2026-05-29).  The
   MNN reduction scores on the admixture-penalised residual.
6. Emit canonical-ordered ``(layer_a_id, layer_b_id)`` candidates, each
   carrying ``admixture_match`` for the UI.

No Theil-Sen dip transfer — see spec for the trade-off discussion.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from uuid import UUID

from groundmodel.domain.services.auto_correlate_contact_edges_constants import (
    ADMIXTURE_MISMATCH_PENALTY_M,
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
    litho_admixtures : tuple[str, ...]
        Raw admixture tokens of the unit ABOVE the contact, in the same
        ``"<soil_code>:<amount>"`` form the accept flow stores
        (``Admixture.canonical_key()``; the ``locally`` flag is excluded).
        Order-independent (compared as a set).  Defaults to empty (the
        "no admixture data" case), which keeps every existing call site
        working and produces byte-identical output to before this field
        existed.  Used only to RANK candidates on the same adjacent
        column-pair (owner ruling 2026-09-06); never to gate pairing.
    """

    contact_id: UUID
    formation_id: UUID
    investigation_id: UUID
    depth_top_m: float
    parent_formation_id: UUID | None
    litho_main_soil_code: str
    litho_below_code: str | None
    litho_admixtures: tuple[str, ...] = ()


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
    admixture_mismatch_penalty_m : float
        Ranking penalty added to the depth residual when two same-soil
        candidates on the same adjacent column-pair have MISMATCHING
        admixtures.  Applied to the ranking / mutual-nearest-neighbour
        residual only, never to the window admission test, so a mismatch
        demotes a tie behind a matching alternative but never blocks it.
    """

    max_column_distance_m: float = MAX_COLUMN_DISTANCE_M
    base_depth_threshold_m: float = BASE_DEPTH_THRESHOLD_M
    distance_factor: float = DISTANCE_FACTOR
    admixture_mismatch_penalty_m: float = ADMIXTURE_MISMATCH_PENALTY_M


@dataclass(frozen=True)
class _ContactCandidatePair:
    """Internal MNN row carrying contact endpoints + ranking residual.

    Canonical-ordered (a_id < b_id) so the MNN reduction operates on
    symmetric pairs without double-counting.

    Attributes
    ----------
    layer_a_id, layer_b_id : UUID
        Endpoint contact ids, ``layer_a_id < layer_b_id``.
    residual_ranked : float
        Depth residual used for RANKING: ``|depth_a - depth_b|`` plus the
        admixture-mismatch penalty when the two units' admixtures differ.
        The MNN reduction scores on this value; the window admission test
        upstream already used the raw residual.
    admixture_match : bool | None
        Whether the two units' admixtures match, propagated to the emitted
        candidate.  ``None`` when neither unit carries admixture data.
    """

    layer_a_id: UUID
    layer_b_id: UUID
    residual_ranked: float
    admixture_match: bool | None


@dataclass(frozen=True)
class ContactCorrelationCandidate:
    """One proposed correlation edge (canonical-ordered).

    Attributes
    ----------
    layer_a_id, layer_b_id : UUID
        Endpoint contact ids, ``layer_a_id < layer_b_id``.
    source : str
        Provenance tag — always ``AUTO_SOURCE`` for this algorithm's
        output; downstream may persist it verbatim into
        ``litho_contact_correlation_edge.source``.
    admixture_match : bool | None
        Whether the two correlated units' admixtures match: ``True`` when the
        admixture token sets are equal, ``False`` when they differ, ``None``
        when neither unit carries admixture data (nothing to compare).
        Additive: surfaced for a future UI badge; the algorithm sets it but
        no consumer reads it yet (owner ruling 2026-09-06).
    """

    layer_a_id: UUID
    layer_b_id: UUID
    source: str = AUTO_SOURCE
    admixture_match: bool | None = None


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


def _admixture_relation(a: tuple[str, ...], b: tuple[str, ...]) -> tuple[bool, bool | None]:
    """Compare two units' admixture token sets for ranking (owner 2026-09-06).

    Comparison is ORDER-INDEPENDENT (set equality on the raw tokens) and
    treats an empty tuple as "no admixture".  Per the owner's rule, "empty vs
    non-empty counts as a mismatch, empty vs empty as a match", so a penalty
    fires whenever exactly one side carries admixtures, or both do but differ.

    Parameters
    ----------
    a, b : tuple[str, ...]
        The admixture tokens of the two units, as stored (order irrelevant).

    Returns
    -------
    tuple[bool, bool | None]
        ``(is_mismatch, admixture_match)``.  ``is_mismatch`` drives the
        ranking penalty.  ``admixture_match`` is the flag surfaced on the
        candidate: ``True``/``False`` when at least one unit has admixture
        data, ``None`` when NEITHER does (nothing to compare; the neutral
        default, which keeps no-admixture output byte-identical to before).
    """
    set_a, set_b = frozenset(a), frozenset(b)
    if not set_a and not set_b:
        # No admixture data on either unit: not a mismatch (no penalty), and no
        # signal for the UI. Kept distinct from a genuine composition match so
        # the default-empty path stays byte-identical to the pre-admixture code.
        return False, None
    match = set_a == set_b
    return (not match), match


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

    # Group by MAIN LITHOLOGY only.  For a lithostratigraphic correlation the
    # thing being correlated is the lithology of the unit the contact tops —
    # silt-to-silt, sand-to-sand, clay-to-clay between adjacent columns, in
    # depth order.  The earlier (parent_formation_id, above, below) triple was
    # too strict: it ALSO demanded the geological parent and the unit BELOW
    # match, so two beds of identical lithology failed to correlate whenever a
    # column had one extra interbed (different below-code) or the parent was
    # mis-assigned at a boundary (dogfeed 2026-05-29 — a SILT/ZAND in Holoceen
    # vs the same SILT/ZAND tagged Antropogeen, and a ZAND/KLEI vs ZAND/SILT
    # sand, both blocked despite matching lithology).  The lateral constraints
    # now come entirely from the adjacency gate (section-along-order or RNG),
    # the depth window, and the per-pair MNN reduction — not from the parent or
    # the neighbour lithology.  ``parent_formation_id`` / ``litho_below_code``
    # remain on ``ContactRecord`` for provenance but no longer gate pairing.
    groups: dict[str, list[ContactRecord]] = {}
    for c in contacts:
        groups.setdefault(c.litho_main_soil_code, []).append(c)

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
                        # Window admission is on the RAW residual (owner ruling
                        # 2026-09-06): a mismatching admixture must never turn a
                        # candidate inside the depth window into no candidate.
                        if residual < window:
                            # Admixture ranks candidates on this pair without
                            # gating them: a mismatch adds the penalty to the
                            # RANKING residual only, so a matching admixture wins
                            # a near-equal-depth tie but a mismatch is still
                            # proposed when it is the only option.
                            is_mismatch, admixture_match = _admixture_relation(
                                ca.litho_admixtures, cb.litho_admixtures
                            )
                            residual_ranked = residual + (
                                p.admixture_mismatch_penalty_m if is_mismatch else 0.0
                            )
                            a_id = min(ca.contact_id, cb.contact_id)
                            b_id = max(ca.contact_id, cb.contact_id)
                            pair_candidates.append(
                                _ContactCandidatePair(
                                    layer_a_id=a_id,
                                    layer_b_id=b_id,
                                    residual_ranked=residual_ranked,
                                    admixture_match=admixture_match,
                                )
                            )

                for survivor in _mnn_by_id(
                    pair_candidates,
                    key_a=lambda c: c.layer_a_id,
                    key_b=lambda c: c.layer_b_id,
                    residual=lambda c: c.residual_ranked,
                ):
                    out.append(
                        ContactCorrelationCandidate(
                            layer_a_id=survivor.layer_a_id,
                            layer_b_id=survivor.layer_b_id,
                            admixture_match=survivor.admixture_match,
                        )
                    )

    return out
