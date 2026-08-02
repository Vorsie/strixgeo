"""Unit tests for the geotech tie re-anchor rule.

The original rule (owner, 2026-08-01) matched a rebuilt band to an accepted tie's
band on **same investigation, same depth interval, same NAD class**, exactly.  On
the real model that dropped 13 accepted ties, and the owner rejected the outcome
(2026-08-02): *"you're literally just dragging the anchor to which the tie is
connected, shouldn't it just move with the anchor?"*

So the rule now has three tiers.  A band that comes back at exactly the same
interval is still the same band.  Failing that, **a tie follows its band when
exactly one rebuilt band of the same class overlaps where the old band was** —
that is the old band with a moved boundary.  Failing THAT, the tie is carried
onto whichever band covers most of where it used to be and **flagged for review**,
because of the owner's stronger rule (2026-08-02): *"i don't want accepted edges
to just disappear without any user explicitly deleting it."*

The flag is what keeps tier 3 honest.  Nothing is silently re-pointed: an
ambiguous or re-classified anchor produces a tie the engineer is asked about, and
only an endpoint with nothing overlapping it at all is genuinely uncarryable.

Measured on the dev model: tier 2 rescued 12 of 13 lost ties (the boundary had
moved as little as 4 cm), and tier 3 covers the 13th — a nad=16 band whose column
came back as nad 6 / 8 / 14.

These tests exercise the pure planner only (no DB).  They speak the rule's own
vocabulary: "the band came back exactly as it was", "the boundary moved and the
tie moved with it", "the qc re-derived a different class", "the rebuild no longer
draws that geology there".
"""

from __future__ import annotations

from uuid import UUID

from groundmodel.application.geotech_tie_reanchor import (
    REASON_BAND_ABSENT,
    REASON_BOREHOLE_DEFERRED,
    REVIEW_AMBIGUOUS_BAND,
    REVIEW_CLASS_CHANGED,
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
    match = plan.matched[0]
    new_a, new_b = match.layer_a_id, match.layer_b_id
    assert match.tie.source == "manual"
    assert new_a == UUID("33333333-0000-0000-0000-000000000001")
    assert new_b == UUID("33333333-0000-0000-0000-000000000002")


def test_the_boundary_moved_so_the_tie_moves_with_its_band() -> None:
    """The band's base shifted 20 cm — same band, moved boundary, tie follows.

    Real case from the dev model: a nad=8 band at 14.110–17.640 came back as
    14.110–17.840.  Dragging a boundary is not deleting a band, so the tie that
    was pinned to it travels with it.
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

    assert not plan.lost
    assert len(plan.matched) == 1
    new_a, new_b = plan.matched[0].layer_a_id, plan.matched[0].layer_b_id
    assert new_a == UUID("33333333-0000-0000-0000-000000000001")
    assert new_b == UUID("33333333-0000-0000-0000-000000000002")


def test_a_band_swallowed_by_a_widened_neighbour_still_carries_its_tie() -> None:
    """The peat above widened and absorbed the band — the tie still follows it.

    Real case: a nad=30 band at 6.150–6.510 came back as 5.098–6.948 after a
    litho contact was dragged.  The old interval is entirely inside the new one,
    which is the same band grown, not a new one.
    """
    id_a = _identity(_INV_A, 6.150, 6.510, 30)
    id_b = _identity(_INV_B, 5.300, 6.070, 30)
    widened = _identity(_INV_A, 5.098, 6.948, 30)
    plan = plan_tie_reanchor(
        [_tie(id_a, id_b)],
        [
            _band(widened, "33333333-0000-0000-0000-000000000001"),
            _band(id_b, "33333333-0000-0000-0000-000000000002"),
        ],
    )

    assert not plan.lost
    assert plan.matched[0].layer_a_id == UUID("33333333-0000-0000-0000-000000000001")


def test_a_band_still_at_its_old_interval_wins_over_one_that_merely_overlaps() -> None:
    """An exact interval match is preferred — following is only the fallback.

    Without this, a band that came back untouched could be abandoned in favour
    of a neighbour that happens to overlap it, which would move a tie the owner
    never touched.
    """
    id_a = _identity(_INV_A, 2.0, 4.5, 12)
    id_b = _identity(_INV_B, 2.2, 4.4, 12)
    overlapping = _identity(_INV_A, 4.5, 9.0, 12)
    plan = plan_tie_reanchor(
        [_tie(id_a, id_b)],
        [
            _band(overlapping, "33333333-0000-0000-0000-000000000009"),
            _band(id_a, "33333333-0000-0000-0000-000000000001"),
            _band(id_b, "33333333-0000-0000-0000-000000000002"),
        ],
    )

    assert not plan.lost
    assert plan.matched[0].layer_a_id == UUID("33333333-0000-0000-0000-000000000001")


def test_a_clean_match_carries_no_review_flag() -> None:
    """A band that came back unchanged needs no second look from the engineer."""
    id_a = _identity(_INV_A, 2.0, 4.5, 12)
    id_b = _identity(_INV_B, 2.2, 4.4, 12)
    plan = plan_tie_reanchor(
        [_tie(id_a, id_b)],
        [
            _band(id_a, "33333333-0000-0000-0000-000000000001"),
            _band(id_b, "33333333-0000-0000-0000-000000000002"),
        ],
    )

    assert plan.matched[0].review_reason is None


def test_two_same_class_bands_overlap_it_so_the_tie_is_flagged_not_guessed() -> None:
    """Two candidates of the same class → which one is "the band" is unknowable.

    The tie is still carried — the engineer accepted it and has not deleted it —
    but onto the band covering most of where it used to be, and flagged so the
    choice is theirs to confirm rather than the machine's to make silently.
    """
    id_a = _identity(_INV_A, 2.0, 6.0, 12)
    id_b = _identity(_INV_B, 2.2, 4.4, 12)
    split_upper = _identity(_INV_A, 2.0, 3.9, 12)
    split_lower = _identity(_INV_A, 4.1, 6.0, 12)
    plan = plan_tie_reanchor(
        [_tie(id_a, id_b)],
        [
            _band(split_upper, "33333333-0000-0000-0000-000000000001"),
            _band(split_lower, "33333333-0000-0000-0000-000000000003"),
            _band(id_b, "33333333-0000-0000-0000-000000000002"),
        ],
    )

    assert not plan.lost
    assert plan.matched[0].review_reason == REVIEW_AMBIGUOUS_BAND
    # 2.0–3.9 covers 1.9 m of the old 2.0–6.0; 4.1–6.0 covers 1.9 m too, and the
    # tie-break is the first in depth order — deterministic either way.
    assert plan.matched[0].layer_a_id == UUID("33333333-0000-0000-0000-000000000001")


def test_a_band_whose_class_changed_is_flagged_for_review_not_dropped() -> None:
    """The class re-derived, so the tie needs a human — but it is not deleted.

    Real case: a nad=16 band at 17.640–18.270 came back with nad 6 / 8 / 14 over
    those depths and no nad=16 anywhere.  The owner's rule is that an accepted
    tie never disappears without them deleting it, so it is carried onto the band
    that now occupies those depths and flagged, never silently re-pointed.
    """
    id_a = _identity(_INV_A, 17.640, 18.270, 16)
    id_b = _identity(_INV_B, 17.400, 18.100, 16)
    other_class = _identity(_INV_A, 17.840, 18.214, 6)
    plan = plan_tie_reanchor(
        [_tie(id_a, id_b)],
        [
            _band(other_class, "33333333-0000-0000-0000-000000000001"),
            _band(id_b, "33333333-0000-0000-0000-000000000002"),
        ],
    )

    assert not plan.lost
    assert plan.matched[0].review_reason == REVIEW_CLASS_CHANGED
    assert plan.matched[0].layer_a_id == UUID("33333333-0000-0000-0000-000000000001")


def test_the_band_covering_most_of_the_old_one_is_the_one_carried() -> None:
    """Among differently-classed overlaps, the deepest overlap wins.

    Real case: nad=6 covers 0.374 m of the old band, nad=8 covers 0.200 m and
    nad=14 covers 0.056 m.  Picking the largest is deterministic and is the band
    a reviewer would look at first.
    """
    id_a = _identity(_INV_A, 17.640, 18.270, 16)
    id_b = _identity(_INV_B, 17.400, 18.100, 16)
    plan = plan_tie_reanchor(
        [_tie(id_a, id_b)],
        [
            _band(_identity(_INV_A, 14.110, 17.840, 8), "33333333-0000-0000-0000-00000000000a"),
            _band(_identity(_INV_A, 17.840, 18.214, 6), "33333333-0000-0000-0000-00000000000b"),
            _band(_identity(_INV_A, 18.214, 19.190, 14), "33333333-0000-0000-0000-00000000000c"),
            _band(id_b, "33333333-0000-0000-0000-000000000002"),
        ],
    )

    assert plan.matched[0].layer_a_id == UUID("33333333-0000-0000-0000-00000000000b")
    assert plan.matched[0].review_reason == REVIEW_CLASS_CHANGED


def test_the_qc_re_derived_a_different_class_in_place_and_the_tie_is_flagged() -> None:
    """Same investigation, same interval, different NAD class → carried, flagged.

    The band occupies exactly the depths the engineer tied, so nothing about the
    connection's geometry changed; only the derived class did.  That is a
    judgement call for the engineer, so the tie survives with the flag rather
    than being decided either way by the machine.
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

    assert not plan.lost
    assert plan.matched[0].review_reason == REVIEW_CLASS_CHANGED
    assert plan.matched[0].layer_b_id == UUID("33333333-0000-0000-0000-000000000002")


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
    """A tie reports a reason per endpoint, so the loss can be diagnosed.

    Only endpoints with nothing overlapping them at all can still be lost, so
    both sides here are that case: A's column was rebuilt but draws nothing over
    those depths, and B is a borehole whose bands come later in the build.
    """
    id_a = _identity(_INV_A, 2.0, 4.5, 12)
    id_b = _identity(_INV_B, 2.2, 4.4, 12)
    elsewhere_a = _identity(_INV_A, 20.0, 24.0, 12)
    plan = plan_tie_reanchor(
        [_tie(id_a, id_b, kind_b="borehole")],
        [_band(elsewhere_a, "33333333-0000-0000-0000-000000000001")],
    )

    assert not plan.matched
    assert plan.lost[0].reason_a == REASON_BAND_ABSENT
    assert plan.lost[0].reason_b == REASON_BOREHOLE_DEFERRED
    # One tie, counted once per distinct reason it carries.
    assert plan.loss_reason_counts() == {REASON_BAND_ABSENT: 1, REASON_BOREHOLE_DEFERRED: 1}


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
