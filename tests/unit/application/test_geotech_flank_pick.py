"""The flank interval a borehole unit borrows its packing from.

Owner, 2026-08-16, looking at S6 | B6 | B4 on Cross-section 1: *"where the
fuck is the dense medium dense sand coming from above the silt lens on the
boreholes? I see md dens on top of dense on the left and md dense on the
right"* — very dense was on neither flank at that depth, because the band was
copied from the flank's sand BELOW the lens.

The scene, from his model.  One sand body with an enclosed silt lens, so the
body owns TWO intervals on every column::

    GEO-10/170-S6   ZAND 10.26-12.42    <- above the lens
    GEO-10/170-S6   SILT 12.42-13.00    <- the lens
    GEO-10/170-S6   ZAND 13.00-15.48    <- below the lens

A borehole unit must borrow from the flank interval on ITS OWN side of the
lens.  Matching is by elevation overlap, not by position in a list: the two
columns may carry a different number of intervals, and only elevation says
which interval is the same sheet of sand.
"""

from groundmodel.application.divide_boreholes import flank_pick_for_unit
from groundmodel.domain.services.litho_body_pick import BodyLayerPick

SURFACE_M = 10.0
BODY = "sand-body"


def _pick(top_depth: float, base_depth: float, inv: str = "S6") -> BodyLayerPick:
    """One interval of the sand body on one column."""
    return BodyLayerPick(
        investigation_id=inv,
        x_m=0.0,
        y_m=0.0,
        surface_elev_m=SURFACE_M,
        body_id=BODY,
        formation_id="zand",
        top_depth_m=top_depth,
        base_depth_m=base_depth,
        kind="cpt",
    )


ABOVE_LENS = _pick(10.26, 12.42)
BELOW_LENS = _pick(13.00, 15.48)


def test_fp1_unit_above_the_lens_borrows_from_the_flank_above_the_lens() -> None:
    """B6's 9.50-12.59 sand takes S6's 10.26-12.42, not its 13.00-15.48.

    The defect the owner saw: the deep interval answered for the shallow unit,
    so S6's very dense sand from 14.90 m surfaced at 11.87 m on the borehole.
    """
    chosen = flank_pick_for_unit(
        [ABOVE_LENS, BELOW_LENS],
        unit_top_elev_m=SURFACE_M - 9.50,
        unit_base_elev_m=SURFACE_M - 12.59,
    )
    assert chosen is ABOVE_LENS


def test_fp2_unit_below_the_lens_borrows_from_the_flank_below_the_lens() -> None:
    """The same body's lower unit takes the lower interval."""
    chosen = flank_pick_for_unit(
        [ABOVE_LENS, BELOW_LENS],
        unit_top_elev_m=SURFACE_M - 13.02,
        unit_base_elev_m=SURFACE_M - 14.75,
    )
    assert chosen is BELOW_LENS


def test_fp3_a_column_with_one_interval_is_unchanged() -> None:
    """The ordinary case — no lens, one interval — keeps answering as before."""
    only = _pick(10.26, 15.48)
    chosen = flank_pick_for_unit(
        [only],
        unit_top_elev_m=SURFACE_M - 9.50,
        unit_base_elev_m=SURFACE_M - 12.59,
    )
    assert chosen is only


def test_fp4_no_overlap_is_not_a_donor_at_all() -> None:
    """A flank interval that does not overlap the unit cannot be the same sheet.

    Owner, 2026-08-17, on a dense band that surfaced 4 m shallower than the
    sand it was copied from: *"that's the fallback, but that is not what we
    said, the fallback should be the most conservative class on the column, so
    all of it should've been MD sand?"*

    This function used to answer "nearest" here, and the caller then treated
    that guess as evidence — copying the donor's internal structure, stamping
    high confidence, and writing a correlation from it. Returning nothing
    instead lets the unit fall to the column floor, which is one band at the
    loosest class the column measured.
    """
    shallow = _pick(1.00, 2.00)
    deep = _pick(30.00, 31.00)
    chosen = flank_pick_for_unit(
        [deep, shallow],
        unit_top_elev_m=SURFACE_M - 3.00,
        unit_base_elev_m=SURFACE_M - 4.00,
    )
    assert chosen is None


def test_fp5_no_intervals_yields_nothing() -> None:
    """A column with no layer in this body group cannot be a flank."""
    assert flank_pick_for_unit([], unit_top_elev_m=0.0, unit_base_elev_m=-1.0) is None
