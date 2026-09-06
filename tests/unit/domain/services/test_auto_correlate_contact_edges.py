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
    admix: tuple[str, ...] = (),
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
    admix : tuple[str, ...]
        Admixture tokens of the unit ABOVE the contact (order-independent).
        Defaults to empty (the "no admixture data" case).

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
        litho_admixtures=admix,
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
    pairs = {(c.layer_a_id, c.layer_b_id) for c in result}
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


def test_below_litho_no_longer_gates_pairing() -> None:
    """Same main lithology pairs regardless of the unit below (#163 dogfeed 2026-05-29).

    Two ZAND contacts whose below-lithology differs (KLEI vs SILT).  The old
    (parent, above, below) signature blocked this; the lithology-only key
    correlates them — the user's "silt-sand" case where one column has an extra
    interbed below the sand.
    """
    contacts = [
        _make_contact(1, 10, 5.0, 99, "ZAND", "KLEI"),
        _make_contact(2, 11, 5.0, 99, "ZAND", "SILT"),
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 50.0, 0.0),
    ]
    result = auto_correlate_contact_edges(contacts, locations)
    assert len(result) == 1
    pair = result[0]
    assert {pair.layer_a_id, pair.layer_b_id} == {_uid(1), _uid(2)}


def test_below_litho_does_not_restrict_same_lithology() -> None:
    """below=None no longer gates pairing — main-lithology grouping ignores it.

    Previously a deepest contact (below=None) paired only with another
    below=None; now the ZAND chain links purely by adjacency (10-11, 11-12;
    10-12 blocked by 11) regardless of the below-code.
    """
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
    pairs = {
        frozenset((c.layer_a_id, c.layer_b_id))
        for c in auto_correlate_contact_edges(contacts, locations)
    }
    assert frozenset((_uid(1), _uid(2))) in pairs
    assert frozenset((_uid(2), _uid(3))) in pairs
    assert len(pairs) == 2


def test_different_parent_same_lithology_still_correlates() -> None:
    """Same main lithology pairs even when the geological parent differs.

    The user's "2nd silt" case (#163 dogfeed 2026-05-29): identical SILT
    lithology, but one unit is parented to Holoceen and the other — mis-assigned
    at a boundary — to Antropogeen.  The old (parent, ...) key blocked it; the
    lithology-only key correlates them.
    """
    contacts = [
        _make_contact(1, 10, 5.0, 77, "SILT", "ZAND"),
        _make_contact(2, 11, 5.0, 88, "SILT", "ZAND"),
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 50.0, 0.0),
    ]
    result = auto_correlate_contact_edges(contacts, locations)
    assert len(result) == 1
    assert {result[0].layer_a_id, result[0].layer_b_id} == {_uid(1), _uid(2)}


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
        (c.layer_a_id, c.layer_b_id) for c in auto_correlate_contact_edges(contacts, locations)
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
        (c.layer_a_id, c.layer_b_id) for c in auto_correlate_contact_edges(contacts, locations)
    }
    # The dipping ZAND boundary must correlate with the DEFAULT params.
    assert (_uid(1), _uid(3)) in pairs


def test_steep_diagonal_over_long_distance_does_not_autocorrelate() -> None:
    """A steep depth jump between far-apart tests must NOT auto-correlate.

    Owner dogfeed 2026-06-02: "noone would auto-suggest that diagonal from the
    left test to the next — it'd be better as a lens." The depth window is a
    dip-gradient ceiling; at the old 5%/metre factor a same-lithology contact
    at 1 m on one column correlated to one ~9 m deep on a column 150 m away
    (an ~8 m drop = ~5% dip), which reads as a steep diagonal nobody would
    draw. The tightened 4% ceiling rejects it: at 150 m the window is
    ``0.5 + 0.04·150 = 6.5 m`` < the 7.5 m residual here (which the old 8 m
    window happily accepted).
    """
    contacts = [
        _make_contact(1, 10, 1.0, 99, "ZAND", None),
        _make_contact(2, 11, 8.5, 99, "ZAND", None),  # 7.5 m deeper, 150 m away
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 150.0, 0.0),
    ]
    assert auto_correlate_contact_edges(contacts, locations) == []


def test_gentle_dip_over_long_distance_still_autocorrelates() -> None:
    """An ordinary gentle dip over a long span MUST still correlate.

    The tightened ceiling limits the DIP, not the absolute residual: a ~2%
    gradient is ordinary geology and stays valid at any distance. Here the
    ZAND top dips 3 m over 150 m (2%); the 4% window is ``0.5 + 0.04·150 =
    6.5 m`` > the 3 m residual, so the pair correlates.
    """
    contacts = [
        _make_contact(1, 10, 4.0, 99, "ZAND", None),
        _make_contact(2, 11, 7.0, 99, "ZAND", None),  # 3 m deeper, 150 m away
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 150.0, 0.0),
    ]
    pairs = {
        (c.layer_a_id, c.layer_b_id) for c in auto_correlate_contact_edges(contacts, locations)
    }
    assert (_uid(1), _uid(2)) in pairs


def test_depth_window_param_widens_what_correlates() -> None:
    """#163b — the depth-match window base is user-tunable.

    Two contacts on neighbouring tests 50 m apart with a 3.0 m depth
    residual.  The default window (0.5 + 0.04·50 = 2.5 m at this distance)
    rejects the pair; a widened ``base_depth_threshold_m=1.5`` (→ 3.5 m
    window) accepts it — the knob the Settings control feeds.
    """
    contacts = [
        _make_contact(1, 10, 5.0, 99, "ZAND", "KLEI"),
        _make_contact(2, 11, 8.0, 99, "ZAND", "KLEI"),
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 50.0, 0.0),
    ]
    # Default window (2.5 m at 50 m) is too tight for a 3.0 m residual.
    assert auto_correlate_contact_edges(contacts, locations) == []
    # Widening the base to 1.5 m (→ 3.5 m window) lets the pair through.
    widened = AutoCorrelateContactParams(base_depth_threshold_m=1.5)
    result = auto_correlate_contact_edges(contacts, locations, widened)
    assert {(_uid(1), _uid(2))} == {(c.layer_a_id, c.layer_b_id) for c in result}


def test_chain_does_not_orphan_a_boundary_when_neighbour_matches_a_third_test() -> None:
    """#163 dogfeed 2026-05-29 — the bottom layer must keep auto-suggesting.

    Three collinear tests A(0 m) B(50 m) C(100 m), all sharing one deepest
    boundary (below=None, the basement top).  The middle test B sits closer
    in depth to A (0.10 m) than to C (0.40 m).  The user's rule: every
    adjacent test's matching boundary should correlate — B's boundary must
    link to BOTH its neighbours (A and C).  It must NOT be orphaned on the
    C side just because A is a slightly closer depth-match, which is what
    the owner saw: the deepest contact on some columns never got an edge.

    The contact ids are arranged so the shared middle test (B) owns the
    EXTREME id of the trio — the precise arrangement that made the old
    group-wide mutual-nearest-neighbour step drop the B-C edge.
    """
    contacts = [
        _make_contact(1, 10, 15.00, 99, "KLEI", None),  # A deepest, id 1
        _make_contact(3, 11, 15.10, 99, "KLEI", None),  # B deepest, id 3 (max)
        _make_contact(2, 12, 15.50, 99, "KLEI", None),  # C deepest, id 2
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 50.0, 0.0),
        InvestigationLocation(_uid(12), 100.0, 0.0),
    ]
    pairs = {
        (c.layer_a_id, c.layer_b_id) for c in auto_correlate_contact_edges(contacts, locations)
    }
    # A-B links (canonical (1, 3)).
    assert (_uid(1), _uid(3)) in pairs
    # B-C must ALSO link (canonical (2, 3)) — B's boundary is not orphaned.
    assert (_uid(2), _uid(3)) in pairs
    assert len(pairs) == 2


def test_mnn_tie_breaking_picks_exactly_one() -> None:
    """Two contacts on column B equidistant from a column-A contact: MNN keeps exactly one."""
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


def test_explicit_adjacency_overrides_map_plane_rng() -> None:
    """A caller-supplied adjacency replaces the model-wide RNG gate.

    Three collinear tests (x = 0, 50, 100) with an identical boundary
    signature.  The default map-plane RNG pairs only consecutive neighbours
    (1-2, 2-3) and blocks 1-3 (test 2 sits in the lune).  Passing an explicit
    ``adjacency`` of {1, 3} flips that: ONLY the 1-3 edge survives — proving
    the section-along-order gate can override map-plane proximity (dogfeed
    2026-05-29: section column order, not true-2D RNG, must drive adjacency).
    """
    contacts = [
        _make_contact(1, 1, 5.0, 99, "ZAND", "KLEI"),
        _make_contact(2, 2, 5.0, 99, "ZAND", "KLEI"),
        _make_contact(3, 3, 5.0, 99, "ZAND", "KLEI"),
    ]
    locations = [
        InvestigationLocation(_uid(1), 0.0, 0.0),
        InvestigationLocation(_uid(2), 50.0, 0.0),
        InvestigationLocation(_uid(3), 100.0, 0.0),
    ]
    # Default map-plane RNG: consecutive only, 1-3 blocked by 2.
    default_pairs = {
        frozenset((c.layer_a_id, c.layer_b_id))
        for c in auto_correlate_contact_edges(contacts, locations)
    }
    assert frozenset((_uid(1), _uid(2))) in default_pairs
    assert frozenset((_uid(2), _uid(3))) in default_pairs
    assert frozenset((_uid(1), _uid(3))) not in default_pairs

    # Explicit adjacency {1, 3} only: 1-3 is the sole surviving edge.
    forced = {frozenset((_uid(1), _uid(3)))}
    overridden = {
        frozenset((c.layer_a_id, c.layer_b_id))
        for c in auto_correlate_contact_edges(contacts, locations, adjacency=forced)
    }
    assert overridden == {frozenset((_uid(1), _uid(3)))}


# ---------------------------------------------------------------------------
# Admixtures rank suggestions but never exclude them (owner ruling 2026-09-06).
# ---------------------------------------------------------------------------


def test_matching_admixture_ranks_above_a_mismatching_one_at_the_same_depth() -> None:
    """Owner: "a matching admixture ranks above a mismatching one at the same depth".

    One ZAND contact on the left column carries a SILT admixture.  The right
    column offers TWO ZAND contacts at the identical depth (both a perfect
    depth match): one whose admixture MATCHES (also SILT) and one whose
    admixture MISMATCHES (clean sand, no admixture).  Because both raw depth
    residuals are zero, the only thing that can separate them is the
    admixture: the matching pair must win the mutual-nearest-neighbour
    reduction and the mismatching pair must be dropped.

    The contact ids are arranged so the MISMATCHING right-column contact owns
    the LOWER id (2) and the MATCHING one the higher (3).  Without the
    admixture penalty the MNN tie-break (lowest opposite-endpoint id) would
    pick the mismatching pair (1, 2); only the penalty flips the winner to the
    matching pair (1, 3).
    """
    contacts = [
        _make_contact(1, 10, 5.0, 99, "ZAND", "KLEI", admix=("SILT:",)),
        # Right column, lower id, MISMATCH (clean sand): would win on a raw tie.
        _make_contact(2, 11, 5.0, 99, "ZAND", "KLEI", admix=()),
        # Right column, higher id, MATCH (also silty sand).
        _make_contact(3, 11, 5.0, 99, "ZAND", "KLEI", admix=("SILT:",)),
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 50.0, 0.0),
    ]
    result = auto_correlate_contact_edges(contacts, locations)
    pairs = {(c.layer_a_id, c.layer_b_id) for c in result}
    # The matching-admixture pair wins.
    assert (_uid(1), _uid(3)) in pairs
    # The mismatching pair is out-ranked and dropped.
    assert (_uid(1), _uid(2)) not in pairs
    assert len(result) == 1
    assert result[0].admixture_match is True


def test_mismatching_admixture_is_still_suggested_when_it_is_the_only_candidate() -> None:
    """Owner: "a mismatching admixture is still suggested when it is the only candidate".

    Two adjacent ZAND contacts at the same depth whose admixtures differ
    (silty sand vs clean sand).  There is no competing candidate, so the
    mismatch must NOT block the suggestion; the pair is still proposed, and
    it is flagged ``admixture_match=False`` so the UI can show the difference.
    """
    contacts = [
        _make_contact(1, 10, 5.0, 99, "ZAND", None, admix=("SILT:",)),
        _make_contact(2, 11, 5.0, 99, "ZAND", None, admix=()),
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 50.0, 0.0),
    ]
    result = auto_correlate_contact_edges(contacts, locations)
    assert len(result) == 1
    assert {result[0].layer_a_id, result[0].layer_b_id} == {_uid(1), _uid(2)}
    assert result[0].admixture_match is False


def test_mismatch_never_turns_a_candidate_inside_the_depth_window_into_no_candidate() -> None:
    """Owner: "a mismatch never turns a candidate inside the depth window into no candidate".

    The admixture penalty must move the RANKING residual only, never the
    window admission test.  Here two adjacent ZAND contacts 50 m apart sit
    2.4 m apart in depth (inside the default window, 0.5 + 0.04*50 = 2.5 m)
    but their admixtures mismatch, so ``residual + penalty`` (2.4 + 0.25 =
    2.65 m) would fall OUTSIDE the window.  Because the window is tested on the
    RAW residual, the candidate must survive; if the penalty leaked into the
    window test the pair would vanish.
    """
    contacts = [
        _make_contact(1, 10, 5.0, 99, "ZAND", None, admix=("SILT:",)),
        _make_contact(2, 11, 7.4, 99, "ZAND", None, admix=()),  # 2.4 m deeper, mismatch
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 50.0, 0.0),
    ]
    result = auto_correlate_contact_edges(contacts, locations)
    assert {(_uid(1), _uid(2))} == {(c.layer_a_id, c.layer_b_id) for c in result}
    assert result[0].admixture_match is False


def test_suggestions_without_admixture_data_are_byte_identical_to_before() -> None:
    """Guard: suggestions without admixture data are byte-identical to before.

    The default empty admixture tuple must leave the algorithm's output
    exactly as it was: the happy-path scenario (three columns, two boundaries
    each) still yields the same four correlation pairs, and every candidate
    reports ``admixture_match is None`` (there is no admixture data to compare,
    so no ranking signal fires and the field carries the neutral default).
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
    pairs = {(c.layer_a_id, c.layer_b_id) for c in result}
    assert pairs == {
        (_uid(1), _uid(3)),
        (_uid(3), _uid(5)),
        (_uid(2), _uid(4)),
        (_uid(4), _uid(6)),
    }
    assert len(result) == 4
    # No admixture data anywhere → no signal, neutral default on every candidate.
    assert all(c.admixture_match is None for c in result)
