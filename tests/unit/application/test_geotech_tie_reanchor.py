"""Unit tests for the geotech tie re-anchor rule (owner ruling 2026-08-01).

The rule, in the owner's words: a rebuilt packing band IS the band an accepted
tie used to point at when **the same investigation, the same depth interval and
the same NAD class** all hold.  Exact — no tolerance was asked for and none is
applied.

These tests exercise the pure planner only (no DB).  They speak the rule's own
vocabulary: "the band came back exactly as it was", "the boundary moved",
"the qc re-derived a different class", "the rebuild no longer draws that
geology there".
"""

from __future__ import annotations

from uuid import UUID

from groundmodel.application.geotech_tie_reanchor import (
    REASON_BAND_ABSENT,
    REASON_BOREHOLE_DEFERRED,
    REASON_CLASS_CHANGED,
    REASON_INTERVAL_MOVED,
    BandIdentity,
    CapturedTie,
    RebuiltBand,
    depth_to_mm,
    plan_tie_reanchor,
)

_SECTION = UUID("11111111-1111-1111-1111-111111111111")
_EDGE = UUID("22222222-2222-2222-2222-222222222222")
_INV_A = "aaaaaaaa-0000-0000-0000-000000000001"
_INV_B = "bbbbbbbb-0000-0000-0000-000000000002"


def _identity(inv: str, top_m: float, base_m: float, nad: int | None) -> BandIdentity:
    """Build a band identity from metres, the way the capture pass does."""
    return BandIdentity(
        investigation_id=inv,
        depth_top_mm=depth_to_mm(top_m),
        depth_base_mm=depth_to_mm(base_m),
        nad_class=nad,
    )


def _tie(
    identity_a: BandIdentity,
    identity_b: BandIdentity,
    *,
    kind_a: str = "cpt",
    kind_b: str = "cpt",
    source: str = "manual",
) -> CapturedTie:
    """Build a captured accepted tie between two band identities."""
    return CapturedTie(
        edge_id=_EDGE,
        section_id=_SECTION,
        layer_a_side="top",
        layer_b_side="top",
        source=source,
        identity_a=identity_a,
        identity_b=identity_b,
        anchor_kind_a=kind_a,
        anchor_kind_b=kind_b,
    )


def _band(identity: BandIdentity, layer_id: str) -> RebuiltBand:
    """Build a rebuilt band with a chosen new layer id."""
    return RebuiltBand(identity=identity, layer_id=UUID(layer_id))


def test_a_band_that_comes_back_identical_re_anchors_the_tie() -> None:
    """Same investigation, same interval, same class → the tie is re-anchored."""
    id_a = _identity(_INV_A, 2.0, 4.5, 12)
    id_b = _identity(_INV_B, 2.2, 4.4, 12)
    plan = plan_tie_reanchor(
        [_tie(id_a, id_b)],
        [
            _band(id_a, "33333333-0000-0000-0000-000000000001"),
            _band(id_b, "33333333-0000-0000-0000-000000000002"),
        ],
    )

    assert not plan.lost
    assert len(plan.matched) == 1
    matched_tie, new_a, new_b = plan.matched[0]
    assert matched_tie.source == "manual"
    assert new_a == UUID("33333333-0000-0000-0000-000000000001")
    assert new_b == UUID("33333333-0000-0000-0000-000000000002")


def test_the_boundary_moved_so_the_tie_is_lost_not_re_pointed() -> None:
    """The band's base shifted 20 cm — a different interval, so no match.

    The owner was asked directly about a wobble of this size and did not ask
    for a tolerance.  20 cm is not "the same depth interval".
    """
    id_a = _identity(_INV_A, 2.0, 4.5, 12)
    id_b = _identity(_INV_B, 2.2, 4.4, 12)
    moved = _identity(_INV_A, 2.0, 4.7, 12)
    plan = plan_tie_reanchor(
        [_tie(id_a, id_b)],
        [
            _band(moved, "33333333-0000-0000-0000-000000000001"),
            _band(id_b, "33333333-0000-0000-0000-000000000002"),
        ],
    )

    assert not plan.matched
    assert len(plan.lost) == 1
    assert plan.lost[0].reason_a == REASON_INTERVAL_MOVED
    assert plan.lost[0].reason_b is None
    assert plan.loss_reason_counts() == {REASON_INTERVAL_MOVED: 1}


def test_the_qc_re_derived_a_different_class_so_the_tie_is_lost() -> None:
    """Same investigation, same interval, different NAD class → no match.

    This is the case that must never silently re-point: the band occupies the
    same depths but the rebuild classified it differently, so it is not the
    band the engineer tied.
    """
    id_a = _identity(_INV_A, 2.0, 4.5, 12)
    id_b = _identity(_INV_B, 2.2, 4.4, 12)
    reclassified = _identity(_INV_B, 2.2, 4.4, 17)
    plan = plan_tie_reanchor(
        [_tie(id_a, id_b)],
        [
            _band(id_a, "33333333-0000-0000-0000-000000000001"),
            _band(reclassified, "33333333-0000-0000-0000-000000000002"),
        ],
    )

    assert not plan.matched
    assert plan.lost[0].reason_a is None
    assert plan.lost[0].reason_b == REASON_CLASS_CHANGED
    assert plan.loss_reason_counts() == {REASON_CLASS_CHANGED: 1}


def test_the_rebuild_draws_no_geology_there_at_all() -> None:
    """No rebuilt band overlaps the old interval → the band is simply gone."""
    id_a = _identity(_INV_A, 2.0, 4.5, 12)
    id_b = _identity(_INV_B, 2.2, 4.4, 12)
    elsewhere = _identity(_INV_A, 20.0, 24.0, 12)
    plan = plan_tie_reanchor(
        [_tie(id_a, id_b)],
        [
            _band(elsewhere, "33333333-0000-0000-0000-000000000001"),
            _band(id_b, "33333333-0000-0000-0000-000000000002"),
        ],
    )

    assert not plan.matched
    assert plan.lost[0].reason_a == REASON_BAND_ABSENT
    assert plan.loss_reason_counts() == {REASON_BAND_ABSENT: 1}


def test_an_investigation_the_rebuild_never_touched_reports_band_absent() -> None:
    """The whole column is missing from the rebuild → band absent, not moved."""
    id_a = _identity(_INV_A, 2.0, 4.5, 12)
    id_b = _identity(_INV_B, 2.2, 4.4, 12)
    plan = plan_tie_reanchor(
        [_tie(id_a, id_b)], [_band(id_b, "33333333-0000-0000-0000-000000000002")]
    )

    assert not plan.matched
    assert plan.lost[0].reason_a == REASON_BAND_ABSENT


def test_a_borehole_endpoint_is_reported_as_deferred_not_as_lost_geology() -> None:
    """A borehole column has no bands yet — that is a schedule fact, not geology.

    ``SubdivideAllBodies`` materialises CPT bands only; ``DivideBoreholes``
    fills the borehole columns afterwards.  A tie anchored on a borehole
    therefore finds nothing to re-anchor to at this point in the build, and
    must not be reported as "the rebuild no longer draws that geology".
    """
    id_a = _identity(_INV_A, 2.0, 4.5, 12)
    id_b = _identity(_INV_B, 2.2, 4.4, 12)
    plan = plan_tie_reanchor(
        [_tie(id_a, id_b, kind_b="borehole")],
        [_band(id_a, "33333333-0000-0000-0000-000000000001")],
    )

    assert not plan.matched
    assert plan.lost[0].reason_b == REASON_BOREHOLE_DEFERRED
    assert plan.loss_reason_counts() == {REASON_BOREHOLE_DEFERRED: 1}


def test_both_endpoints_can_fail_for_different_reasons() -> None:
    """A tie reports a reason per endpoint, so the loss can be diagnosed."""
    id_a = _identity(_INV_A, 2.0, 4.5, 12)
    id_b = _identity(_INV_B, 2.2, 4.4, 12)
    moved_a = _identity(_INV_A, 2.0, 4.9, 12)
    reclassified_b = _identity(_INV_B, 2.2, 4.4, 17)
    plan = plan_tie_reanchor(
        [_tie(id_a, id_b)],
        [
            _band(moved_a, "33333333-0000-0000-0000-000000000001"),
            _band(reclassified_b, "33333333-0000-0000-0000-000000000002"),
        ],
    )

    assert not plan.matched
    assert plan.lost[0].reason_a == REASON_INTERVAL_MOVED
    assert plan.lost[0].reason_b == REASON_CLASS_CHANGED
    # One tie, counted once per distinct reason it carries.
    assert plan.loss_reason_counts() == {REASON_INTERVAL_MOVED: 1, REASON_CLASS_CHANGED: 1}


def test_two_ties_never_re_anchor_onto_the_same_pair_of_bands() -> None:
    """A duplicate pair is emitted once — the DB uniqueness is not a surprise."""
    id_a = _identity(_INV_A, 2.0, 4.5, 12)
    id_b = _identity(_INV_B, 2.2, 4.4, 12)
    plan = plan_tie_reanchor(
        [_tie(id_a, id_b), _tie(id_a, id_b)],
        [
            _band(id_a, "33333333-0000-0000-0000-000000000001"),
            _band(id_b, "33333333-0000-0000-0000-000000000002"),
        ],
    )

    assert len(plan.matched) == 1
    assert plan.skipped_duplicate_pair == 1


def test_a_class_free_skeleton_band_matches_only_another_class_free_band() -> None:
    """``None`` is a class value like any other under the exact rule."""
    id_a = _identity(_INV_A, 2.0, 4.5, None)
    id_b = _identity(_INV_B, 2.2, 4.4, None)
    plan = plan_tie_reanchor(
        [_tie(id_a, id_b)],
        [
            _band(id_a, "33333333-0000-0000-0000-000000000001"),
            _band(id_b, "33333333-0000-0000-0000-000000000002"),
        ],
    )

    assert len(plan.matched) == 1


def test_depth_key_is_the_millimetre_grain_the_database_itself_uses() -> None:
    """Depths key on millimetres — the grain of the no-overlap exclusion.

    ``litho_layer``'s exclusion constraint compares
    ``numrange(round(depth_top_m::numeric, 3), round(depth_base_m::numeric, 3))``,
    so a millimetre is the finest interval the database can tell apart.  This
    is the storage grain, NOT a geological tolerance: a centimetre still
    reads as a different interval.
    """
    assert depth_to_mm(2.0) == 2000
    assert depth_to_mm(2.4569999999999999) == 2457
    assert depth_to_mm(2.457) == depth_to_mm(2.4570000000001)
    assert depth_to_mm(2.457) != depth_to_mm(2.467)
