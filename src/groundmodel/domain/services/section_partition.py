"""Section-partition helpers — faithful Python port of the relevant parts of partitionFill.ts.

Implements the two helpers consumed by ``compute_section_fill`` (Task 3):

  ``classify_termination`` — maps a unit's bounding-contact correlation count to
  the owner's contact-correlation model (2026-06-09): 2 → band, 1 → onlap, 0 → lens.

  ``match_columns`` — monotonic weighted-LCS cross-column alignment; explicit
  correlation edges beat geometric overlap, lithology must agree (no cross-litho
  pairing).

The data-class shapes mirror the TypeScript interfaces in ``partitionFill.ts``
(snake_cased field names).  ``PartitionUnit`` is intentionally **mutable** (not
frozen) because ``compute_section_fill`` deep-copies its inputs and ``reduce_column``
/ ``collapse_adjacent_same_formation`` mutate those copies in place — the same
pattern as the TS pipeline.  The other three dataclasses are frozen (value types).

Pure module — no I/O, no logging, no SQLAlchemy, no numpy.  Domain layer only.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

# Floating-point epsilon used for overlap comparisons — mirrors ``const EPS = 1e-9``
# in partitionFill.ts.  A pair of elevations whose difference is smaller than this
# is treated as non-overlapping (touching edges do not constitute overlap).
EPS: float = 1e-9


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------


@dataclass
class PartitionUnit:
    """One accepted litho layer on a column, in depth-below-surface metres.

    Intentionally **mutable** (not frozen): ``compute_section_fill`` deep-copies
    the input columns, then ``reduce_column`` and ``collapse_adjacent_same_formation``
    mutate those copies in place — the same pattern as the TypeScript pipeline.

    Parameters
    ----------
    top_depth_m : float
        Depth below surface of the unit's top contact (metres, positive down).
    base_depth_m : float
        Depth below surface of the unit's base contact (metres, positive down).
    formation_id : str
        Drives the fill colour (lithology).
    body_id : str | None
        Resolver-stamped body — kept for region identity only; NOT used for
        matching because the resolver over-lumps body_id across lithologies/beds.
        Matching uses explicit correlation edges via ``layer_id``.
    layer_id : str
        The ``litho_layer.id`` — the stable identity a correlation edge references.
        Two units BAND iff an approved ``LithoContactCorrelationEdge`` connects
        their ``layer_id``s.
    """

    top_depth_m: float
    base_depth_m: float
    formation_id: str
    body_id: str | None
    layer_id: str


@dataclass(frozen=True)
class PartitionColumn:
    """One column's placement and its gap-free unit stack.

    Parameters
    ----------
    investigation_id : str
        The investigation this column belongs to.
    surface_elev_m : float
        Surface elevation (mTAW) — converts depth → absolute elevation.
    units : tuple[PartitionUnit, ...]
        Unit stack sorted shallow → deep (ascending ``top_depth_m``).
    """

    investigation_id: str
    surface_elev_m: float
    units: tuple[PartitionUnit, ...]


@dataclass(frozen=True)
class CorrelationEdge:
    """An approved correlation edge — a pair of ``litho_layer`` ids.

    Two units BAND across a gap iff an approved ``LithoContactCorrelationEdge``
    connects their ``layer_id``s.  This is the trustworthy band signal (vs the
    resolver's over-lumped ``body_id``).

    Parameters
    ----------
    a : str
        One ``litho_layer.id`` endpoint of the edge.
    b : str
        The other ``litho_layer.id`` endpoint of the edge.
    """

    a: str
    b: str


@dataclass(frozen=True)
class MatchUnit:
    """A unit prepared for cross-column matching, elevations pre-computed (mTAW).

    Parameters
    ----------
    formation_id : str
        Lithology — lithology must agree for any pairing to be considered.
    layer_id : str
        ``litho_layer.id`` — what correlation edges reference (the band signal).
    top_elev : float
        Higher elevation — the unit's top (mTAW, positive up).
    base_elev : float
        Lower elevation — the unit's base (mTAW, positive up).
    """

    formation_id: str
    layer_id: str
    top_elev: float
    base_elev: float


# Type alias mirrors the TS ``Correlated`` type.
Correlated = Callable[[str, str], bool]

# ContactTermination mirrors the TS union type.
ContactTermination = str  # 'band' | 'onlap' | 'lens'


# ---------------------------------------------------------------------------
# classify_termination
# ---------------------------------------------------------------------------


def classify_termination(
    units: list[PartitionUnit] | tuple[PartitionUnit, ...],
    index: int,
    neighbour_layer_ids: frozenset[str] | set[str],
    correlated: Correlated,
    correlated_to_neighbour: frozenset[str] | set[str] | None = None,
) -> ContactTermination:
    """Classify a unit's termination toward a single neighbour column.

    A unit is bounded by a TOP contact and a BASE contact.  A contact correlates
    to the neighbour iff an approved edge connects the relevant layer to any layer
    on that neighbour:

      - **top** contact  — an edge on THIS unit's ``layer_id`` (a layer's id keys
        the contact at its top, matching ``LithoContactCorrelationEdge``).
      - **base** contact — an edge on the layer immediately BELOW (its top contact
        IS this unit's base).  The deepest unit has no unit below, so its base
        cannot correlate (counts as uncorrelated).

    The count (0 / 1 / 2) maps directly: 0 → lens, 1 → onlap, 2 → band.
    This is per-SIDE: pass the facing neighbour's layer ids, so the same unit
    can band toward one neighbour and pinch toward the other.

    Parameters
    ----------
    units : list[PartitionUnit] | tuple[PartitionUnit, ...]
        The unit's column, sorted shallow → deep.
    index : int
        The unit's position in ``units``.
    neighbour_layer_ids : frozenset[str] | set[str]
        Every ``layer_id`` on the facing neighbour column.
    correlated : Correlated
        Approved-edge lookup between two ``layer_id``s.
    correlated_to_neighbour : frozenset[str] | set[str] | None, optional
        Pre-computed set of layer ids (on this column) that have at least one
        approved edge to any layer on the neighbour.  When provided this is a
        pure O(1) ``in`` check; when absent the function falls back to scanning
        ``neighbour_layer_ids`` via ``correlated``.  Both paths return the same
        result — this is a hot-loop optimisation used by ``reduce_column``.

    Returns
    -------
    ContactTermination
        ``'band'`` (2 contacts correlated), ``'onlap'`` (1), or ``'lens'`` (0).
    """
    # When the caller pre-computed which layer ids are correlated to any neighbour
    # (a hot-loop optimisation — see reduce_column), this is a set lookup; else we
    # fall back to scanning neighbour_layer_ids.  Same result either way.
    if correlated_to_neighbour is not None:

        def contact_correlated(layer_id: str) -> bool:
            return layer_id in correlated_to_neighbour
    else:

        def contact_correlated(layer_id: str) -> bool:
            return any(correlated(layer_id, v) for v in neighbour_layer_ids)

    below = units[index + 1] if index + 1 < len(units) else None
    top_corr = contact_correlated(units[index].layer_id)
    # The deepest unit has no unit below — its base can never correlate.
    base_corr = below is not None and contact_correlated(below.layer_id)
    count = (1 if top_corr else 0) + (1 if base_corr else 0)
    if count == 2:
        return "band"
    if count == 1:
        return "onlap"
    return "lens"


# ---------------------------------------------------------------------------
# match_columns — private helper
# ---------------------------------------------------------------------------


def _pair_score(left: MatchUnit, right: MatchUnit, correlated: Correlated) -> int:
    """Score a candidate cross-column pairing — edges first, geometry as fallback.

    Lithology must agree (never pair across lithology).  An explicit correlation
    edge is the authoritative BAND signal — it connects layers at ANY elevation
    (a correlated bed that dips between columns, e.g. a peat layer).  Geometric
    overlap (no edge) is the last-resort fill tier for the matrix:

      same litho + edge + overlap  → 4  (explicit correlation, aligned)
      same litho + edge            → 3  (explicit correlation — dipping correlated bed)
      same litho + overlap (no edge) → 1  (geometry — matrix coverage fill only)
      otherwise                    → 0  (no match → pinches out)

    ``body_id`` is deliberately NOT used — it is the resolver's over-lumped
    transitive closure (one body spanning several lithologies/beds), which falsely
    banded uncorrelated beds.  Only the direct edges are trusted.

    Parameters
    ----------
    left : MatchUnit
        Unit from the left column.
    right : MatchUnit
        Unit from the right column.
    correlated : Correlated
        Approved-edge lookup between two ``layer_id``s.

    Returns
    -------
    int
        Pair score (0, 1, 3, or 4).
    """
    if left.formation_id != right.formation_id:
        return 0
    # Elevation overlap: strictly greater than EPS to exclude mere touching edges.
    overlap = left.top_elev > right.base_elev + EPS and right.top_elev > left.base_elev + EPS
    edge = correlated(left.layer_id, right.layer_id)
    if edge and overlap:
        return 4
    if edge:
        return 3
    if overlap:
        return 1
    return 0


# ---------------------------------------------------------------------------
# match_columns
# ---------------------------------------------------------------------------


def match_columns(
    left: list[MatchUnit],
    right: list[MatchUnit],
    correlated: Correlated,
) -> list[tuple[int, int]]:
    """Monotonic (order-preserving) cross-column matching.

    Edge-correlated pairs band, with geometric overlap as the fallback fill tier.
    A weighted longest-common-subsequence over ``_pair_score`` that maximises
    total confidence, so explicit correlations win and the uncorrelated matrix
    still connects by overlap; never pairs across lithology.

    Parameters
    ----------
    left : list[MatchUnit]
        Left column's units, sorted shallow → deep.
    right : list[MatchUnit]
        Right column's units, sorted shallow → deep.
    correlated : Correlated
        Edge lookup (approved correlation between two ``layer_id``s).

    Returns
    -------
    list[tuple[int, int]]
        Matched ``(left_index, right_index)`` pairs in ascending order.
    """
    n = len(left)
    m = len(right)
    # dp[i][j] = best total score matching left[:i] against right[:j].
    dp: list[list[int]] = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            s = _pair_score(left[i - 1], right[j - 1], correlated)
            best = max(dp[i - 1][j], dp[i][j - 1])
            if s > 0:
                best = max(best, dp[i - 1][j - 1] + s)
            dp[i][j] = best

    # Back-trace to recover the matched pairs (reverse order, then flip).
    pairs: list[tuple[int, int]] = []
    i, j = n, m
    while i > 0 and j > 0:
        s = _pair_score(left[i - 1], right[j - 1], correlated)
        if s > 0 and dp[i][j] == dp[i - 1][j - 1] + s:
            pairs.append((i - 1, j - 1))
            i -= 1
            j -= 1
        elif dp[i - 1][j] >= dp[i][j - 1]:
            i -= 1
        else:
            j -= 1
    pairs.reverse()
    return pairs
