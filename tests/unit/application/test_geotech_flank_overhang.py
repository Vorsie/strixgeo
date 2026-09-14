"""A borehole unit that rises above the flank sand reads what the flanks show there.

Owner, installer #37 dogfeed (2026-09-14), borehole GEO-07/182-B2: its lower
clean sand read ``ZAND·D`` while the flanking CPTs read ``ZAND(f)·MD`` at that
elevation.  His words: *"I don't know where the dense sand is coming from
though. it says md on the left and md on the right."*

Why the dense sand appeared.  On the flanks the sand in this body group begins
only at ~-4.17 mTAW (a clean-over-silty litho contact splits it there); the
borehole's own clean-sand unit is ONE unit that reaches ~0.65 m higher.  The
tie-driven placement (``_plan_bands_from_unit_ties`` → ``_bands_between``) put
the top of that unit into the band immediately below the first placed cut — the
flank's DENSE band — even though the flank's dense band does not reach that
high.  So the overhang, where the flanks show only their loosest packing, was
painted dense.

The rule (owner): *"the lent level is what the flanks show at that elevation;
when both flanks agree, the borehole reads the same level."*  Where the
borehole unit extends above (or below) the flank donor coverage, that overhang
takes the conservative floor the flanks measured — the same ``body_min`` the
donor-fill path already uses for a gap — not the dense band next to it.  Design
note §1c ("unread ground is not silently claimed"): an overhang LONGER than the
minimum layer thickness becomes its own floor band; a shorter one stretches to
the boundary as before.
"""

from __future__ import annotations

from typing import cast
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.divide_boreholes import DivideBoreholes
from groundmodel.domain.services.borehole_flank_donors import SectionPlacement
from groundmodel.domain.services.litho_body_pick import BodyLayerPick

# SAND, silty/clayey — medium dense (10) and dense (11).  The flanks are silty
# sand; the labels keep the owner's MD-vs-D distinction visible in the asserts.
_MD, _D = 10, 11


def _pick(inv: str, collar: float, top: float, base: float) -> BodyLayerPick:
    """The flank column's own extent for this body group (depths below collar)."""
    return BodyLayerPick(
        investigation_id=inv,
        x_m=0.0,
        y_m=0.0,
        surface_elev_m=collar,
        body_id=str(uuid7()),
        formation_id=str(uuid7()),
        top_depth_m=top,
        base_depth_m=base,
        kind="cpt",
    )


def _use_case() -> DivideBoreholes:
    """A use case whose session is never touched by the synchronous planner."""
    return DivideBoreholes(cast(AsyncSession, None))


def _plan_b2_shape(geo_top_m: float, geo_base_m: float) -> list[tuple[float, float, int]]:
    """Plan a borehole sand unit flanked by S2 (near, D-over-MD) and S3 (far, MD).

    The flank sand in this body group begins at depth 11.70 on S2 (elev -4.17)
    and 11.65 on S3 (-4.19); the borehole's unit spans ``geo_top_m..geo_base_m``.
    The near flank S2 reads dense (11.70-12.59) then medium dense (12.59-19.36);
    the far flank S3 is medium dense throughout.  Returns ``(top, base, class)``.
    """
    bh, left, right = str(uuid7()), str(uuid7()), str(uuid7())
    layers = {
        left: [
            (11.70, 12.59, uuid7(), uuid7(), _D, uuid7()),
            (12.59, 19.36, uuid7(), uuid7(), _MD, uuid7()),
        ],
        right: [
            (11.65, 19.85, uuid7(), uuid7(), _MD, uuid7()),
        ],
    }
    bands, _bodies, _donors, _selection = _use_case()._plan_borehole_bands_litho_confined(
        inv_id=bh,
        bh_x=48.0,
        bh_y=0.0,
        bh_surface_elev=7.48,
        geo_top_m=geo_top_m,
        geo_base_m=geo_base_m,
        cpt_segs=[_pick(left, 7.53, 11.70, 19.36), _pick(right, 7.46, 11.65, 19.85)],
        litho_abs_min_class=_MD,
        geotech_layer_by_inv_depth=layers,
        cpt_xy={UUID(left): (0.0, 0.0, 7.53), UUID(right): (75.0, 0.0, 7.46)},
        cpt_names={UUID(left): "GEO-07/181-S2", UUID(right): "GEO-07/181-S3"},
        section_placements=[
            SectionPlacement(
                section_id=str(uuid7()),
                section_name="Tie-section 5",
                along_m={left: 0.0, bh: 3.0, right: 75.0},
            )
        ],
    )
    return [(round(b.top, 2), round(b.base, 2), b.nad_class) for b in bands]


def test_fo1_the_overhang_reads_md_not_the_dense_band_below() -> None:
    """ "it says md on the left and md on the right" — the top of B2 is MD, not D.

    The unit rises 0.65 m above the flank sand; that overhang must read the
    medium-dense floor the flanks show there, never the dense band beneath it.
    """
    bands = _plan_b2_shape(11.00, 13.00)
    # The shallowest planned band covers the overhang; it must not be dense.
    assert bands[0][2] == _MD, f"top band should be medium dense, got {bands}"


def test_fo2_the_dense_band_survives_where_the_near_flank_is_dense() -> None:
    """Below the overhang the borehole still reads the near flank's dense band.

    The fix removes only the dense paint that spilled ABOVE the flank sand — it
    does not erase the dense band the near flank genuinely reads at -4.17..-5.06.
    """
    bands = _plan_b2_shape(11.00, 13.00)
    assert _D in [c for _t, _b, c in bands], f"dense band lost entirely: {bands}"
    # ... and the succession reads medium dense, then dense, then medium dense.
    succession = [c for i, (_t, _b, c) in enumerate(bands) if i == 0 or c != bands[i - 1][2]]
    assert succession == [_MD, _D, _MD], f"expected MD/D/MD, got {succession}"


def test_fo3_a_unit_within_the_flank_coverage_is_unchanged() -> None:
    """No overhang → the plan is exactly what it was (no spurious floor band).

    A unit that sits entirely inside the flank sand (11.80..13.00, below the
    -4.17 flank top) must not gain a floor band — the clamp is a strict no-op.
    """
    bands = _plan_b2_shape(11.80, 13.00)
    # First band is the near flank's dense band; there is no floor band above it.
    assert bands[0][2] == _D, f"a covered unit must not gain a floor band: {bands}"
