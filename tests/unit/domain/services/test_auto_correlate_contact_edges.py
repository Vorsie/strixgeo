"""Unit tests for contact-level auto-correlate (#133 Phase 2+3)."""

from __future__ import annotations

from uuid import UUID

from groundmodel.domain.services.auto_correlate_contact_edges import (
    AutoCorrelateContactParams,
    ContactRecord,
    InvestigationLocation,
    auto_correlate_contact_edges,
)


def _uid(n: int) -> UUID:
    """Deterministic UUID for fixtures.

    Parameters
    ----------
    n : int
        Integer seed.

    Returns
    -------
    UUID
        UUID built from ``n``.
    """
    return UUID(int=n)


# Test convenience: formation_id defaults to the same UUID seed as
# contact_id when caller doesn't care.  The algorithm only reads
# formation_id transitively via parent_formation_id grouping, so
# the value is irrelevant in most tests.
def _make_contact(
    cid: int,
    inv_id: int,
    depth: float,
    parent: int,
    above: str,
    below: str | None,
    formation: int | None = None,
) -> ContactRecord:
    """Construct a ContactRecord from terse positional inputs.

    Parameters
    ----------
    cid : int
        Contact id seed.
    inv_id : int
        Investigation id seed.
    depth : float
        Depth top in metres.
    parent : int
        Parent formation id seed.
    above : str
        Lithology above the contact.
    below : str | None
        Lithology below the contact (None for deepest contact).
    formation : int | None
        Formation id seed.  Defaults to ``cid`` if omitted.

    Returns
    -------
    ContactRecord
        Constructed record.
    """
    return ContactRecord(
        contact_id=_uid(cid),
        formation_id=_uid(formation or cid),
        investigation_id=_uid(inv_id),
        depth_top_m=depth,
        parent_formation_id=_uid(parent),
        litho_main_soil_code=above,
        litho_below_code=below,
    )


def test_happy_path_three_columns_two_boundaries_each() -> None:
    """Three columns at distance 50 m apart, each with a sand-on-clay
    boundary at ~5 m and a clay-on-silt boundary at ~10 m.  MNN produces
    the spanning-tree pairing per group: A↔B and B↔C (not A↔C, because
    A↔B and B↔C each win MNN over A↔C).  Two groups × two pairs = 4.
    """
    contacts = [
        _make_contact(1, 10, 5.0, 99, "ZAND", "KLEI"),
        _make_contact(2, 10, 10.0, 99, "KLEI", "SILT"),
        _make_contact(3, 11, 5.1, 99, "ZAND", "KLEI"),
        _make_contact(4, 11, 10.1, 99, "KLEI", "SILT"),
        _make_contact(5, 12, 5.2, 99, "ZAND", "KLEI"),
        _make_contact(6, 12, 10.2, 99, "KLEI", "SILT"),
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 50.0, 0.0),
        InvestigationLocation(_uid(12), 100.0, 0.0),
    ]
    result = auto_correlate_contact_edges(contacts, locations)
    # MNN keeps the two adjacent-column pairings per group, not the
    # diagonal A↔C (which has a larger residual).
    pairs = {(c.contact_a_id, c.contact_b_id) for c in result}
    # Group sand/clay: contacts 1, 3, 5 — MNN keeps 1↔3 and 3↔5
    assert (_uid(1), _uid(3)) in pairs
    assert (_uid(3), _uid(5)) in pairs
    # Group clay/silt: contacts 2, 4, 6 — MNN keeps 2↔4 and 4↔6
    assert (_uid(2), _uid(4)) in pairs
    assert (_uid(4), _uid(6)) in pairs
    # No diagonals — 1↔5 and 2↔6 should NOT survive MNN.
    assert (_uid(1), _uid(5)) not in pairs
    assert (_uid(2), _uid(6)) not in pairs
    assert len(result) == 4


def test_boundary_signature_filter_rejects_different_below_litho() -> None:
    """Two contacts with same above-lithology but different below-lithology don't pair."""
    contacts = [
        _make_contact(1, 10, 5.0, 99, "ZAND", "KLEI"),
        _make_contact(2, 11, 5.0, 99, "ZAND", "SILT"),
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 50.0, 0.0),
    ]
    assert auto_correlate_contact_edges(contacts, locations) == []


def test_null_below_litho_matches_only_other_nulls() -> None:
    """A deepest-contact (below=None) pairs only with another deepest-contact, not a ZAND→KLEI."""
    contacts = [
        _make_contact(1, 10, 5.0, 99, "ZAND", None),
        _make_contact(2, 11, 5.1, 99, "ZAND", None),
        _make_contact(3, 12, 5.0, 99, "ZAND", "KLEI"),
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 50.0, 0.0),
        InvestigationLocation(_uid(12), 100.0, 0.0),
    ]
    result = auto_correlate_contact_edges(contacts, locations)
    assert len(result) == 1
    pair = result[0]
    assert {pair.contact_a_id, pair.contact_b_id} == {_uid(1), _uid(2)}


def test_distance_gate_rejects_far_pairs() -> None:
    """Two contacts more than MAX_COLUMN_DISTANCE_M apart never pair, even at identical depth."""
    contacts = [
        _make_contact(1, 10, 5.0, 99, "ZAND", "KLEI"),
        _make_contact(2, 11, 5.0, 99, "ZAND", "KLEI"),
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 300.0, 0.0),
    ]
    assert auto_correlate_contact_edges(contacts, locations) == []


def test_adjacent_only_keeps_consecutive_chain_not_skip_over_diagonals() -> None:
    """#163a — auto-correlate links only adjacent tests along the line.

    Four tests strung out collinearly (0, 50, 100, 150 m) with one
    boundary signature.  Depths alternate (5.0, 5.45, 5.0, 5.45) so the
    perfect-residual matches are the SKIP-OVER pairs T1-T3 and T2-T4 —
    exactly the "spaghetti" the owner sees: edges that jump over the
    neighbouring test.  The rule: a correlation may only join tests that
    are geometrically adjacent, so the result must be the consecutive
    chain (T1-T2, T2-T3, T3-T4) and never the skip-over diagonals.
    """
    contacts = [
        _make_contact(1, 10, 5.00, 99, "ZAND", "KLEI"),
        _make_contact(2, 11, 5.45, 99, "ZAND", "KLEI"),
        _make_contact(3, 12, 5.00, 99, "ZAND", "KLEI"),
        _make_contact(4, 13, 5.45, 99, "ZAND", "KLEI"),
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 50.0, 0.0),
        InvestigationLocation(_uid(12), 100.0, 0.0),
        InvestigationLocation(_uid(13), 150.0, 0.0),
    ]
    pairs = {
        (c.contact_a_id, c.contact_b_id) for c in auto_correlate_contact_edges(contacts, locations)
    }
    # Consecutive chain only.
    assert (_uid(1), _uid(2)) in pairs
    assert (_uid(2), _uid(3)) in pairs
    assert (_uid(3), _uid(4)) in pairs
    # The skip-over diagonals (jump over the neighbour) must be gone.
    assert (_uid(1), _uid(3)) not in pairs
    assert (_uid(2), _uid(4)) not in pairs
    assert (_uid(1), _uid(4)) not in pairs
    assert len(pairs) == 3


def test_dipping_bed_correlates_with_default_window() -> None:
    """#163 dogfeed 2026-05-29 — a realistically-dipping bed must correlate.

    Two adjacent tests ~50 m apart, identical boundary signature, but the
    shared horizon dips ~1 m (9.01 m vs 10.08 m — a ~2% gradient, totally
    ordinary geology). With the old window (0.5 + 0.002·dist ≈ 0.6 m at 50 m)
    this obvious correlation was silently missed. The default window must be
    generous enough to catch ordinary dip — RNG adjacency already prevents
    spaghetti, so a wide window is safe.
    """
    contacts = [
        # Left column: ZAND-on-KLEI at 9.01, KLEI (deepest) at 15.0.
        _make_contact(1, 10, 9.01, 99, "ZAND", "KLEI"),
        _make_contact(2, 10, 15.0, 99, "KLEI", None),
        # Right column: same signature, ZAND top dips to 10.08 (1.07 m deeper).
        _make_contact(3, 11, 10.08, 99, "ZAND", "KLEI"),
        _make_contact(4, 11, 14.9, 99, "KLEI", None),
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 50.0, 0.0),  # ~50 m apart
    ]
    pairs = {
        (c.contact_a_id, c.contact_b_id) for c in auto_correlate_contact_edges(contacts, locations)
    }
    # The dipping ZAND boundary must correlate with the DEFAULT params.
    assert (_uid(1), _uid(3)) in pairs


def test_depth_window_param_widens_what_correlates() -> None:
    """#163b — the depth-match window base is user-tunable.

    Two contacts on neighbouring tests 50 m apart with a 3.5 m depth
    residual.  The default window (0.5 + 0.05·50 = 3.0 m at this distance)
    rejects the pair; a widened ``base_depth_threshold_m=1.5`` (→ 4.0 m
    window) accepts it — the knob the Settings control feeds.
    """
    contacts = [
        _make_contact(1, 10, 5.0, 99, "ZAND", "KLEI"),
        _make_contact(2, 11, 8.5, 99, "ZAND", "KLEI"),
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 50.0, 0.0),
    ]
    # Default window (3.0 m at 50 m) is too tight for a 3.5 m residual.
    assert auto_correlate_contact_edges(contacts, locations) == []
    # Widening the base to 1.5 m (→ 4.0 m window) lets the pair through.
    widened = AutoCorrelateContactParams(base_depth_threshold_m=1.5)
    result = auto_correlate_contact_edges(contacts, locations, widened)
    assert {(_uid(1), _uid(2))} == {(c.contact_a_id, c.contact_b_id) for c in result}


def test_mnn_tie_breaking_picks_exactly_one() -> None:
    """When two contacts on column B are equidistant from a column-A contact, MNN keeps exactly one."""
    contacts = [
        _make_contact(1, 10, 5.0, 99, "ZAND", "KLEI"),
        _make_contact(2, 11, 5.4, 99, "ZAND", "KLEI"),
        _make_contact(3, 11, 5.4, 99, "ZAND", "KLEI"),
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 50.0, 0.0),
    ]
    result = auto_correlate_contact_edges(contacts, locations)
    assert len(result) == 1
