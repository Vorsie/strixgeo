"""Crossing ties already in the model are swept out — machine ones only.

Owner ruling, 2026-08-17: *"Ties shouldn't be able to cross, if any crossing
ties are in my test.strix it is because you generated them, not because i drew
them."*  And: *"user made ties should be left alone."*

Both halves were verified before this module was written.  Running today's
derivation read-only on his real CS1 data emits a perfectly monotone S9↔B3
gap — no crossing, no fan — while his database holds two more ties in that gap
(``S9 6.71 -> B3 0.00`` and ``S9 8.10 -> B3 1.00``) that today's code does not
produce.  They are legacy rows from an older derivation, and every press
carries them forward: the re-anchor preserves accepted ties across a band
rebuild, and the crossing guard only gates NEW candidates — it cannot refuse
what is already stored.

So the repair belongs here, on the persisted rows.  All 14 edges behind his four
crossings were ``source='auto'``, which is what makes the sweep safe: a
hand-drawn tie is never a candidate for deletion, however it lies.
"""

from uuid import UUID

from groundmodel.domain.services.geotech_crossing_repair import (
    PersistedTie,
    crossing_ties_to_delete,
)

SECTION = UUID(int=900)
OTHER_SECTION = UUID(int=901)


def _tie(
    n: int,
    first: float,
    second: float,
    *,
    manual: bool = False,
    section: UUID = SECTION,
    gap: tuple[str, str] = ("B3", "S9"),
) -> PersistedTie:
    """One stored tie, reduced to the depths it joins in its gap."""
    return PersistedTie(
        edge_id=UUID(int=n),
        section_id=section,
        gap=gap,
        depth_first_m=first,
        depth_second_m=second,
        source="manual" if manual else "auto",
    )


def _ids(ties: list[PersistedTie]) -> list[int]:
    return [e.int for e in crossing_ties_to_delete(ties)]


def test_cr1_his_s9_b3_gap_loses_its_crossing_pair() -> None:
    """His seven stored ties in that gap, verbatim, S9 depth first.

    Only ``6.71 -> 6.50`` and ``8.10 -> 1.00`` invert against each other (above
    on S9, below on B3), and both are legacy: today's derivation emits neither,
    so both go (see CR8 — a machine-only crossing pair has no honest survivor).
    Everything else is monotone or fans, and must survive — including the four
    ties the current derivation still produces.

    The two fans (``1.21``/``6.71`` both reaching B3's 0.00) are deliberately
    kept.  A fan is not a crossing, and on a single-band column it is how a
    wedge pinching out is stated.
    """
    stored = [
        _tie(1, 1.21, 0.00),
        _tie(2, 6.71, 0.00),
        _tie(3, 6.71, 6.50),
        _tie(4, 8.10, 1.00),
        _tie(5, 8.10, 9.00),
        _tie(6, 9.14, 10.09),
        _tie(7, 9.68, 10.63),
    ]
    assert _ids(stored) == [3, 4]


def test_cr2_a_clean_gap_is_untouched() -> None:
    """The ordinary case must delete nothing at all."""
    assert _ids([_tie(1, 0.00, 1.21), _tie(2, 9.00, 8.10), _tie(3, 10.09, 9.14)]) == []


def test_cr3_a_hand_drawn_tie_is_never_deleted() -> None:
    """*"user made ties should be left alone"* — the machine tie yields instead.

    His steep lines are deliberate: *"if the users draws a steep tie, he has a
    reason for it"*.
    """
    assert _ids([_tie(1, 5.0, 12.0, manual=True), _tie(2, 9.0, 8.0)]) == [2]


def test_cr4_two_hand_drawn_ties_that_cross_are_both_kept() -> None:
    """Nothing here may touch his work, even when his own two lines cross.

    He rules that case at the gesture instead: a crossing tie he tries to DRAW
    is rejected with a toast.  A sweep that silently deleted one of two stored
    hand-drawn ties would be exactly the behaviour he forbade.
    """
    assert _ids([_tie(1, 5.0, 12.0, manual=True), _tie(2, 9.0, 8.0, manual=True)]) == []


def test_cr5_the_worst_offender_goes_first() -> None:
    """One tie crossing three others is the defect, not three defects.

    Deleting the three that each cross only the outlier would strip the gap of
    its real correlations and keep the wrong one.
    """
    outlier = _tie(99, 20.0, 1.0)
    stack = [_tie(1, 1.0, 2.0), _tie(2, 5.0, 6.0), _tie(3, 9.0, 10.0)]
    assert _ids(stack + [outlier]) == [99]


def test_cr6_gaps_and_sections_are_judged_separately() -> None:
    """A tie can only cross one in the same gap on the same section.

    Correlations are section-scoped, so the same two bands may legitimately be
    tied on two sections, and depths in different gaps are unrelated.
    """
    ties = [
        _tie(1, 5.0, 12.0),
        _tie(2, 9.0, 8.0, section=OTHER_SECTION),
        _tie(3, 9.0, 8.0, gap=("B4", "S6")),
    ]
    assert _ids(ties) == []


def test_cr7_a_fan_is_kept() -> None:
    """Two ties leaving one contact are how a wedge pinching out is stated.

    Refusing fans outright would delete that; his ruling names crossings.
    """
    assert _ids([_tie(1, 0.0, 0.0), _tie(2, 0.0, 5.0)]) == []


def test_cr8_a_machine_only_crossing_pair_goes_entirely() -> None:
    """Two machine ties crossing only each other: both go, no coin-toss.

    Measured on his model, this is the whole of the damage — one pair in the
    S9↔B3 gap.  Ranking them by id kept ``8.10 -> 1.00``, a 7 m jump upward, and
    deleted ``6.71 -> 6.50``, which is nearly horizontal and looks right.  The
    machine cannot tell which of its own two claims is the good one, and a
    crossing pair is by definition not the *"obvious match"* his ruling allows.

    Deleting a machine tie is also cheap and self-healing: step 2 re-derives
    additively, so a claim the derivation still believes comes straight back,
    and one it does not was junk.  Neither of his two returns — verified by
    replaying today's derivation on that gap.
    """
    assert sorted(_ids([_tie(1, 5.0, 12.0), _tie(2, 9.0, 8.0)])) == [1, 2]


def test_cr9_a_pair_with_one_hand_drawn_member_loses_only_the_machine_one() -> None:
    """His line is not a coin-toss candidate — it stands and the machine yields."""
    assert _ids([_tie(1, 5.0, 12.0, manual=True), _tie(2, 9.0, 8.0)]) == [2]


def test_cr10_a_larger_tangle_still_removes_one_at_a_time() -> None:
    """Only an isolated PAIR is dropped wholesale; a chain must not cascade.

    Three mutually crossing ties would otherwise strip the gap bare.  The greedy
    pass removes the worst offender, then re-judges what is left.
    """
    out = _ids([_tie(1, 1.0, 9.0), _tie(2, 5.0, 5.0), _tie(3, 9.0, 1.0)])
    assert len(out) < 3
