"""One litho layer gets ONE derivation, whatever cuts it.

Owner, 2026-08-16, circling B9's top sand: *"none of that messy dense very
dense succession on top"*, with arrows showing one MD, one VD, one D across
S10 | B9 | S9.

What he saw: B9 carries a single sand layer 7.50-17.50 m, a geological
contact cuts it at about 10.87 m, and each half was planned on its own
against the same flank.  S9's sand reads ``6 -> 8 -> 7``, so B9 received that
sequence TWICE — ``6 8 7 6 8 7`` — the second copy being the "mess" at the
top.

A geological contact is a CUT.  It divides a layer into pieces that may carry
different geological parents; it is not a reason to read the neighbouring
column twice.  So the packing is mapped across the whole litho layer once,
and the cut then splits the result.
"""

from __future__ import annotations

from typing import cast
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.divide_boreholes import DivideBoreholes
from groundmodel.domain.services.borehole_flank_donors import SectionPlacement
from groundmodel.domain.services.litho_body_pick import BodyLayerPick

_MD, _VD, _D = 6, 8, 7


def _pick(investigation_id: str, top: float, base: float) -> BodyLayerPick:
    """The flank's own extent for this body."""
    return BodyLayerPick(
        investigation_id=investigation_id,
        x_m=0.0,
        y_m=0.0,
        surface_elev_m=13.0,
        body_id=str(uuid7()),
        formation_id=str(uuid7()),
        top_depth_m=top,
        base_depth_m=base,
        kind="cpt",
    )


def _plan_slice(slice_top: float, slice_base: float) -> list[tuple[float, float, int]]:
    """Plan one geo-bounded slice of a borehole sand layer spanning 7.5-17.5 m.

    The flank reads medium dense, then very dense, then dense over its own
    sand.  Returns ``(top, base, nad_class)`` per planned band.
    """
    borehole, cpt = str(uuid7()), str(uuid7())
    layers = {
        cpt: [
            (11.12, 13.57, uuid7(), uuid7(), _MD, uuid7()),
            (13.57, 16.28, uuid7(), uuid7(), _VD, uuid7()),
            (16.28, 17.69, uuid7(), uuid7(), _D, uuid7()),
        ]
    }
    bands, _bodies, _donors, _selection = _use_case()._plan_borehole_bands_litho_confined(
        inv_id=borehole,
        bh_x=50.0,
        bh_y=0.0,
        bh_surface_elev=13.0,
        geo_top_m=slice_top,
        geo_base_m=slice_base,
        # The layer the slice belongs to — one derivation covers all of it.
        litho_layer_top_m=7.50,
        litho_layer_base_m=17.50,
        cpt_segs=[_pick(cpt, 11.12, 17.69)],
        litho_abs_min_class=_MD,
        geotech_layer_by_inv_depth=layers,
        cpt_xy={UUID(cpt): (0.0, 0.0, 13.0)},
        cpt_names={UUID(cpt): "S9"},
        section_placements=[
            SectionPlacement(
                section_id=str(uuid7()),
                section_name="CS1",
                along_m={cpt: 0.0, borehole: 50.0},
            )
        ],
    )
    return [(b.top, b.base, b.nad_class) for b in bands]


def _use_case() -> DivideBoreholes:
    """A use case whose session is never touched by the synchronous planner."""
    return DivideBoreholes(cast(AsyncSession, None))


def test_sd1_a_cut_layer_does_not_repeat_the_flank_s_succession() -> None:
    """The two halves together read 6-8-7 once, not 6-8-7-6-8-7.

    His scene exactly: the cut at 10.87 m must not buy a second copy of the
    neighbouring column's sand.
    """
    upper = _plan_slice(7.50, 10.87)
    lower = _plan_slice(10.87, 17.50)
    classes = [nad for _top, _base, nad in upper + lower]
    # Consecutive duplicates collapse: the succession is what matters, not how
    # many pieces the cut left it in.
    succession = [nad for i, nad in enumerate(classes) if i == 0 or nad != classes[i - 1]]
    assert succession == [_MD, _VD, _D]


def test_sd2_the_two_halves_tile_the_layer_exactly() -> None:
    """No gap and no overlap at the geological cut."""
    upper = _plan_slice(7.50, 10.87)
    lower = _plan_slice(10.87, 17.50)
    assert upper[0][0] == 7.50
    assert upper[-1][1] == 10.87
    assert lower[0][0] == 10.87
    assert lower[-1][1] == 17.50


def test_sd3_an_uncut_layer_is_unchanged() -> None:
    """A layer with no geological contact through it derives exactly as before."""
    whole = _plan_slice(7.50, 17.50)
    assert [nad for _top, _base, nad in whole] == [_MD, _VD, _D]
    assert whole[0][0] == 7.50
    assert whole[-1][1] == 17.50
