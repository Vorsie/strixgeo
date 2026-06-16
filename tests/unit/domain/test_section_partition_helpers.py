"""Unit tests for section_partition helpers — classify_termination + match_columns.

No DB, no I/O.  These tests encode the owner's contact-correlation model
(2026-06-09): a unit's termination toward a neighbour is decided by how many
of its TWO bounding contacts carry an approved correlation edge to that neighbour.

  2 correlated contacts → band   (spans the gap as a quad)
  1 correlated contact  → onlap  (laps against the correlated tie-line)
  0 correlated contacts → lens   (both boundaries converge to a point)

The rule is per-side: the same unit can band toward one neighbour and lens
toward the other.

``classify_termination`` rule references
-----------------------------------------
- "both contacts correlated to the neighbour → band"
- "exactly one contact correlated → onlap"
- "neither contact correlated → lens"
- "deepest unit's base cannot correlate (no unit below)"

``match_columns`` rule references
-----------------------------------
- "same formation required — never pair across lithology"
- "explicit correlation edge beats geometry"
- "monotonic order-preserving pairing"
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.section_partition import (
    CorrelationEdge,
    MatchUnit,
    PartitionColumn,
    PartitionUnit,
    classify_termination,
    match_columns,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _unit(
    layer_id: str, formation_id: str = "SAND", top: float = 0.0, base: float = 1.0
) -> PartitionUnit:
    return PartitionUnit(
        top_depth_m=top,
        base_depth_m=base,
        formation_id=formation_id,
        body_id=None,
        layer_id=layer_id,
    )


def _correlated_fn(edges: list[tuple[str, str]]):
    """Return a correlated(a, b) -> bool closure over a list of edge pairs."""
    edge_set = {(a, b) for a, b in edges} | {(b, a) for a, b in edges}
    return lambda a, b: (a, b) in edge_set


# ---------------------------------------------------------------------------
# classify_termination — basic cases
# ---------------------------------------------------------------------------


def test_both_contacts_correlated_to_neighbour_is_band():
    """Both top + base contacts correlated to the neighbour → band."""
    # Stack: unit-A (layer "L1") on top, unit-B (layer "L2") below.
    # Neighbour has layers "R1" and "R2".
    # L1 correlated to R1; L2 (base contact of unit-A) correlated to R2 → 2 contacts → band.
    units = [_unit("L1", top=0.0, base=1.0), _unit("L2", top=1.0, base=2.0)]
    neighbour_ids = frozenset({"R1", "R2"})
    correlated = _correlated_fn([("L1", "R1"), ("L2", "R2")])
    result = classify_termination(
        units, index=0, neighbour_layer_ids=neighbour_ids, correlated=correlated
    )
    assert result == "band"


def test_one_contact_correlated_to_neighbour_is_onlap():
    """Exactly one contact correlated to the neighbour → onlap."""
    # L1 (top) correlated to R1; L2 (base, the unit below) NOT correlated → 1 → onlap.
    units = [_unit("L1", top=0.0, base=1.0), _unit("L2", top=1.0, base=2.0)]
    neighbour_ids = frozenset({"R1"})
    correlated = _correlated_fn([("L1", "R1")])
    result = classify_termination(
        units, index=0, neighbour_layer_ids=neighbour_ids, correlated=correlated
    )
    assert result == "onlap"


def test_no_contacts_correlated_to_neighbour_is_lens():
    """Neither top nor base contact correlated to the neighbour → lens."""
    units = [_unit("L1", top=0.0, base=1.0), _unit("L2", top=1.0, base=2.0)]
    neighbour_ids = frozenset({"R1", "R2"})
    correlated = _correlated_fn([])  # no edges at all
    result = classify_termination(
        units, index=0, neighbour_layer_ids=neighbour_ids, correlated=correlated
    )
    assert result == "lens"


def test_deepest_unit_base_cannot_correlate_so_band_requires_only_top():
    """Deepest unit has no unit below — its base can never correlate.

    Even if L1 (top contact) IS correlated, only 1 contact can possibly correlate
    → the result is 'onlap', never 'band', regardless of the edge set.
    """
    # Single unit (deepest), top contact correlated → 1 corr + base impossible = onlap.
    units = [_unit("L1", top=0.0, base=2.0)]
    neighbour_ids = frozenset({"R1"})
    correlated = _correlated_fn([("L1", "R1")])
    result = classify_termination(
        units, index=0, neighbour_layer_ids=neighbour_ids, correlated=correlated
    )
    assert result == "onlap"


def test_middle_unit_base_contact_is_the_layer_below():
    """A MIDDLE unit's base contact is keyed by the layer immediately below it.

    L2 sits between L1 and L3: its top contact is L2's own layer id, its base
    contact is L3's. With both correlated to the neighbour → band.
    """
    units = [
        _unit("L1", top=0.0, base=1.0),
        _unit("L2", top=1.0, base=2.0),
        _unit("L3", top=2.0, base=3.0),
    ]
    neighbour_ids = frozenset({"R2", "R3"})
    correlated = _correlated_fn([("L2", "R2"), ("L3", "R3")])
    result = classify_termination(
        units, index=1, neighbour_layer_ids=neighbour_ids, correlated=correlated
    )
    assert result == "band"


def test_deepest_unit_with_no_top_correlation_is_lens():
    """Deepest unit, top contact NOT correlated → lens (0 out of 1 possible)."""
    units = [_unit("L1", top=0.0, base=2.0)]
    neighbour_ids = frozenset({"R1"})
    correlated = _correlated_fn([])
    result = classify_termination(
        units, index=0, neighbour_layer_ids=neighbour_ids, correlated=correlated
    )
    assert result == "lens"


def test_classify_termination_uses_precomputed_correlated_to_neighbour_fast_path():
    """Pre-computed correlatedToNeighbour set gives the same result as the scan path."""
    units = [_unit("L1", top=0.0, base=1.0), _unit("L2", top=1.0, base=2.0)]
    neighbour_ids = frozenset({"R1", "R2"})
    correlated = _correlated_fn([("L1", "R1"), ("L2", "R2")])

    # Build the precomputed set manually (what reduceColumn would compute).
    correlated_to_neighbour = frozenset(
        lid for lid in ("L1", "L2") if any(correlated(lid, r) for r in neighbour_ids)
    )
    result_fast = classify_termination(
        units,
        index=0,
        neighbour_layer_ids=neighbour_ids,
        correlated=correlated,
        correlated_to_neighbour=correlated_to_neighbour,
    )
    result_scan = classify_termination(
        units,
        index=0,
        neighbour_layer_ids=neighbour_ids,
        correlated=correlated,
    )
    assert result_fast == result_scan == "band"


def test_classify_termination_is_per_side_same_unit_can_band_one_way_and_lens_other():
    """Per-side rule: passing a different neighbour_layer_ids set changes the result."""
    units = [_unit("L1", top=0.0, base=1.0), _unit("L2", top=1.0, base=2.0)]
    correlated = _correlated_fn([("L1", "R1"), ("L2", "R2")])

    # Toward the right neighbour with both R1+R2 → band.
    right_ids = frozenset({"R1", "R2"})
    assert classify_termination(units, 0, right_ids, correlated) == "band"

    # Toward a left neighbour with neither → lens.
    left_ids = frozenset({"X1", "X2"})
    assert classify_termination(units, 0, left_ids, correlated) == "lens"


def test_classify_onlap_when_only_base_contact_is_correlated():
    """Only the base contact (unit below) is correlated → onlap (not band)."""
    # L1 top NOT correlated; L2 (base contact) IS correlated → 1 → onlap.
    units = [_unit("L1", top=0.0, base=1.0), _unit("L2", top=1.0, base=2.0)]
    neighbour_ids = frozenset({"R2"})
    correlated = _correlated_fn([("L2", "R2")])
    result = classify_termination(
        units, index=0, neighbour_layer_ids=neighbour_ids, correlated=correlated
    )
    assert result == "onlap"


# ---------------------------------------------------------------------------
# match_columns — basic cases
# ---------------------------------------------------------------------------


def _mu(layer_id: str, formation_id: str, top_elev: float, base_elev: float) -> MatchUnit:
    return MatchUnit(
        formation_id=formation_id, layer_id=layer_id, top_elev=top_elev, base_elev=base_elev
    )


def test_match_columns_edge_correlated_same_formation_pairs():
    """An explicit correlation edge between two same-formation units → they pair."""
    left = [_mu("L1", "SAND", top_elev=0.0, base_elev=-2.0)]
    right = [_mu("R1", "SAND", top_elev=0.0, base_elev=-2.0)]
    correlated = _correlated_fn([("L1", "R1")])
    pairs = match_columns(left, right, correlated)
    assert pairs == [(0, 0)]


def test_match_columns_never_pair_across_different_lithology():
    """Never pair units across different formation_id, even with overlapping elevations."""
    left = [_mu("L1", "SAND", top_elev=0.0, base_elev=-2.0)]
    right = [_mu("R1", "CLAY", top_elev=0.0, base_elev=-2.0)]
    correlated = _correlated_fn([("L1", "R1")])  # edge exists but lithology differs
    pairs = match_columns(left, right, correlated)
    assert pairs == []


def test_match_columns_no_edges_no_overlap_returns_empty():
    """No edges and no elevation overlap → nothing pairs."""
    left = [_mu("L1", "SAND", top_elev=0.0, base_elev=-1.0)]
    right = [_mu("R1", "SAND", top_elev=-5.0, base_elev=-10.0)]
    correlated = _correlated_fn([])
    pairs = match_columns(left, right, correlated)
    assert pairs == []


def test_match_columns_geometry_overlap_pairs_when_no_edge():
    """Same formation + elevation overlap with no explicit edge → pairs (score 1)."""
    left = [_mu("L1", "SAND", top_elev=0.0, base_elev=-2.0)]
    right = [_mu("R1", "SAND", top_elev=0.0, base_elev=-2.0)]
    correlated = _correlated_fn([])  # no edge, but overlap exists
    pairs = match_columns(left, right, correlated)
    assert pairs == [(0, 0)]


def test_match_columns_edge_beats_geometry_overlap_in_score():
    """An explicit edge (score 3) beats pure geometry (score 1).

    Two candidates for the same left unit: one with an edge (R1) and one with
    pure overlap (R2).  The monotonic LCS should prefer R1 via higher score.
    """
    left = [_mu("L1", "SAND", top_elev=0.0, base_elev=-2.0)]
    # R1 has edge; R2 has overlap only.  Both same formation, overlapping elevations.
    right = [
        _mu("R1", "SAND", top_elev=0.0, base_elev=-2.0),
        _mu("R2", "SAND", top_elev=-1.0, base_elev=-3.0),
    ]
    correlated = _correlated_fn([("L1", "R1")])
    pairs = match_columns(left, right, correlated)
    # L1 should pair with R1 (edge score 4 = edge+overlap) not R2 (score 1 = overlap only).
    assert pairs == [(0, 0)]


def test_match_columns_monotonic_order_is_preserved():
    """Matched pairs are returned in ascending (left-index, right-index) order."""
    left = [
        _mu("L1", "SAND", top_elev=0.0, base_elev=-1.0),
        _mu("L2", "CLAY", top_elev=-1.0, base_elev=-3.0),
    ]
    right = [
        _mu("R1", "SAND", top_elev=0.0, base_elev=-1.0),
        _mu("R2", "CLAY", top_elev=-1.0, base_elev=-3.0),
    ]
    correlated = _correlated_fn([("L1", "R1"), ("L2", "R2")])
    pairs = match_columns(left, right, correlated)
    assert pairs == [(0, 0), (1, 1)]


def test_match_columns_empty_inputs_returns_empty():
    """Empty columns → no pairs."""
    correlated = _correlated_fn([])
    assert match_columns([], [], correlated) == []
    assert match_columns([_mu("L1", "SAND", 0.0, -1.0)], [], correlated) == []
    assert match_columns([], [_mu("R1", "SAND", 0.0, -1.0)], correlated) == []


# ---------------------------------------------------------------------------
# Dataclass smoke tests
# ---------------------------------------------------------------------------


def test_partition_unit_is_mutable():
    """PartitionUnit must NOT be frozen — the TS pipeline mutates copies in place."""
    u = _unit("L1")
    u.formation_id = "CLAY"
    assert u.formation_id == "CLAY"


def test_partition_column_and_correlation_edge_are_frozen():
    """PartitionColumn and CorrelationEdge are immutable value types."""
    col = PartitionColumn(investigation_id="INV1", surface_elev_m=5.0, units=())
    with pytest.raises((AttributeError, TypeError)):
        col.investigation_id = "X"  # type: ignore[misc]

    edge = CorrelationEdge(a="L1", b="R1")
    with pytest.raises((AttributeError, TypeError)):
        edge.a = "X"  # type: ignore[misc]


def test_match_unit_is_frozen():
    """MatchUnit is an immutable value type."""
    mu = _mu("L1", "SAND", 0.0, -1.0)
    with pytest.raises((AttributeError, TypeError)):
        mu.layer_id = "X"  # type: ignore[misc]
