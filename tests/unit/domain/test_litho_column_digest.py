"""#266 — the geotech model must notice when the litho model under it moves.

The failure story, in the debt entry's own words (docs/debt.md #266): *"Drag one
litho contact and every geotech band inside that column is silently describing a
lithology stack that no longer exists. Nothing marks the geotech model stale,
nothing warns, and the UI keeps rendering the old bands as though they were
current."*  The paying-user consequence named on the ballot is a client-facing
export of silently stale packing.

These pins are phrased in the engineer's terms — *the stack a column's bands were
made from* versus *the stack that is under it now* — not in the implementation's.
"""

from __future__ import annotations

from groundmodel.domain.services.litho_column_digest import (
    LithoColumnInterval,
    litho_column_digest,
    next_stamp_map,
    stale_column_ids,
)

CLAY = "11111111-1111-1111-1111-111111111111"
SAND = "22222222-2222-2222-2222-222222222222"
PEAT = "33333333-3333-3333-3333-333333333333"


def _stack_as_banded() -> list[LithoColumnInterval]:
    """The stack on GEO-23/125-S17 at the moment its packing bands were made."""
    return [
        LithoColumnInterval(depth_top_m=0.0, depth_base_m=4.20, formation_id=CLAY),
        LithoColumnInterval(depth_top_m=4.20, depth_base_m=4.56, formation_id=PEAT),
        LithoColumnInterval(depth_top_m=4.56, depth_base_m=12.00, formation_id=SAND),
    ]


# ---------------------------------------------------------------- the digest


def test_lcd1_dragging_one_contact_makes_the_column_read_differently() -> None:
    """The #266 gesture itself: one contact dragged, same column.

    S17's peat was widened from 0.36 m to 1.85 m by two hand contact writes 90
    minutes after its bands were built.  The column must not read the same
    afterwards, or nothing downstream can ever tell.
    """
    before = litho_column_digest(_stack_as_banded())

    widened = [
        LithoColumnInterval(depth_top_m=0.0, depth_base_m=4.20, formation_id=CLAY),
        LithoColumnInterval(depth_top_m=4.20, depth_base_m=6.05, formation_id=PEAT),
        LithoColumnInterval(depth_top_m=6.05, depth_base_m=12.00, formation_id=SAND),
    ]

    assert litho_column_digest(widened) != before


def test_lcd2_an_untouched_column_reads_the_same_every_time() -> None:
    """An edit somewhere else must never light up a column nobody touched.

    A staleness signal that fires on columns the engineer did not edit is the
    alarm-fatigue failure: he learns to ignore it, and the one real warning is
    lost with the noise.
    """
    assert litho_column_digest(_stack_as_banded()) == litho_column_digest(_stack_as_banded())


def test_lcd3_reading_the_same_stack_in_a_different_order_is_not_a_change() -> None:
    """The ground did not move because the rows came back in another order.

    Nothing guarantees the order rows arrive in, and the stack is a fact about
    depths — so the answer is about the stack, never about the read.
    """
    shuffled = list(reversed(_stack_as_banded()))

    assert litho_column_digest(shuffled) == litho_column_digest(_stack_as_banded())


def test_lcd4_relabelling_the_lithology_is_a_change() -> None:
    """Same depths, different soil: the packing subdivision no longer applies.

    NAD packing classes subdivide a lithology.  The bands that subdivided a clay
    unit are not the bands that subdivide a sand unit, even where the boundaries
    happen to sit at the same depths.
    """
    relabelled = [
        LithoColumnInterval(depth_top_m=0.0, depth_base_m=4.20, formation_id=SAND),
        LithoColumnInterval(depth_top_m=4.20, depth_base_m=4.56, formation_id=PEAT),
        LithoColumnInterval(depth_top_m=4.56, depth_base_m=12.00, formation_id=SAND),
    ]

    assert litho_column_digest(relabelled) != litho_column_digest(_stack_as_banded())


def test_lcd5_float_noise_below_a_millimetre_is_not_a_change() -> None:
    """The contiguity trigger rewrites every base; its float slack is not an edit.

    ``litho_layer.depth_base_m`` is DERIVED — the FC→LL trigger rebuilds it as
    ``LEAD(depth_top_m)`` — so a base can come back re-rounded without anyone
    having moved anything.  Sub-millimetre slack must stay quiet; the project
    clamps litho boundaries at 1 mm anyway.
    """
    jittered = [
        LithoColumnInterval(depth_top_m=0.0, depth_base_m=4.2000000004, formation_id=CLAY),
        LithoColumnInterval(depth_top_m=4.1999999996, depth_base_m=4.56, formation_id=PEAT),
        LithoColumnInterval(depth_top_m=4.56, depth_base_m=12.0000000001, formation_id=SAND),
    ]

    assert litho_column_digest(jittered) == litho_column_digest(_stack_as_banded())


def test_lcd6_a_two_millimetre_move_is_a_change() -> None:
    """The entry's own provenance test: a hand edit lands off the sample grid.

    #266 separates segmenter output from a hand edit by exactly this margin —
    machine boundaries sit on CPT sample depths to 0.0000 mm, the boundaries
    that replaced them are off-grid by 2.093 / 1.628 / 4.173 mm.  A signal that
    cannot see a 2 mm move cannot see the edit that caused #266.
    """
    hand_edited = [
        LithoColumnInterval(depth_top_m=0.0, depth_base_m=4.202093, formation_id=CLAY),
        LithoColumnInterval(depth_top_m=4.202093, depth_base_m=4.56, formation_id=PEAT),
        LithoColumnInterval(depth_top_m=4.56, depth_base_m=12.00, formation_id=SAND),
    ]

    assert litho_column_digest(hand_edited) != litho_column_digest(_stack_as_banded())


def test_lcd7_a_column_with_no_litho_at_all_still_answers() -> None:
    """An emptied column is a legal reading, and a different one from any stack.

    Clearing a column's litho does not leave the question unanswerable — it
    answers "there is nothing here", which is precisely what makes bands over it
    stale rather than unknown.
    """
    empty = litho_column_digest([])

    assert isinstance(empty, str)
    assert empty != litho_column_digest(_stack_as_banded())


# ------------------------------------------------------- which columns moved

S17 = "aaaaaaaa-0000-0000-0000-000000000017"
S9 = "aaaaaaaa-0000-0000-0000-000000000009"
B1 = "bbbbbbbb-0000-0000-0000-000000000001"


def test_gls1_a_column_whose_litho_moved_since_its_bands_were_made_is_stale() -> None:
    """This is the whole of #266: say which column the ground moved under."""
    stale = stale_column_ids(
        stamps={S17: "v1:aaaa", S9: "v1:bbbb"},
        current={S17: "v1:MOVED", S9: "v1:bbbb"},
    )

    assert stale == (S17,)


def test_gls2_a_column_whose_litho_did_not_move_is_not_stale() -> None:
    """Nothing moved, so nothing is said — the quiet case has to stay quiet."""
    assert (
        stale_column_ids(
            stamps={S17: "v1:aaaa", S9: "v1:bbbb"},
            current={S17: "v1:aaaa", S9: "v1:bbbb"},
        )
        == ()
    )


def test_gls3_a_column_with_no_record_of_what_it_was_built_from_is_not_stale() -> None:
    """Unknown provenance is not evidence the ground moved.

    Every project banded before this shipped has bands and no record of the
    stack they came from.  Calling those stale would flag the owner's whole
    model on first open and teach him the indicator means nothing — the same
    reason ``classified_with_statistic`` reads NULL as "no build yet" and its
    migration backfilled rather than alarmed.
    """
    assert stale_column_ids(stamps={}, current={S17: "v1:aaaa"}) == ()


def test_gls4_bands_over_ground_that_has_no_litho_left_are_stale() -> None:
    """The litho under the column was cleared; the bands describe nothing.

    This is the strongest form of the entry's "describing a lithology stack that
    no longer exists" — there is no stack at all.
    """
    assert stale_column_ids(stamps={S17: "v1:aaaa"}, current={}) == (S17,)


def test_gls5_the_answer_is_ordered_so_the_engineer_reads_the_same_list_twice() -> None:
    """Two reads in a row must not reshuffle the list under his eyes."""
    stamps = {S9: "v1:x", S17: "v1:x", B1: "v1:x"}
    current = {S9: "v1:moved", S17: "v1:moved", B1: "v1:moved"}

    assert stale_column_ids(stamps=stamps, current=current) == stale_column_ids(
        stamps=stamps, current=current
    )
    assert list(stale_column_ids(stamps=stamps, current=current)) == sorted([S9, S17, B1])


# ------------------------------------------------- re-pressing clears the flag


def test_nsm1_re_pressing_a_column_clears_it_by_construction() -> None:
    """The press that rebuilds the bands records what it built them from.

    There is no clear-endpoint and no acknowledge button: the only way to make
    the warning go away is to do the thing the warning is asking for.
    """
    stamps = {S17: "v1:as-built"}
    after_press = next_stamp_map(
        previous=stamps,
        rebuilt_digests={S17: "v1:moved"},
        banded_column_ids={S17},
    )

    assert stale_column_ids(stamps=after_press, current={S17: "v1:moved"}) == ()


def test_nsm2_re_pressing_one_column_leaves_the_others_saying_what_they_are() -> None:
    """Boreholes and CPTs are banded by two different presses, on two days.

    "Divide boreholes" rebuilds B1 and touches no CPT.  If that press cleared
    S17 too, the engineer would be told his moved CPT column was fine because he
    had re-banded an unrelated borehole — which is #266 wearing a green light.
    """
    after_borehole_press = next_stamp_map(
        previous={S17: "v1:as-built", B1: "v1:as-built"},
        rebuilt_digests={B1: "v1:fresh"},
        banded_column_ids={S17, B1},
    )

    assert stale_column_ids(
        stamps=after_borehole_press,
        current={S17: "v1:moved", B1: "v1:fresh"},
    ) == (S17,)


def test_nsm3_a_column_the_press_skipped_keeps_its_old_provenance() -> None:
    """Hand-edited columns are protected from the press, so they stay stale.

    ``skip_existing`` leaves a hand-touched column's bands exactly as they were.
    Its bands were still made from the old stack, so it must keep saying so —
    the protection is from the rebuild, not from the truth.
    """
    after_press = next_stamp_map(
        previous={S17: "v1:as-built", S9: "v1:as-built"},
        rebuilt_digests={S9: "v1:fresh"},
        banded_column_ids={S17, S9},
    )

    assert after_press[S17] == "v1:as-built"
    assert after_press[S9] == "v1:fresh"


def test_nsm4_a_column_whose_bands_were_cleared_stops_being_counted() -> None:
    """Clearing a column's bands leaves nothing that could be stale.

    A stale count that includes columns with no bands sends the engineer to
    press a verb that has nothing to rebuild.
    """
    after_clear = next_stamp_map(
        previous={S17: "v1:as-built", S9: "v1:as-built"},
        rebuilt_digests={},
        banded_column_ids={S9},
    )

    assert S17 not in after_clear
    assert after_clear == {S9: "v1:as-built"}


def test_nsm5_a_column_banded_before_this_shipped_is_left_unstamped() -> None:
    """A press must not invent provenance for bands it did not rebuild.

    Guessing that an untouched legacy column matches today's litho would clear a
    warning that was never raised — and would be wrong exactly when the ground
    HAS moved, which is the only case that matters.
    """
    after_press = next_stamp_map(
        previous={},
        rebuilt_digests={S9: "v1:fresh"},
        banded_column_ids={S17, S9},
    )

    assert after_press == {S9: "v1:fresh"}
