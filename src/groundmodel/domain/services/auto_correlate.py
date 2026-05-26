"""Pure domain algorithm — auto-correlate litho bodies (#127).

Takes a snapshot of formations, their contacts at each investigation, and
investigation locations; returns a list of correlation candidates the
application layer may persist as ``litho_correlation_edge`` rows.

No I/O, no ORM, no SQLAlchemy, no FastAPI, no logging.  The caller owns
all side effects.

Domain model context
--------------------
In the lithostratigraphic model each accepted CPT / borehole produces
**one ``geological_formation`` row per lithology layer** at that
investigation — so a site with 6 CPTs and 3 layers per CPT produces
18 formation rows.  Formation rows that share the same
``(parent_formation_id, litho_main_soil_code)`` belong to the same
*naming group* and are candidates for correlation.  A correlation edge
(``litho_correlation_edge``) between two rows in that group means the
engineer decided "the ZAND at CPT-1 and the ZAND at CPT-2 are the same
stratigraphic body."

The auto-correlate algorithm automates that decision:

Algorithm: bottom-up sweep with dip transfer
-------------------------------------------
1. Collect a **grouping index**: for each (parent_formation_id,
   litho_main_soil_code) pair, the list of (formation_id, investigation_id,
   depth_top_m) triples of contacts in this model.
2. Sort the naming groups by the median depth of their contacts
   (deepest/oldest first) — mirrors the ``display_order ASC`` semantics.
3. For each group G, iterate all (A, B) investigation column-pairs within
   ``max_column_distance_m``:
   a. Find the formation(s) in G that have a contact at A, and those at B.
   b. For each (f_A, contact_A) at A and (f_B, contact_B) at B where
      f_A != f_B, compute the depth residual against the dip-transferred
      prediction.
   c. If residual < window → candidate (f_A, f_B).
   d. Apply mutual-nearest-neighbour disambiguation.
   e. Update the per-column-pair dip estimate.

The ``robust_slope_fit`` helper uses the Theil-Sen estimator (median of
pairwise slopes) so a single outlier cannot poison the dip baseline.

The ``mutual_nearest_neighbour`` helper ensures symmetry: f_A→f_B is
only accepted when f_B also nominates f_A as its nearest neighbour.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from uuid import UUID

from groundmodel.domain.services.auto_correlate_constants import (
    AUTO_SOURCE,
    BASE_DEPTH_THRESHOLD_M,
    DISTANCE_FACTOR,
    MAX_COLUMN_DISTANCE_M,
    MIN_EDGES_FOR_DIP_TRANSFER,
)
from groundmodel.domain.services.auto_correlate_helpers import (
    _CandidatePair,
    _mutual_nearest_neighbour,
)

# ---------------------------------------------------------------------------
# Input / output data-transfer objects
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class InvestigationLocation:
    """Planar location of one investigation (CPT or borehole).

    Attributes
    ----------
    investigation_id : UUID
        Unique identifier for the investigation (cpt_id or borehole_id).
    x : float
        Easting in the project CRS (metres).
    y : float
        Northing in the project CRS (metres).
    """

    investigation_id: UUID
    x: float
    y: float


@dataclass(frozen=True)
class FormationContactRecord:
    """Minimal snapshot of one formation_contact row for the algorithm.

    Attributes
    ----------
    contact_id : UUID
        Primary key of the formation_contact row.
    formation_id : UUID
        The litho child formation this contact belongs to.
    investigation_id : UUID
        The investigation (CPT or borehole) at which the contact was picked.
    depth_top_m : float
        Depth of the contact below the investigation collar (metres).
    parent_formation_id : UUID
        Parent geological formation id — groups sibling litho units.
    litho_main_soil_code : str
        BaseLithology token (ZAND/KLEI/SILT/GRIND/VEEN).  Together with
        ``parent_formation_id`` this defines the naming group; only
        formations in the same group are candidates for correlation.
    """

    contact_id: UUID
    formation_id: UUID
    investigation_id: UUID
    depth_top_m: float
    parent_formation_id: UUID
    litho_main_soil_code: str


@dataclass(frozen=True)
class FormationRecord:
    """Minimal snapshot of one geological_formation row for the algorithm.

    Only used to determine the stratigraphic order (deepest/oldest first).
    The algorithm works primarily through contacts, but formations are kept
    as a separate input so the sorting key can be derived from the model's
    own ``display_order`` rather than inferred from contact depths.

    Attributes
    ----------
    formation_id : UUID
        Primary key.
    display_order : int
        Stratigraphic age index — lower = older/deeper.  The algorithm
        iterates naming groups in ascending median-contact-depth order
        (a proxy for display_order) when this list is empty, or uses
        the explicit order from this list when provided.
    parent_formation_id : UUID | None
        Parent geological formation id.  Litho child formations always
        have a parent; geological-model rows have None.
    litho_main_soil_code : str | None
        BaseLithology token.  None for geological-model rows.
    """

    formation_id: UUID
    display_order: int
    parent_formation_id: UUID | None = None
    litho_main_soil_code: str | None = None


@dataclass(frozen=True)
class CorrelationCandidate:
    """One proposed correlation edge returned by the algorithm.

    Attributes
    ----------
    formation_a_id : UUID
        Canonical lesser endpoint (min of the two formation ids).
    formation_b_id : UUID
        Canonical greater endpoint.
    source : str
        Always ``'auto'`` for candidates from this algorithm.
    """

    formation_a_id: UUID
    formation_b_id: UUID
    source: str = AUTO_SOURCE


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _dist(a: InvestigationLocation, b: InvestigationLocation) -> float:
    """Euclidean distance between two investigation locations (metres).

    Parameters
    ----------
    a, b : InvestigationLocation
        The two column locations.

    Returns
    -------
    float
        Distance in metres.
    """
    return math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)


def robust_slope_fit(pairs: list[tuple[float, float]]) -> float | None:
    """Theil-Sen median-of-pairwise-slopes estimator.

    Fits the slope of a 1-D linear relationship between the first and
    second components of each pair using the Theil-Sen estimator: compute
    the slope for every ordered pair of input points and return the median.
    Robust against outliers: a single bad point cannot shift the estimate
    more than the fraction of pairs it participates in (at most 29 % for
    a 5-point sample when breakdown point ≈ 29 %).

    Each input tuple is ``(depth_at_A, depth_at_B)``.  The slope is the
    dip ratio ``(depth_B_i − depth_B_j) / (depth_A_i − depth_A_j)`` — the
    caller multiplies by the column distance to get a predicted offset.

    Parameters
    ----------
    pairs : list[tuple[float, float]]
        List of ``(depth_at_A, depth_at_B)`` pairs from correlated edges
        on a column pair.  Must contain at least two entries; fewer return
        ``None``.

    Returns
    -------
    float | None
        Theil-Sen slope, or ``None`` when fewer than 2 input pairs are
        supplied.
    """
    if len(pairs) < 2:
        return None

    slopes: list[float] = []
    for i in range(len(pairs)):
        for j in range(i + 1, len(pairs)):
            x1, y1 = pairs[i]
            x2, y2 = pairs[j]
            dx = x2 - x1
            if dx == 0.0:
                continue
            slopes.append((y2 - y1) / dx)

    if not slopes:
        return None

    slopes.sort()
    n = len(slopes)
    if n % 2 == 1:
        return slopes[n // 2]
    return (slopes[n // 2 - 1] + slopes[n // 2]) / 2.0


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


@dataclass
class AutoCorrelateParams:
    """Tuning parameters for ``auto_correlate_litho_bodies``.

    All fields have defaults matching the owner-locked constants so callers
    that accept the standard behaviour need not construct this object.

    Attributes
    ----------
    base_depth_threshold_m : float
        Minimum window half-width regardless of column distance.
    distance_factor : float
        Window growth rate (m per m of column separation).
    max_column_distance_m : float
        Hard cap — column pairs beyond this are skipped entirely.
    min_edges_for_dip_transfer : int
        Confidence gate: dip predictor activates only after this many
        edges have been accumulated on a column pair.
    """

    base_depth_threshold_m: float = BASE_DEPTH_THRESHOLD_M
    distance_factor: float = DISTANCE_FACTOR
    max_column_distance_m: float = MAX_COLUMN_DISTANCE_M
    min_edges_for_dip_transfer: int = MIN_EDGES_FOR_DIP_TRANSFER


def auto_correlate_litho_bodies(
    contacts: list[FormationContactRecord],
    investigations: list[InvestigationLocation],
    *,
    existing_edges: set[tuple[UUID, UUID]] | None = None,
    params: AutoCorrelateParams | None = None,
) -> list[CorrelationCandidate]:
    """Bottom-up sweep with dip transfer — produce formation correlation candidates.

    Processes naming groups (same parent_formation_id + litho_main_soil_code)
    in depth order (deepest/oldest first, by median contact depth).  For each
    group, walks every column pair within ``params.max_column_distance_m`` and
    proposes ``CorrelationCandidate`` edges between **different** formation rows
    in that group using mutual-nearest-neighbour disambiguation inside a
    distance-aware depth window.  Earlier (deeper) groups' accepted edges seed a
    per-column-pair Theil-Sen dip estimate that shifts the search window for
    shallower groups.

    The function is **pure**: no I/O, no ORM, no side effects.  The
    caller handles deduplication against existing DB edges and the commit.

    Parameters
    ----------
    contacts : list[FormationContactRecord]
        All formation contacts in the lithostratigraphic model.  Each record
        carries ``formation_id``, ``investigation_id``, ``depth_top_m``,
        ``parent_formation_id``, and ``litho_main_soil_code``.
    investigations : list[InvestigationLocation]
        All investigations in the model's corridor.
    existing_edges : set[tuple[UUID, UUID]] | None
        Canonical ``(min_fid, max_fid)`` formation-id pairs that already
        have a correlation edge.  Net-new candidates only in the output.
        Pass ``None`` (or omit) to receive all candidates.
    params : AutoCorrelateParams | None
        Algorithm tuning parameters.  Defaults to the owner-locked
        constants when ``None``.

    Returns
    -------
    list[CorrelationCandidate]
        Net-new correlation candidates.  Empty when no suitable pairs are
        found, when fewer than two investigations are provided, or when
        there are no contacts.
    """
    if params is None:
        params = AutoCorrelateParams()
    if existing_edges is None:
        existing_edges = set()

    if len(investigations) < 2 or not contacts:
        return []

    # --- Index investigation locations ----------------------------------------
    inv_by_id: dict[UUID, InvestigationLocation] = {
        inv.investigation_id: inv for inv in investigations
    }
    inv_ids = [inv.investigation_id for inv in investigations]

    # --- Group contacts by naming group ---------------------------------------
    # Key: (parent_formation_id, litho_main_soil_code)
    # Value: list of contacts in that group
    group_contacts: dict[tuple[UUID, str], list[FormationContactRecord]] = {}
    for c in contacts:
        key = (c.parent_formation_id, c.litho_main_soil_code)
        if key not in group_contacts:
            group_contacts[key] = []
        group_contacts[key].append(c)

    if not group_contacts:
        return []

    # --- Sort groups by median contact depth (deepest/oldest first) -----------
    def _group_median_depth(clist: list[FormationContactRecord]) -> float:
        depths = sorted(c.depth_top_m for c in clist)
        n = len(depths)
        if n == 0:
            return 0.0
        if n % 2 == 1:
            return depths[n // 2]
        return (depths[n // 2 - 1] + depths[n // 2]) / 2.0

    sorted_groups = sorted(
        group_contacts.items(),
        key=lambda kv: _group_median_depth(kv[1]),
        reverse=True,  # deepest first
    )

    # --- Per-column-pair dip state -------------------------------------------
    # Key: canonical (min_iid, max_iid) investigation-id pair
    # Value: list of per-edge dip estimates in m/m (metres depth offset per
    #        metre of horizontal distance).  The robust estimate for a given
    #        column pair is the Theil-Sen estimator of these values, which
    #        for a 1-D sample reduces to the median.  Storing each edge's
    #        individual estimate (depth_b - depth_a) / distance lets us
    #        compute the median robustly and avoids the need to store the
    #        raw (depth_a, depth_b) pairs.
    dip_data: dict[tuple[UUID, UUID], list[float]] = {}
    dist_cache: dict[tuple[UUID, UUID], float] = {}

    output: list[CorrelationCandidate] = []
    # Track emitted (fa_id, fb_id) canonical pairs to deduplicate output.
    emitted: set[tuple[UUID, UUID]] = set()

    for _group_key, group_clist in sorted_groups:
        # Index by investigation_id → list of (formation_id, depth_top_m)
        at_inv: dict[UUID, list[tuple[UUID, float]]] = {}
        for c in group_clist:
            if c.investigation_id not in inv_by_id:
                # Contact at an investigation not in the corridor — skip.
                continue
            if c.investigation_id not in at_inv:
                at_inv[c.investigation_id] = []
            at_inv[c.investigation_id].append((c.formation_id, c.depth_top_m))

        # Need at least 2 investigations with contacts in this group.
        participating_invs = [iid for iid in inv_ids if iid in at_inv]
        if len(participating_invs) < 2:
            continue

        for i_idx in range(len(participating_invs)):
            for j_idx in range(i_idx + 1, len(participating_invs)):
                iid_a = participating_invs[i_idx]
                iid_b = participating_invs[j_idx]

                # Canonical column-pair key.
                if iid_a < iid_b:
                    pair_key = (iid_a, iid_b)
                    # inv_a / inv_b already in canonical order
                    inv_a = inv_by_id[iid_a]
                    inv_b = inv_by_id[iid_b]
                    formations_at_a = at_inv[iid_a]
                    formations_at_b = at_inv[iid_b]
                else:
                    pair_key = (iid_b, iid_a)
                    # Swap so pair_key always has the lesser id first
                    inv_a = inv_by_id[iid_b]
                    inv_b = inv_by_id[iid_a]
                    formations_at_a = at_inv[iid_b]
                    formations_at_b = at_inv[iid_a]

                # Distance gate.
                if pair_key not in dist_cache:
                    dist_cache[pair_key] = _dist(inv_a, inv_b)
                d = dist_cache[pair_key]
                if d > params.max_column_distance_m:
                    continue

                # --- Dip-transfer prediction ----------------------------------
                # dip_estimates: list of (depth_b - depth_a) / distance values
                # from accepted edges on this column pair (across all groups
                # processed so far).  The robust estimate is the median.
                dip_estimates = dip_data.get(pair_key, [])
                window = params.base_depth_threshold_m + params.distance_factor * d

                if len(dip_estimates) >= params.min_edges_for_dip_transfer:
                    # Median of per-edge dip rates: the 1-D Theil-Sen estimator.
                    sorted_dips = sorted(dip_estimates)
                    n_dip = len(sorted_dips)
                    if n_dip % 2 == 1:
                        median_dip = sorted_dips[n_dip // 2]
                    else:
                        median_dip = (sorted_dips[n_dip // 2 - 1] + sorted_dips[n_dip // 2]) / 2.0
                else:
                    median_dip = None

                # --- Build candidate pairs ------------------------------------
                candidates: list[_CandidatePair] = []
                for fa_id, depth_a in formations_at_a:
                    if median_dip is not None:
                        predicted_b = depth_a + median_dip * d
                    else:
                        predicted_b = depth_a

                    for fb_id, depth_b in formations_at_b:
                        # Must be different formations.
                        if fa_id == fb_id:
                            continue
                        residual = abs(depth_b - predicted_b)
                        if residual < window:
                            candidates.append(
                                _CandidatePair(
                                    formation_a_id=fa_id,
                                    formation_b_id=fb_id,
                                    depth_a=depth_a,
                                    depth_b=depth_b,
                                    residual=residual,
                                )
                            )

                if not candidates:
                    continue

                # --- Mutual-nearest-neighbour disambiguation ------------------
                accepted = _mutual_nearest_neighbour(candidates)

                for cand in accepted:
                    edge_a = min(cand.formation_a_id, cand.formation_b_id)
                    edge_b = max(cand.formation_a_id, cand.formation_b_id)
                    edge_key = (edge_a, edge_b)

                    if edge_key in existing_edges or edge_key in emitted:
                        continue

                    emitted.add(edge_key)
                    output.append(
                        CorrelationCandidate(
                            formation_a_id=edge_a,
                            formation_b_id=edge_b,
                            source=AUTO_SOURCE,
                        )
                    )

                    # Update dip estimate for this column pair.
                    # Store the per-edge dip rate (m depth per m horizontal).
                    # Avoid divide-by-zero: distance was already checked > 0
                    # by the MAX_COLUMN_DISTANCE_M gate (d > 0 guaranteed).
                    if pair_key not in dip_data:
                        dip_data[pair_key] = []
                    dip_data[pair_key].append((cand.depth_b - cand.depth_a) / d)

    return output


# ---------------------------------------------------------------------------
# Public re-exports for backward-compat test imports
# ---------------------------------------------------------------------------

# The public helpers are directly importable from this module.
mutual_nearest_neighbour = _mutual_nearest_neighbour
