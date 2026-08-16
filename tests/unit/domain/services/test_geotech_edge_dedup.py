"""One packing correlation per pair of surfaces.

Owner, 2026-08-16: *"always have to manually delete those ties"*, pointing at
two flagged correlations either side of B4.

His model held 177 geotech edges over 162 distinct pairs.  A divide does two
things to the same correlation: the re-anchor CARRIES it across the rebuild,
and the derivation RE-EMITS it from the litho model.  They are written with
the columns in opposite order, so neither recognises the other, and the
engineer is left with a flagged copy sitting on top of an identical clean
one — which is the copy he kept deleting by hand, every press.

The carried copy is the flagged one: it was matched onto a band whose class
had changed, which is honest at the moment it is raised.  The re-emitted copy
is derived fresh from his litho correlation and needs no review at all.  So
when both exist, the clean one is the survivor.
"""

from uuid import UUID

from groundmodel.domain.services.geotech_edge_dedup import (
    GeotechEdgeRow,
    duplicate_edge_ids_to_drop,
)

SECTION = UUID(int=1)
OTHER_SECTION = UUID(int=2)
BAND_A = UUID(int=10)
BAND_B = UUID(int=11)


def _row(
    edge_id: int,
    *,
    layer_a: UUID = BAND_A,
    layer_b: UUID = BAND_B,
    side_a: str = "top",
    side_b: str = "top",
    section: UUID = SECTION,
    source: str = "auto",
    review_reason: str | None = None,
) -> GeotechEdgeRow:
    """One stored packing correlation."""
    return GeotechEdgeRow(
        edge_id=UUID(int=edge_id),
        section_id=section,
        layer_a_id=layer_a,
        layer_b_id=layer_b,
        layer_a_side=side_a,
        layer_b_side=side_b,
        source=source,
        review_reason=review_reason,
    )


def test_ed1_the_reversed_rewrite_of_a_pair_is_a_duplicate() -> None:
    """His scene: a flagged carried copy and a clean re-derived one.

    The columns are stored in opposite order, which is why the writers never
    saw each other. The clean copy survives; the flagged one goes.
    """
    carried = _row(1, review_reason="class_changed")
    derived = _row(2, layer_a=BAND_B, layer_b=BAND_A)
    assert duplicate_edge_ids_to_drop([carried, derived]) == [UUID(int=1)]


def test_ed2_a_hand_drawn_tie_outranks_a_machine_one() -> None:
    """Provenance first: 'manual' must still read manual after a divide."""
    machine = _row(1)
    hand = _row(2, layer_a=BAND_B, layer_b=BAND_A, source="manual")
    assert duplicate_edge_ids_to_drop([machine, hand]) == [UUID(int=1)]


def test_ed3_a_flagged_hand_tie_still_beats_a_clean_machine_one() -> None:
    """His flag is a question to him, not a reason to discard his line."""
    machine = _row(1)
    hand = _row(2, source="manual", review_reason="class_changed")
    assert duplicate_edge_ids_to_drop([machine, hand]) == [UUID(int=1)]


def test_ed4_the_two_sides_of_a_band_are_different_ties() -> None:
    """A top-to-top tie and a base-to-base tie say different things."""
    top = _row(1, side_a="top", side_b="top")
    base = _row(2, side_a="base", side_b="base")
    assert duplicate_edge_ids_to_drop([top, base]) == []


def test_ed5_the_same_pair_on_another_section_is_its_own_tie() -> None:
    """Correlations are section-scoped; the same bands may be tied on each."""
    here = _row(1)
    there = _row(2, section=OTHER_SECTION)
    assert duplicate_edge_ids_to_drop([here, there]) == []


def test_ed6_nothing_duplicated_drops_nothing() -> None:
    """The ordinary model is left completely alone."""
    assert duplicate_edge_ids_to_drop([_row(1), _row(2, layer_b=UUID(int=12))]) == []


def test_ed7_an_exact_stalemate_is_resolved_deterministically() -> None:
    """Two indistinguishable copies must not make the divide non-repeatable."""
    assert duplicate_edge_ids_to_drop([_row(5), _row(3), _row(9)]) == [
        UUID(int=5),
        UUID(int=9),
    ]
