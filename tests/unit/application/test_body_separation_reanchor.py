"""Unit tests for the body-separation re-anchor rule (debt #278 R5).

A separation (the "Separate" verb) anchors two geotech bands by their row ids.
``SubdivideAllBodies`` / ``DivideBoreholes`` throw every geotech band away and
rebuild it with a fresh id, and the anchor FKs are ``ON DELETE CASCADE`` — so
without a carry the engineer's "these are NOT the same body" ruling vanishes on
the next re-subdivide, exactly as accepted ties did.

The carry mirrors the tie re-anchor precedent. A band that comes back at the same
interval is the same band (tier 1). Failing that, a separation follows its band
when EXACTLY ONE rebuilt band of the same class overlaps where the old one was
(tier 2). Anything else — nothing overlapping, or an ambiguous set of candidates
— is uncarryable and reported LOST, never silently re-pointed onto the wrong
mass.

These tests exercise the pure planner only (no DB). They speak the rule's
vocabulary: "the band came back exactly as it was", "the boundary moved and the
separation moved with it", "the band is gone, so the ruling cannot be carried".
"""

from __future__ import annotations

from uuid import UUID

from groundmodel.application.body_separation_reanchor import (
    CapturedSeparation,
    plan_separation_reanchor,
)
from groundmodel.application.geotech_tie_reanchor import (
    BandIdentity,
    RebuiltBand,
    depth_to_mm,
)

_SEP = UUID("33333333-3333-3333-3333-333333333333")
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


def _sep(identity_a: BandIdentity, identity_b: BandIdentity) -> CapturedSeparation:
    """Build a captured separation between two band identities."""
    return CapturedSeparation(
        separation_id=_SEP,
        identity_a=identity_a,
        identity_b=identity_b,
        anchor_kind_a="cpt",
        anchor_kind_b="cpt",
    )


def _band(identity: BandIdentity, layer_id: str) -> RebuiltBand:
    """Build a rebuilt band with a chosen new layer id."""
    return RebuiltBand(identity=identity, layer_id=UUID(layer_id))


def test_bands_that_come_back_identical_re_anchor_the_separation() -> None:
    """Both anchors came back at the same interval → the separation is carried.

    A re-subdivide that reproduces the same bands re-points the separation onto
    the fresh row ids, so "these are NOT the same body" survives untouched.
    """
    id_a = _identity(_INV_A, 1.0, 3.0, 6)
    id_b = _identity(_INV_B, 1.0, 3.0, 6)
    captured = [_sep(id_a, id_b)]
    bands = [
        _band(id_a, "00000000-0000-0000-0000-0000000000a1"),
        _band(id_b, "00000000-0000-0000-0000-0000000000b1"),
    ]
    plan = plan_separation_reanchor(captured, bands)
    assert len(plan.matched) == 1
    assert not plan.lost
    match = plan.matched[0]
    assert {match.layer_a_id, match.layer_b_id} == {
        UUID("00000000-0000-0000-0000-0000000000a1"),
        UUID("00000000-0000-0000-0000-0000000000b1"),
    }
    # Canonical order on the re-created row.
    assert match.layer_a_id < match.layer_b_id


def test_a_moved_boundary_carries_the_separation_with_its_band() -> None:
    """One same-class band overlaps where an anchor was → follow it (tier 2).

    The engineer dragged a contact, so the band came back with a moved boundary
    rather than at the exact old interval. Exactly one same-class band overlaps
    the old place, so the separation moves onto it.
    """
    id_a = _identity(_INV_A, 1.0, 3.0, 6)
    id_b = _identity(_INV_B, 1.0, 3.0, 6)
    captured = [_sep(id_a, id_b)]
    bands = [
        _band(id_a, "00000000-0000-0000-0000-0000000000a1"),
        # B's boundary moved 4 cm; same class, still overlaps the old interval.
        _band(_identity(_INV_B, 1.04, 3.0, 6), "00000000-0000-0000-0000-0000000000b2"),
    ]
    plan = plan_separation_reanchor(captured, bands)
    assert len(plan.matched) == 1
    assert not plan.lost
    assert UUID("00000000-0000-0000-0000-0000000000b2") in {
        plan.matched[0].layer_a_id,
        plan.matched[0].layer_b_id,
    }


def test_an_anchor_whose_band_is_gone_makes_the_separation_lost() -> None:
    """No band overlaps an anchor → the separation is LOST, not re-pointed.

    The rebuild no longer draws a band where one anchor was, so the ruling
    cannot be carried onto anything honestly. It is reported lost (a WARNING at
    the caller), never attached to the wrong mass.
    """
    id_a = _identity(_INV_A, 1.0, 3.0, 6)
    id_b = _identity(_INV_B, 1.0, 3.0, 6)
    captured = [_sep(id_a, id_b)]
    # Only A comes back; B's column produced nothing overlapping.
    bands = [_band(id_a, "00000000-0000-0000-0000-0000000000a1")]
    plan = plan_separation_reanchor(captured, bands)
    assert not plan.matched
    assert len(plan.lost) == 1
    assert plan.lost[0].matched_a is True
    assert plan.lost[0].matched_b is False


def test_an_ambiguous_overlap_is_uncarryable() -> None:
    """Two same-class bands overlap an anchor → uncarryable (dropped).

    Which of two candidate bands inherited the separation is unknowable, and a
    separation carries no review flag to defer the question to the engineer.
    The conservative answer is to drop it (reported lost) rather than risk
    suppressing the wrong body-join.
    """
    id_a = _identity(_INV_A, 1.0, 3.0, 6)
    id_b = _identity(_INV_B, 1.0, 5.0, 6)
    captured = [_sep(id_a, id_b)]
    bands = [
        _band(id_a, "00000000-0000-0000-0000-0000000000a1"),
        # Two same-class bands both overlap B's old 1.0-5.0 interval.
        _band(_identity(_INV_B, 1.0, 3.0, 6), "00000000-0000-0000-0000-0000000000b2"),
        _band(_identity(_INV_B, 3.0, 5.0, 6), "00000000-0000-0000-0000-0000000000b3"),
    ]
    plan = plan_separation_reanchor(captured, bands)
    assert not plan.matched
    assert len(plan.lost) == 1
    assert plan.lost[0].matched_b is False


def test_both_anchors_fusing_into_one_band_is_uncarryable() -> None:
    """Both anchors resolve to the SAME rebuilt band → cannot separate it.

    If the two separated masses merged into one band on re-subdivide, the ruling
    is moot — a body cannot be separated from itself — so it is reported lost.
    """
    id_a = _identity(_INV_A, 1.0, 2.0, 6)
    id_b = _identity(_INV_A, 2.0, 3.0, 6)
    captured = [_sep(id_a, id_b)]
    # Both old intervals now overlap a single merged band on INV_A.
    bands = [_band(_identity(_INV_A, 1.0, 3.0, 6), "00000000-0000-0000-0000-0000000000a9")]
    plan = plan_separation_reanchor(captured, bands)
    assert not plan.matched
    assert len(plan.lost) == 1
