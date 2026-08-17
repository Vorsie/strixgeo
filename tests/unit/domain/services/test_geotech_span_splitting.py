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

from groundmodel.domain.services.geotech_span_splitting import (
    SpanColumn,
    SpanTie,
    split_span,
)

# His image-61 scene: S6 — B6 — B4 — S13, collars all ~13.1-13.4.
S6 = SpanColumn(
    investigation_id="s6", along_m=0.0, collar_elev_m=13.13,
    contacts_m=(1.52, 8.27, 9.82, 12.42, 13.0, 15.48, 21.5), deepest_base_m=21.5,
)
B6 = SpanColumn(
    investigation_id="b6", along_m=5.0, collar_elev_m=13.17,
    contacts_m=(6.89, 9.5, 12.59, 14.75, 20.0), deepest_base_m=20.0,
)
B4 = SpanColumn(
    investigation_id="b4", along_m=50.0, collar_elev_m=13.13,
    contacts_m=(5.62, 6.0, 12.52, 12.9, 15.5, 17.0), deepest_base_m=17.0,
)
S13 = SpanColumn(
    investigation_id="s13", along_m=90.0, collar_elev_m=13.37,
    contacts_m=(1.42, 8.16, 9.69, 15.16, 23.06), deepest_base_m=23.06,
)
# A shallow CPT: bands stop at 2.7 m.
S7A = SpanColumn(
    investigation_id="s7a", along_m=45.0, collar_elev_m=13.07,
    contacts_m=(1.61, 2.65), deepest_base_m=2.65,
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
    assert split_span(_tie("b4", 15.5, "s13", 15.16), ORDER) is None


def test_sp6_a_span_above_a_columns_first_band_is_subtd_there_too() -> None:
    """Data starts at 6.89 on B6; a line passing at 2 m depth has no band to
    land on — no data AT that depth, so no split at B6."""
    order = [S6, B6, S13]
    plan = split_span(_tie("s6", 1.9, "s13", 2.2), order)
    assert plan is None


def test_sp7_an_endpoint_column_missing_from_the_order_keeps_the_tie() -> None:
    """A tie whose endpoint is not on this section cannot be judged here."""
    other = SpanTie(edge_id=UUID(int=8), inv_a="elsewhere", depth_a_m=5.0,
                    inv_b="s13", depth_b_m=5.0)
    assert split_span(other, ORDER) is None
