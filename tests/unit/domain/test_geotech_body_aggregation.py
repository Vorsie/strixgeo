"""Tests for the pure policy-B body-subdivision aggregator (spec §0.1)."""

from groundmodel.domain.services.geotech_body_aggregation import (
    BandProfile,
    plan_body_subdivision,
)
from groundmodel.domain.services.geotech_subdivision import GeotechSplit


def _profile(inv: str, *bands: tuple[float, float, int]) -> BandProfile:
    """Build a BandProfile from a varargs list of (top, base, class) tuples."""
    return BandProfile(
        investigation_id=inv,
        splits=[GeotechSplit(top, base, cls) for top, base, cls in bands],
    )


def test_single_cpt_profile_is_the_split():
    """A single CPT profile is always consistent; its band sequence is the plan."""
    prof = _profile("c1", (0.0, 5.0, 6), (5.0, 10.0, 8))
    plan = plan_body_subdivision([prof])
    assert plan.consistent is True
    assert plan.band_classes == [6, 8]


def test_zero_cpt_group_is_carry_through_unclassified():
    """A group with no CPT members returns consistent=True and one None class."""
    plan = plan_body_subdivision([])
    assert plan.consistent is True
    assert plan.band_classes == [None]  # one carry-through unit, class unset


def test_two_cpts_same_sequence_split_with_dominant_class():
    """Two CPTs sharing the same class sequence are consistent; per-band dominant class wins."""
    a = _profile("a", (0.0, 4.0, 6), (4.0, 10.0, 8))
    b = _profile("b", (0.0, 6.0, 6), (6.0, 10.0, 8))
    plan = plan_body_subdivision([a, b])
    assert plan.consistent is True
    assert plan.band_classes == [6, 8]


def test_too_shallow_cpt_prefix_matches_longer_sequence():
    """A CPT that bottoms out early prefix-matches the longer sequence: still consistent."""
    # CPT b bottoms out after one band (6) -> prefix of a's [6, 8]: still consistent.
    a = _profile("a", (0.0, 4.0, 6), (4.0, 10.0, 8))
    b = _profile("b", (0.0, 3.0, 6))
    plan = plan_body_subdivision([a, b])
    assert plan.consistent is True
    assert plan.band_classes == [6, 8]


def test_lateral_only_variation_falls_to_one_representative_class():
    """Reversed band sequences are not consistent; one representative class is returned."""
    # a reads 6/8, b reads 8/6 (reversed) -> no shared sequence -> one class.
    a = _profile("a", (0.0, 5.0, 6), (5.0, 10.0, 8))
    b = _profile("b", (0.0, 5.0, 8), (5.0, 10.0, 6))
    plan = plan_body_subdivision([a, b])
    assert plan.consistent is False
    assert len(plan.band_classes) == 1
    assert plan.band_classes[0] in (6, 8)


def test_representative_class_tie_breaks_to_denser():
    """Equal-thickness tie between two classes resolves to the denser (higher) class."""
    a = _profile("a", (0.0, 5.0, 6))
    b = _profile("b", (0.0, 5.0, 8))
    # two single-band CPTs disagree on class -> not consistent -> one class;
    # equal 5 m thickness of class 6 and 8 -> tie -> the denser class (8) wins.
    plan = plan_body_subdivision([a, b])
    assert plan.consistent is False
    assert plan.band_classes == [8]


def test_band_appears_midsequence_is_not_consistent():
    """An extra mid-sequence band makes sequences incomparable: not consistent."""
    # a = [6, 8], b = [6, 7, 8]: neither is a prefix of the other -> not consistent.
    a = _profile("a", (0.0, 5.0, 6), (5.0, 10.0, 8))
    b = _profile("b", (0.0, 3.0, 6), (3.0, 6.0, 7), (6.0, 10.0, 8))
    plan = plan_body_subdivision([a, b])
    assert plan.consistent is False
    assert len(plan.band_classes) == 1


def test_equal_thickness_tie_between_needs_review_and_a_class_keeps_needs_review():
    """A band the qc could not classify beats an equally thick classified band.

    ``suggest_geotech_subdivision`` answers ``nad_class=None`` when it has no
    usable qc over a band's interval — "needs review", never a guessed class.
    When such a band is exactly as thick as a classified one, the aggregator
    must NOT resolve the tie in favour of the plausible class: half the body
    has no evidence, and asserting a packing class for the whole of it hides
    that from the engineer. Needs-review propagates; the engineer decides.
    """
    a = _profile("a", (0.0, 5.0, 8))
    b = BandProfile(investigation_id="b", splits=[GeotechSplit(0.0, 5.0, None)])
    plan = plan_body_subdivision([a, b])
    assert plan.consistent is False
    assert plan.band_classes == [None]


def test_a_thinner_unclassified_band_does_not_veto_the_classified_majority():
    """Needs-review wins ties, not the whole vote: thickness still decides.

    A thin sliver with no qc coverage beside a much thicker classified band is
    the ordinary geometry the None case was widened to cover (a contact above
    the CPT's first sample). The body's class is the one most of it reads.
    """
    a = _profile("a", (0.0, 5.0, 8))
    b = BandProfile(investigation_id="b", splits=[GeotechSplit(0.0, 0.2, None)])
    plan = plan_body_subdivision([a, b])
    assert plan.consistent is False
    assert plan.band_classes == [8]


def test_a_mixed_none_and_int_pool_does_not_raise():
    """Sorting a pool holding both ``None`` and an int must not blow up.

    ``sorted(..., key=lambda kv: (kv[1], kv[0]))`` over a ``dict[int | None, float]``
    raises ``TypeError: '<' not supported between NoneType and int`` the moment
    two entries tie on thickness. The aggregator has to order ``None``
    deliberately instead of leaving it to tuple comparison.
    """
    a = _profile("a", (0.0, 5.0, 8), (5.0, 10.0, 12))
    b = BandProfile(
        investigation_id="b",
        splits=[GeotechSplit(0.0, 5.0, None), GeotechSplit(5.0, 10.0, 12)],
    )
    plan = plan_body_subdivision([a, b])
    # [8, 12] and [None, 12] share no prefix, so the group is not consistent and
    # falls to one representative class over the whole pool: 10 m of class 12
    # against 5 m of class 8 and 5 m unclassified. No tie at the top, so class
    # 12 wins outright — the point of the case is that mixing None and int in
    # one pool is now orderable at all.
    assert plan.consistent is False
    assert plan.band_classes == [12]
