"""An accepted tie spanning a data-bearing column splits into the chain.

Owner, 2026-08-17 night (step-4 dogfeed): *"The ties i manually made spanning
both boreholes aren't replaced by hops but never deleted. You can delete user
correlations spanning 2 boreholes. If the borehole has data, otherwise it is a
subTD tie."*

The rule, operationalised: a tie is a straight line in (along, elevation)
section space.  At every intermediate column it crosses, interpolate its
elevation; where the column carries geotech bands AT that depth, the span
SPLITS — the line lands on the column's nearest packing contact and continues
— and the original span is deleted.  Where the column's data stops above the
line (a shallow CPT, an undivided stretch), no split happens there: the tie is
sub-TD relative to that column and the segment keeps spanning it.

This is what kills three of his findings at once: the un-superseded manual
spans (they now become the chain), the impossible crossings (the stale spans
that crossed the new chains die by becoming chains themselves), and the
missing quad (the surviving sub-TD segment is a tie the fill can band).
"""

from uuid import UUID

import pytest

from groundmodel.domain.services.geotech_span_splitting import (
    SpanColumn,
    SpanTie,
    crossings_through_banded_range,
    split_span,
)

# His image-61 scene: S6 — B6 — B4 — S13, collars all ~13.1-13.4.
S6 = SpanColumn(
    investigation_id="s6",
    along_m=0.0,
    collar_elev_m=13.13,
    contacts_m=(1.52, 8.27, 9.82, 12.42, 13.0, 15.48, 21.5),
    deepest_base_m=21.5,
)
B6 = SpanColumn(
    investigation_id="b6",
    along_m=5.0,
    collar_elev_m=13.17,
    contacts_m=(6.89, 9.5, 12.59, 14.75, 20.0),
    deepest_base_m=20.0,
)
B4 = SpanColumn(
    investigation_id="b4",
    along_m=50.0,
    collar_elev_m=13.13,
    contacts_m=(5.62, 6.0, 12.52, 12.9, 15.5, 17.0),
    deepest_base_m=17.0,
)
S13 = SpanColumn(
    investigation_id="s13",
    along_m=90.0,
    collar_elev_m=13.37,
    contacts_m=(1.42, 8.16, 9.69, 15.16, 23.06),
    deepest_base_m=23.06,
)
# A shallow CPT: bands stop at 2.7 m.
S7A = SpanColumn(
    investigation_id="s7a",
    along_m=45.0,
    collar_elev_m=13.07,
    contacts_m=(1.61, 2.65),
    deepest_base_m=2.65,
)
ORDER = [S6, B6, B4, S13]


def _tie(inv_a: str, d_a: float, inv_b: str, d_b: float) -> SpanTie:
    return SpanTie(edge_id=UUID(int=7), inv_a=inv_a, depth_a_m=d_a, inv_b=inv_b, depth_b_m=d_b)


def test_sp1_his_manual_span_splits_at_both_boreholes() -> None:
    """S13 13.56 ↔ S6 11.68 (image 61): both B6 and B4 have data there."""
    plan = split_span(_tie("s6", 11.68, "s13", 13.56), ORDER)
    assert plan is not None
    nodes = [(node.investigation_id, node.depth_m) for node in plan]
    assert nodes[0] == ("s6", 11.68)
    assert nodes[-1] == ("s13", 13.56)
    assert [n[0] for n in nodes] == ["s6", "b6", "b4", "s13"]
    # Each landing is one of the column's real contacts.
    assert nodes[1][1] in B6.contacts_m
    assert nodes[2][1] in B4.contacts_m


def test_sp2_the_landing_is_the_nearest_contact_to_the_line() -> None:
    """The line S6 11.68 → S13 13.56 passes B6 (along 5) at elev ~1.55 →
    depth ~11.6 on B6 — nearest contact 12.59, not 9.5 or 14.75."""
    plan = split_span(_tie("s6", 11.68, "s13", 13.56), ORDER)
    assert plan is not None
    assert plan[1].depth_m == 12.59


def test_sp3_a_shallow_column_does_not_split_the_span() -> None:
    """Sub-TD: the line passes far below S7A's 2.65 m of data — the segment
    keeps spanning it (*"otherwise it is a subTD tie"*)."""
    order = [S6, S7A, S13]
    plan = split_span(_tie("s6", 11.68, "s13", 13.56), order)
    assert plan is None


def test_sp4_mixed_depth_splits_only_where_the_data_reaches() -> None:
    """B4 has data at the line; S7A does not → split at B4 alone."""
    order = [S6, S7A, B4, S13]
    plan = split_span(_tie("s6", 11.68, "s13", 13.56), order)
    assert plan is not None
    assert [node.investigation_id for node in plan] == ["s6", "b4", "s13"]


def test_sp5_an_adjacent_tie_is_left_alone() -> None:
    """No intermediate column, nothing to split."""
    assert split_span(_tie("b4", 15.5, "s13", 15.16), ORDER) is None


def test_sp6_a_span_above_a_columns_first_band_is_subtd_there_too() -> None:
    """Data starts at 6.89 on B6; a line passing at 2 m depth has no band to
    land on — no data AT that depth, so no split at B6."""
    order = [S6, B6, S13]
    plan = split_span(_tie("s6", 1.9, "s13", 2.2), order)
    assert plan is None


def test_sp8_a_line_through_a_bands_interior_does_not_split_there() -> None:
    """His S6↔S10 VD ties cross B2's thick homogeneous sand mid-band — the
    nearest contact is metres away (measured: 3.28 m and 1.22 m).  Landing
    there would bend his statement onto a boundary that is NOT the boundary he
    tied, and his two parallel VD ties would collapse onto one contact — the
    quad he wants would die harder.  A column whose nearest contact is beyond
    ``SPAN_LANDING_TOLERANCE_M`` does not express the boundary: the span keeps
    spanning it, exactly like sub-TD."""
    b2 = SpanColumn(
        investigation_id="b2",
        along_m=45.0,
        collar_elev_m=13.05,
        contacts_m=(8.8, 11.23, 17.5),
        deepest_base_m=17.5,
    )
    order = [S6, b2, S13]
    # Line at ~14.2 on B2 — nearest contact 17.5, 3.3 m off.
    assert split_span(_tie("s6", 14.02, "s13", 14.09), order) is None


def test_sp7_an_endpoint_column_missing_from_the_order_keeps_the_tie() -> None:
    """A tie whose endpoint is not on this section cannot be judged here."""
    other = SpanTie(
        edge_id=UUID(int=8), inv_a="elsewhere", depth_a_m=5.0, inv_b="s13", depth_b_m=5.0
    )
    assert split_span(other, ORDER) is None


# --- landing seam must match the span's soils (owner dogfeed 2026-08-18) -----
#
# His 14:25 deletions: a sand span at elev ~-1.7 crossed B6 and landed on the
# ZAND8|KLEI22 seam (0.11 m off) instead of the VD top (0.52 m off), because
# the splitter took the nearest contact by depth with no soil check.  The
# machine wrote SAND↔CLAY hops he then had to prune by hand.

_ZZ = ("ZAND", "ZAND")


def _b6_with_soils() -> SpanColumn:
    """B6's sand/clay transition: ZAND7|ZAND8 at 14.35, ZAND8|KLEI22 at 14.75."""
    return SpanColumn(
        investigation_id="b6",
        along_m=5.0,
        collar_elev_m=13.17,
        contacts_m=(9.5, 14.35, 14.75, 20.0),
        deepest_base_m=20.0,
        contact_soils=(
            ("KLEI", "ZAND"),
            ("ZAND", "ZAND"),
            ("ZAND", "KLEI"),
            ("KLEI", None),
        ),
    )


def _sand_tie(d_a: float, d_b: float) -> SpanTie:
    return SpanTie(
        edge_id=UUID(int=9),
        inv_a="s6",
        depth_a_m=d_a,
        inv_b="s13",
        depth_b_m=d_b,
        soils_a=_ZZ,
        soils_b=_ZZ,
    )


def test_sp9_the_landing_seam_must_carry_the_spans_soils() -> None:
    """SP9: a sand↔sand span may not land on a sand-over-clay seam. The line
    passes B6 at ~14.77; the nearest contact (14.75, ZAND8|KLEI22) is the
    wrong seam and the nearest COMPATIBLE one (14.35, ZAND7|ZAND8) is taken —
    exactly the tie the engineer kept when he pruned the clay hop."""
    plan = split_span(_sand_tie(14.86, 14.66), [S6, _b6_with_soils(), S13])
    assert plan is not None
    assert plan[1].depth_m == 14.35


def test_sp10_no_compatible_seam_within_reach_keeps_the_span() -> None:
    """SP10: when every contact near the line is the wrong soil pair, the
    column does not express this boundary — the span keeps spanning it, the
    same answer as mid-band."""
    b6 = SpanColumn(
        investigation_id="b6",
        along_m=5.0,
        collar_elev_m=13.17,
        contacts_m=(9.5, 14.75, 20.0),
        deepest_base_m=20.0,
        contact_soils=(("KLEI", "ZAND"), ("ZAND", "KLEI"), ("KLEI", None)),
    )
    assert split_span(_sand_tie(14.86, 14.66), [S6, b6, S13]) is None


def test_sp11_a_span_without_soils_falls_back_to_nearest() -> None:
    """SP11: endpoint soils unknown → no constraint; the old nearest-contact
    rule stands (and the loader is expected to always supply soils)."""
    plan = split_span(_tie("s6", 14.86, "s13", 14.66), [S6, _b6_with_soils(), S13])
    assert plan is not None
    assert plan[1].depth_m == 14.75


# --- what still crosses a borehole after the split (owner ruling 2026-08-24) --
#
# *"i also had to manually deleted a correlation spanning a borehole from cpt to
# cpt over borehole, write a check that checks if all those are gone after
# divide boreholes"* and *"if no hops can be made, you just auto delete the
# crossing correlation, user will notice something weird in the fill if he/she
# needs to subdivide"*.
#
# The split is the first answer: where hops CAN be made, the span becomes the
# chain.  These cases are the second: what the split leaves standing, still
# passing through a borehole's own banded range, is a crossing — and a crossing
# is deleted, not kept.  Sub-TD stays untouched, which is the rule the earlier
# ruling bought and this one must not spend.


def test_xt1_a_span_from_cpt_to_cpt_over_a_borehole_that_cannot_land_is_a_crossing() -> None:
    """XT1: the span crosses the borehole mid-band — no hop can be made there,
    so the tie is reported as crossing it (and the caller deletes it)."""
    b2 = SpanColumn(
        investigation_id="b2",
        along_m=45.0,
        collar_elev_m=13.05,
        contacts_m=(8.8, 11.23, 17.5),
        deepest_base_m=17.5,
    )
    tie = _tie("s6", 14.02, "s13", 14.09)
    # Same tie, same scene as SP8: the splitter can make no hop here.
    assert split_span(tie, [S6, b2, S13]) is None
    crossings = crossings_through_banded_range(tie, [S6, b2, S13], crossable_ids={"b2"})
    assert [c.investigation_id for c in crossings] == ["b2"]
    # The line passes b2 at elevation ≈ -0.81, inside its banded extent
    # (+4.25 down to -4.45).
    assert crossings[0].crossing_elev_m == pytest.approx(-0.805, abs=0.01)


def test_xt2_a_span_passing_below_the_boreholes_data_is_not_a_crossing() -> None:
    """XT2: sub-TD — the borehole's bands end above the crossing elevation, so
    the span is the only way the statement can be made and it stands."""
    tie = _tie("s6", 11.68, "s13", 13.56)
    assert crossings_through_banded_range(tie, [S6, S7A, S13], crossable_ids={"s7a"}) == []


def test_xt3_a_span_that_can_hop_becomes_the_chain_and_never_reaches_the_delete() -> None:
    """XT3: where hops CAN be made the span is replaced by chain pieces — the
    delete pass only ever judges what the split left standing."""
    tie = _tie("s6", 11.68, "s13", 13.56)
    plan = split_span(tie, ORDER)
    assert plan is not None
    assert [node.investigation_id for node in plan] == ["s6", "b6", "b4", "s13"]


def test_xt4_a_cpt_to_cpt_tie_over_no_borehole_is_not_a_crossing() -> None:
    """XT4: nothing crossable lies between the two CPTs — the tie is left alone."""
    tie = _tie("b4", 15.5, "s13", 15.16)
    assert crossings_through_banded_range(tie, ORDER, crossable_ids={"b6", "b4"}) == []


def test_xt5_a_borehole_outside_the_runs_scope_is_not_a_crossing() -> None:
    """XT5: this press divided other columns; a borehole it did not touch is
    not this run's business."""
    tie = _tie("s6", 11.68, "s13", 13.56)
    assert crossings_through_banded_range(tie, ORDER, crossable_ids=set()) == []


def test_xt6_a_tie_that_ends_on_the_borehole_does_not_cross_it() -> None:
    """XT6: a tie ANCHORED on a borehole states something about it; only a tie
    passing OVER one crosses it."""
    tie = _tie("b6", 12.59, "s13", 13.56)
    crossings = crossings_through_banded_range(tie, ORDER, crossable_ids={"b6", "b4"})
    assert [c.investigation_id for c in crossings] == ["b4"]
