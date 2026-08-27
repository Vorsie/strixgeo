"""Unit tests for the extracted ``DivideBoreholes`` planner.

The planner is the half of the verb the preview endpoint reuses, so it has to
be exercisable without a database — that is the whole point of extracting it.
``_plan_borehole_bands_litho_confined`` takes only in-memory inputs and issues
no query, so these tests construct the use case around a ``None`` session and
never touch it.

Cases
-----
P1  The borehole takes the CPT to its left and the CPT to its right on the
    section: two bands split between the two flanks' own transitions, tiling
    its litho extent exactly.
P2  No same-lithology CPT band anywhere in the group → one conservative band at
    the lithology floor, stamped ``absolute_min`` / ``low``.
P3  A CPT-resolved band carries ``cpt_interpolated`` / ``high``.
P4  ``DivideBoreholePlan.columns`` aggregates a borehole's segments across body
    groups and sorts the bands top to bottom.
P5  A crowd of distant CPTs does not overrule the two flanking ones — the
    regression the owner reported on 1411-GEO-23/126-B4, in miniature.
P6  A borehole on no section falls back to its nearest CPT by map distance.
P7  An ACCEPTED tie whose span crosses the borehole's column names the donor
    pair, replacing the nearest-flank guess.
P8  A tied packing surface stays inside the borehole's litho body — where the
    body thins there, the surface is rescaled by the litho thickness at that
    location instead of keeping the donors' absolute depth.
"""

from __future__ import annotations

import random
from typing import cast
from uuid import UUID

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.divide_boreholes import (
    DivideBoreholePlan,
    DivideBoreholes,
    PlannedBand,
    PlannedBoreholeSegment,
)
from groundmodel.domain.services.borehole_flank_donors import SectionPlacement
from groundmodel.domain.services.geotech_tie_donors import AcceptedTie
from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)

# NAD 5 = SAND loose (the ZAND floor); 7 = SAND dense. Real class integers so a
# mis-wired lookup shows up as a wrong label rather than a passing tautology.
_NAD_LOOSE = 5
_NAD_DENSE = 7
_NAD_VERY_DENSE = 8


def _use_case() -> DivideBoreholes:
    """Build a ``DivideBoreholes`` whose session is never used.

    The planner method under test is synchronous and reads only its arguments;
    the repositories the base class builds store the session and nothing else.

    Returns
    -------
    DivideBoreholes
        A use case safe to call ``_plan_borehole_bands_litho_confined`` on.
    """
    return DivideBoreholes(cast(AsyncSession, None))


def _cpt_pick(investigation_id: str, top: float, base: float) -> BodyLayerPick:
    """Build a CPT body-layer pick covering ``[top, base]``.

    Parameters
    ----------
    investigation_id : str
        The CPT id, stringified.
    top : float
        Litho extent top (m below collar).
    base : float
        Litho extent base (m below collar).

    Returns
    -------
    BodyLayerPick
        The pick the planner reads ``investigation_id`` / extent from.
    """
    return BodyLayerPick(
        investigation_id=investigation_id,
        x_m=0.0,
        y_m=0.0,
        surface_elev_m=5.0,
        body_id=str(uuid7()),
        formation_id=str(uuid7()),
        top_depth_m=top,
        base_depth_m=base,
        kind="cpt",
    )


def test_p1_borehole_takes_the_cpt_to_its_left_and_to_its_right_on_the_section() -> None:
    """P1: the borehole gets two bands, split between its two flanks' transitions."""
    borehole = str(uuid7())
    cpt_a, cpt_b = str(uuid7()), str(uuid7())
    body_dense = uuid7()
    body_loose = uuid7()
    # CPT-A transitions loose→dense at 4 m; CPT-B at 5 m. Both span 0–8 m.
    layers = {
        cpt_a: [
            (0.0, 4.0, uuid7(), uuid7(), _NAD_LOOSE, body_loose),
            (4.0, 8.0, uuid7(), uuid7(), _NAD_DENSE, body_dense),
        ],
        cpt_b: [
            (0.0, 5.0, uuid7(), uuid7(), _NAD_LOOSE, body_loose),
            (5.0, 8.0, uuid7(), uuid7(), _NAD_DENSE, body_dense),
        ],
    }
    cpt_xy = {
        UUID(cpt_a): (0.0, 0.0, 5.0),
        UUID(cpt_b): (600.0, 0.0, 5.0),
    }
    section = SectionPlacement(
        section_id=str(uuid7()),
        section_name="A-A'",
        along_m={cpt_a: 0.0, borehole: 300.0, cpt_b: 600.0},
    )

    bands, body_ids, _donor_ids, selection = _use_case()._plan_borehole_bands_litho_confined(
        inv_id=borehole,
        bh_x=300.0,
        bh_y=0.0,
        bh_surface_elev=5.0,
        geo_top_m=0.0,
        geo_base_m=8.0,
        cpt_segs=[_cpt_pick(cpt_a, 0.0, 8.0), _cpt_pick(cpt_b, 0.0, 8.0)],
        litho_abs_min_class=_NAD_LOOSE,
        geotech_layer_by_inv_depth=layers,
        cpt_xy=cpt_xy,
        cpt_names={UUID(cpt_a): "CPT-A", UUID(cpt_b): "CPT-B"},
        section_placements=[section],
    )

    assert len(bands) == 2
    assert bands[0].top == 0.0
    assert bands[-1].base == 8.0
    # Contiguous: the split depth is shared, so the pair tiles the extent.
    assert bands[0].base == bands[1].top
    # Between the two CPTs' own transitions (4.0 and 5.0 m).
    assert 4.0 <= bands[0].base <= 5.0
    assert bands[0].nad_class == _NAD_LOOSE
    assert bands[1].nad_class == _NAD_DENSE
    # The dense band joins the dense CPT body; likewise the loose one.
    assert body_ids == [body_loose, body_dense]
    # And it can say which two tests it listened to, and where.
    assert selection.mode == "flank_interpolated"
    assert [d.stack.name for d in selection.donors] == ["CPT-A", "CPT-B"]
    assert selection.section_name == "A-A'"


def test_p2_no_cpt_evidence_falls_to_the_lithology_floor() -> None:
    """P2: with no same-lithology CPT band, one band at the absolute minimum."""
    bands, body_ids, _donor_ids, _selection = _use_case()._plan_borehole_bands_litho_confined(
        inv_id=str(uuid7()),
        bh_x=300.0,
        bh_y=0.0,
        bh_surface_elev=5.0,
        geo_top_m=1.0,
        geo_base_m=6.0,
        cpt_segs=[],
        litho_abs_min_class=_NAD_LOOSE,
        geotech_layer_by_inv_depth={},
        cpt_xy={},
        cpt_names={},
        section_placements=[],
    )

    assert len(bands) == 1
    assert (bands[0].top, bands[0].base) == (1.0, 6.0)
    assert bands[0].nad_class == _NAD_LOOSE
    assert bands[0].source == "absolute_min"
    # No same-class CPT evidence exists, so the band joins no packing body.
    assert body_ids == [None]


def test_p3_cpt_resolved_band_is_marked_cpt_interpolated() -> None:
    """P3: a band a CPT actually resolved carries the high-confidence source."""
    cpt = str(uuid7())
    layers = {cpt: [(0.0, 8.0, uuid7(), uuid7(), _NAD_DENSE, uuid7())]}

    bands, _body_ids, _donor_ids, _selection = _use_case()._plan_borehole_bands_litho_confined(
        inv_id=str(uuid7()),
        bh_x=100.0,
        bh_y=0.0,
        bh_surface_elev=5.0,
        geo_top_m=0.0,
        geo_base_m=8.0,
        cpt_segs=[_cpt_pick(cpt, 0.0, 8.0)],
        litho_abs_min_class=_NAD_LOOSE,
        geotech_layer_by_inv_depth=layers,
        cpt_xy={UUID(cpt): (0.0, 0.0, 5.0)},
        cpt_names={UUID(cpt): "CPT-1"},
        section_placements=[],
    )

    assert [b.source for b in bands] == ["cpt_interpolated"]
    assert bands[0].nad_class == _NAD_DENSE


def test_p4_columns_merges_a_boreholes_segments_and_sorts_them() -> None:
    """P4: a borehole spanning two bodies reports as ONE column, ordered by depth."""
    borehole = uuid7()
    other = uuid7()
    litho_fid = uuid7()

    def band(top: float, base: float) -> PlannedBand:
        return PlannedBand(
            depth_top_m=top,
            depth_base_m=base,
            nad_class=_NAD_LOOSE,
            source="absolute_min",
            confidence="low",
            body_id=None,
            source_litho_formation_id=litho_fid,
            source_geo_formation_id=None,
        )

    plan = DivideBoreholePlan(
        geotech_model_id=uuid7(),
        segments=(
            # Deliberately out of depth order: the deeper body group is planned
            # first, because group iteration order is not depth order.
            PlannedBoreholeSegment(
                borehole_id=borehole, investigation_id=str(borehole), bands=(band(4.0, 8.0),)
            ),
            PlannedBoreholeSegment(
                borehole_id=other, investigation_id=str(other), bands=(band(0.0, 3.0),)
            ),
            PlannedBoreholeSegment(
                borehole_id=borehole, investigation_id=str(borehole), bands=(band(0.0, 4.0),)
            ),
        ),
        divided_borehole_count=0,
        single_band_borehole_count=3,
        layer_count=3,
        pick_count=3,
        cpt_layer_index={},
        borehole_names={str(borehole): "BH-1", str(other): "BH-2"},
    )

    columns = plan.columns()
    assert [c.name for c in columns] == ["BH-1", "BH-2"]
    assert [(b.depth_top_m, b.depth_base_m) for b in columns[0].bands] == [(0.0, 4.0), (4.0, 8.0)]


def test_p5_a_crowd_of_distant_cpts_does_not_overrule_the_two_flanking_ones() -> None:
    """P5: the flanks decide; the rest of the body group does not get a vote.

    1411-GEO-23/126-B4 in miniature.  The borehole's two neighbours both read
    dense sand below ~4 m; eight far-away CPTs read loose sand all the way down.
    Under the old body-wide rule the crowd won twice over — it dragged the
    boundary AND it won the class vote, so the borehole came back with no dense
    sand at all.  The engineer's expectation is the neighbours'.
    """
    borehole = str(uuid7())
    flank_left, flank_right = str(uuid7()), str(uuid7())
    layers = {
        flank_left: [
            (0.0, 4.0, uuid7(), uuid7(), _NAD_LOOSE, uuid7()),
            (4.0, 10.0, uuid7(), uuid7(), _NAD_DENSE, uuid7()),
        ],
        flank_right: [
            (0.0, 4.4, uuid7(), uuid7(), _NAD_LOOSE, uuid7()),
            (4.4, 10.0, uuid7(), uuid7(), _NAD_DENSE, uuid7()),
        ],
    }
    cpt_xy = {UUID(flank_left): (-50.0, 0.0, 0.0), UUID(flank_right): (50.0, 0.0, 0.0)}
    cpt_names = {UUID(flank_left): "LEFT", UUID(flank_right): "RIGHT"}
    segs = [_cpt_pick(flank_left, 0.0, 10.0), _cpt_pick(flank_right, 0.0, 10.0)]
    along = {flank_left: 50.0, borehole: 100.0, flank_right: 150.0}

    # The crowd: eight CPTs in the same body group, far off the section, whose
    # loose sand runs to 9 m.
    for i in range(8):
        far = str(uuid7())
        layers[far] = [
            (0.0, 9.0, uuid7(), uuid7(), _NAD_LOOSE, uuid7()),
            (9.0, 10.0, uuid7(), uuid7(), _NAD_DENSE, uuid7()),
        ]
        cpt_xy[UUID(far)] = (400.0 + 60.0 * i, 300.0 + 40.0 * i, 0.0)
        cpt_names[UUID(far)] = f"FAR-{i}"
        segs.append(_cpt_pick(far, 0.0, 10.0))

    section = SectionPlacement(section_id=str(uuid7()), section_name="A-A'", along_m=along)

    bands, _body_ids, _donor_ids, selection = _use_case()._plan_borehole_bands_litho_confined(
        inv_id=borehole,
        bh_x=0.0,
        bh_y=0.0,
        bh_surface_elev=5.0,  # collar aligned with the picks: mTAW landing reads elevations
        geo_top_m=0.0,
        geo_base_m=10.0,
        cpt_segs=segs,
        litho_abs_min_class=_NAD_LOOSE,
        geotech_layer_by_inv_depth=layers,
        cpt_xy=cpt_xy,
        cpt_names=cpt_names,
        section_placements=[section],
    )

    assert [d.stack.name for d in selection.donors] == ["LEFT", "RIGHT"]
    assert [b.nad_class for b in bands] == [_NAD_LOOSE, _NAD_DENSE], (
        "the borehole must read dense sand where both its neighbours do, "
        f"got {[(round(b.top, 2), round(b.base, 2), b.nad_class) for b in bands]}"
    )
    assert 4.0 <= bands[0].base <= 4.4, (
        f"the dense sand must start where the two flanks bracket it, got {bands[0].base}"
    )


def test_p6_a_borehole_on_no_section_falls_back_to_the_nearest_test() -> None:
    """P6: off every section, the nearest CPT by map distance donates."""
    borehole = str(uuid7())
    near, far = str(uuid7()), str(uuid7())
    layers = {
        near: [
            (0.0, 4.0, uuid7(), uuid7(), _NAD_LOOSE, uuid7()),
            (4.0, 10.0, uuid7(), uuid7(), _NAD_DENSE, uuid7()),
        ],
        far: [
            (0.0, 9.0, uuid7(), uuid7(), _NAD_LOOSE, uuid7()),
            (9.0, 10.0, uuid7(), uuid7(), _NAD_DENSE, uuid7()),
        ],
    }

    bands, _body_ids, _donor_ids, selection = _use_case()._plan_borehole_bands_litho_confined(
        inv_id=borehole,
        bh_x=0.0,
        bh_y=0.0,
        bh_surface_elev=0.0,
        geo_top_m=0.0,
        geo_base_m=10.0,
        cpt_segs=[_cpt_pick(near, 0.0, 10.0), _cpt_pick(far, 0.0, 10.0)],
        litho_abs_min_class=_NAD_LOOSE,
        geotech_layer_by_inv_depth=layers,
        cpt_xy={UUID(near): (30.0, 0.0, 0.0), UUID(far): (900.0, 0.0, 0.0)},
        cpt_names={UUID(near): "NEAR", UUID(far): "FAR"},
        section_placements=[],
    )

    assert selection.mode == "nearest_fallback"
    assert [d.stack.name for d in selection.donors] == ["NEAR"]
    assert [round(b.base, 3) for b in bands] == [4.0, 10.0]


def test_p7_an_accepted_tie_across_the_borehole_names_the_donor_pair() -> None:
    """P7: the tied CPT pair speaks, not the untied CPTs nearest the borehole."""
    borehole = str(uuid7())
    tied_left, tied_right = str(uuid7()), str(uuid7())
    near_left, near_right = str(uuid7()), str(uuid7())
    body_loose, body_dense = uuid7(), uuid7()
    tied_left_top, tied_left_bot = uuid7(), uuid7()
    tied_right_top, tied_right_bot = uuid7(), uuid7()
    # The tied pair reads the transition at 4 m and 6 m; the untied near pair
    # reads it at 1 m on both sides, so whose voice wins is unmistakable.
    layers = {
        tied_left: [
            (0.0, 4.0, tied_left_top, uuid7(), _NAD_LOOSE, body_loose),
            (4.0, 10.0, tied_left_bot, uuid7(), _NAD_DENSE, body_dense),
        ],
        tied_right: [
            (0.0, 6.0, tied_right_top, uuid7(), _NAD_LOOSE, body_loose),
            (6.0, 10.0, tied_right_bot, uuid7(), _NAD_DENSE, body_dense),
        ],
        near_left: [
            (0.0, 1.0, uuid7(), uuid7(), _NAD_LOOSE, body_loose),
            (1.0, 10.0, uuid7(), uuid7(), _NAD_DENSE, body_dense),
        ],
        near_right: [
            (0.0, 1.0, uuid7(), uuid7(), _NAD_LOOSE, body_loose),
            (1.0, 10.0, uuid7(), uuid7(), _NAD_DENSE, body_dense),
        ],
    }
    section_id = str(uuid7())
    section = SectionPlacement(
        section_id=section_id,
        section_name="A-A'",
        along_m={
            tied_left: 0.0,
            near_left: 190.0,
            borehole: 200.0,
            near_right: 210.0,
            tied_right: 400.0,
        },
    )
    ties = [
        AcceptedTie(
            investigation_a=tied_left,
            layer_a_id=str(tied_left_top),
            investigation_b=tied_right,
            layer_b_id=str(tied_right_top),
            section_id=section_id,
        ),
        AcceptedTie(
            investigation_a=tied_left,
            layer_a_id=str(tied_left_bot),
            investigation_b=tied_right,
            layer_b_id=str(tied_right_bot),
            section_id=section_id,
        ),
    ]

    bands, _body_ids, _donor_ids, selection = _use_case()._plan_borehole_bands_litho_confined(
        inv_id=borehole,
        bh_x=200.0,
        bh_y=0.0,
        bh_surface_elev=5.0,  # collar aligned with the picks: mTAW landing reads elevations
        geo_top_m=0.0,
        geo_base_m=10.0,
        cpt_segs=[
            _cpt_pick(tied_left, 0.0, 10.0),
            _cpt_pick(tied_right, 0.0, 10.0),
            _cpt_pick(near_left, 0.0, 10.0),
            _cpt_pick(near_right, 0.0, 10.0),
        ],
        litho_abs_min_class=_NAD_LOOSE,
        geotech_layer_by_inv_depth=layers,
        cpt_xy={
            UUID(tied_left): (0.0, 0.0, 0.0),
            UUID(tied_right): (400.0, 0.0, 0.0),
            UUID(near_left): (190.0, 0.0, 0.0),
            UUID(near_right): (210.0, 0.0, 0.0),
        },
        cpt_names={
            UUID(tied_left): "TIED-L",
            UUID(tied_right): "TIED-R",
            UUID(near_left): "NEAR-L",
            UUID(near_right): "NEAR-R",
        },
        section_placements=[section],
        accepted_ties=ties,
    )

    assert selection.mode == "tie_interpolated"
    assert sorted(d.stack.name for d in selection.donors) == ["TIED-L", "TIED-R"]
    # Halfway between the two tied transitions (4 m and 6 m), nowhere near the
    # untied neighbours' 1 m.
    assert [round(b.base, 3) for b in bands] == [5.0, 10.0]


def test_p8_a_line_that_misses_the_thin_body_reads_the_bands_under_it() -> None:
    """P8: mTAW landing (owner, 2026-08-18: "go for the mtaw") on a thin body.

    Both donors read the dense top at +1.0 mTAW, so the drawn tie line runs
    flat at +1.0. The borehole's own litho body sits entirely BELOW that line.
    The line does not cross the unit, so no boundary is drawn — and the unit
    continues what lies UNDER the line: dense sand, top to base. The old
    fraction rescale would have split the thin unit 40 % down instead, placing
    a contact where the engineer drew no line at all."""
    borehole = str(uuid7())
    left, right = str(uuid7()), str(uuid7())
    body_loose, body_dense = uuid7(), uuid7()
    left_top, left_bot = uuid7(), uuid7()
    right_top, right_bot = uuid7(), uuid7()
    # Both donors read a 10 m sand with the dense top 40 % down (4.0 m).
    layers = {
        left: [
            (0.0, 4.0, left_top, uuid7(), _NAD_LOOSE, body_loose),
            (4.0, 10.0, left_bot, uuid7(), _NAD_DENSE, body_dense),
        ],
        right: [
            (0.0, 4.0, right_top, uuid7(), _NAD_LOOSE, body_loose),
            (4.0, 10.0, right_bot, uuid7(), _NAD_DENSE, body_dense),
        ],
    }
    section_id = str(uuid7())
    section = SectionPlacement(
        section_id=section_id,
        section_name="A-A'",
        along_m={left: 100.0, borehole: 200.0, right: 300.0},
    )
    ties = [
        AcceptedTie(
            investigation_a=left,
            layer_a_id=str(left_top),
            investigation_b=right,
            layer_b_id=str(right_top),
            section_id=section_id,
        ),
        AcceptedTie(
            investigation_a=left,
            layer_a_id=str(left_bot),
            investigation_b=right,
            layer_b_id=str(right_bot),
            section_id=section_id,
        ),
    ]

    # The picks' collar is +5.0, their boundary 4.0 m down → the tie line runs
    # flat at +1.0 mTAW. The borehole's collar is 0.0 and its thin body sits at
    # 3.0–5.0 m (−3.0 to −5.0 mTAW) or 3.0–4.0 m: entirely under the line.
    for extent_top, extent_base in ((3.0, 5.0), (3.0, 4.0)):
        bands, _body_ids, _donor_ids, selection = _use_case()._plan_borehole_bands_litho_confined(
            inv_id=borehole,
            bh_x=200.0,
            bh_y=0.0,
            bh_surface_elev=0.0,
            geo_top_m=extent_top,
            geo_base_m=extent_base,
            cpt_segs=[_cpt_pick(left, 0.0, 10.0), _cpt_pick(right, 0.0, 10.0)],
            litho_abs_min_class=_NAD_LOOSE,
            geotech_layer_by_inv_depth=layers,
            cpt_xy={UUID(left): (100.0, 0.0, 0.0), UUID(right): (300.0, 0.0, 0.0)},
            cpt_names={UUID(left): "L", UUID(right): "R"},
            section_placements=[section],
            accepted_ties=ties,
        )

        assert selection.mode == "tie_interpolated"
        assert [b.nad_class for b in bands] == [_NAD_DENSE], (
            f"the whole unit sits under the dense-top line, got "
            f"{[(round(b.top, 2), round(b.base, 2), b.nad_class) for b in bands]}"
        )
        assert bands[0].top == extent_top
        assert bands[-1].base == extent_base


def test_p9_the_nearer_flank_names_the_class_where_the_flanks_disagree() -> None:
    """P9: GEO-10/171-B9 in miniature (owner dogfeed, 2026-08-18).

    The tied seam is the VD top on both flanks, but the band ABOVE it is D on
    the far-left column and MD on the near-right one. The borehole stands 93 %
    of the way toward the right column, so it reads MD over VD — the far
    flank's D is an onlap that pinched out long before it. B9 came back D on
    top because the class pick took the LEFT column first, always."""
    borehole = str(uuid7())
    left, right = str(uuid7()), str(uuid7())
    body_upper, body_dense = uuid7(), uuid7()
    left_top, left_bot = uuid7(), uuid7()
    right_top, right_bot = uuid7(), uuid7()
    layers = {
        left: [
            (0.0, 5.0, left_top, uuid7(), _NAD_DENSE, body_upper),
            (5.0, 10.0, left_bot, uuid7(), _NAD_VERY_DENSE, body_dense),
        ],
        right: [
            (0.0, 5.2, right_top, uuid7(), _NAD_LOOSE, body_upper),
            (5.2, 10.0, right_bot, uuid7(), _NAD_VERY_DENSE, body_dense),
        ],
    }
    section_id = str(uuid7())
    section = SectionPlacement(
        section_id=section_id,
        section_name="A-A'",
        along_m={left: 0.0, borehole: 186.0, right: 200.0},
    )
    ties = [
        AcceptedTie(
            investigation_a=left,
            layer_a_id=str(left_bot),
            investigation_b=right,
            layer_b_id=str(right_bot),
            section_id=section_id,
        ),
    ]

    bands, _body_ids, _donor_ids, selection = _use_case()._plan_borehole_bands_litho_confined(
        inv_id=borehole,
        bh_x=186.0,
        bh_y=0.0,
        bh_surface_elev=5.0,
        geo_top_m=0.0,
        geo_base_m=10.0,
        cpt_segs=[_cpt_pick(left, 0.0, 10.0), _cpt_pick(right, 0.0, 10.0)],
        litho_abs_min_class=_NAD_LOOSE,
        geotech_layer_by_inv_depth=layers,
        cpt_xy={UUID(left): (0.0, 0.0, 0.0), UUID(right): (200.0, 0.0, 0.0)},
        cpt_names={UUID(left): "FAR-L", UUID(right): "NEAR-R"},
        section_placements=[section],
        accepted_ties=ties,
    )

    assert [b.nad_class for b in bands] == [_NAD_LOOSE, _NAD_VERY_DENSE], (
        f"the near flank's class must win above the tied seam, got "
        f"{[(round(b.top, 2), round(b.base, 2), b.nad_class) for b in bands]}"
    )
    # The seam itself lands on the drawn line: 0.0 + 0.93·(−0.2 − 0.0) mTAW.
    assert round(bands[0].base, 3) == pytest.approx(5.186)


def _partition(
    *,
    columns: list[tuple[str, float]],
    regions: list[RegionInput],
) -> SectionPartitionInput:
    """One section's 2-D partition, as the renderer ships it."""
    return SectionPartitionInput(
        start_x=0.0,
        start_y=0.0,
        end_x=600.0,
        end_y=0.0,
        columns=tuple(
            SectionColumnInput(investigation_id=inv, along_m=along, world_x=along, world_y=0.0)
            for inv, along in columns
        ),
        regions=tuple(regions),
    )


def test_pg1_the_borehole_reads_its_bands_off_the_section_geometry() -> None:
    """PG1 (owner ruling 2026-08-15): the borehole is a vertical line through
    the partition, not a stack interpolated onto it.

    The gap holds a loose band over a dense one, split at elevation 1.0 m — 4 m
    down the CPTs' 8 m unit. The borehole stands halfway across, and its OWN
    litho unit is only 4 m thick, so the split must land 2 m down it: the same
    FRACTION, not the same depth. That is the rescale, and it is what keeps the
    litho model authoritative.
    """
    cpt_a, cpt_b, borehole = str(uuid7()), str(uuid7()), str(uuid7())
    section_id = str(uuid7())
    loose_formation, dense_formation = str(uuid7()), str(uuid7())
    partition = _partition(
        columns=[(cpt_a, 0.0), (cpt_b, 600.0)],
        regions=[
            RegionInput(
                formation_id=loose_formation,
                body_id=None,
                polygon=((0.0, 5.0), (1.0, 5.0), (1.0, 1.0), (0.0, 1.0)),
                gap_index=0,
                kind="quad",
                layer_ids=("band-loose-A", "band-loose-B"),
            ),
            RegionInput(
                formation_id=dense_formation,
                body_id=None,
                polygon=((0.0, 1.0), (1.0, 1.0), (1.0, -3.0), (0.0, -3.0)),
                gap_index=0,
                kind="quad",
                layer_ids=("band-dense-A", "band-dense-B"),
            ),
        ],
    )
    section = SectionPlacement(
        section_id=section_id,
        section_name="A-A",
        along_m={cpt_a: 0.0, borehole: 300.0, cpt_b: 600.0},
    )

    bands, _body_ids, correspondences, _selection = _use_case()._plan_borehole_bands_litho_confined(
        inv_id=borehole,
        bh_x=300.0,
        bh_y=0.0,
        bh_surface_elev=5.0,
        geo_top_m=0.0,
        geo_base_m=4.0,
        cpt_segs=[_cpt_pick(cpt_a, 0.0, 8.0), _cpt_pick(cpt_b, 0.0, 8.0)],
        litho_abs_min_class=_NAD_LOOSE,
        geotech_layer_by_inv_depth={},
        cpt_xy={UUID(cpt_a): (0.0, 0.0, 5.0), UUID(cpt_b): (600.0, 0.0, 5.0)},
        cpt_names={UUID(cpt_a): "CPT-A", UUID(cpt_b): "CPT-B"},
        section_placements=[section],
        section_partitions={UUID(section_id): partition},
        geotech_formation_info={
            loose_formation: (_NAD_LOOSE, uuid7(), None),
            dense_formation: (_NAD_DENSE, uuid7(), None),
        },
    )

    assert [b.nad_class for b in bands] == [_NAD_LOOSE, _NAD_DENSE]
    assert bands[0].base == pytest.approx(2.0)
    assert (bands[0].top, bands[-1].base) == (0.0, 4.0)
    assert correspondences == [
        ("band-loose-A", "band-loose-B"),
        ("band-dense-A", "band-dense-B"),
    ]


def test_pg2_a_lens_that_pinched_out_before_the_borehole_is_not_read() -> None:
    """PG2: half-length lenses are drawn between two CPTs, so a borehole past
    the lens's end does not have it — and nothing is interpolated into the space
    it would have taken."""
    cpt_a, cpt_b, borehole = str(uuid7()), str(uuid7()), str(uuid7())
    section_id = str(uuid7())
    matrix_formation, lens_formation = str(uuid7()), str(uuid7())
    partition = _partition(
        columns=[(cpt_a, 0.0), (cpt_b, 600.0)],
        regions=[
            RegionInput(
                formation_id=matrix_formation,
                body_id=None,
                polygon=((0.0, 5.0), (1.0, 5.0), (1.0, -3.0), (0.0, -3.0)),
                gap_index=0,
                kind="quad",
                layer_ids=("matrix-A", "matrix-B"),
            ),
            RegionInput(
                formation_id=lens_formation,
                body_id=None,
                polygon=((0.0, 3.0), (0.2, 2.0), (0.0, 1.0)),
                gap_index=0,
                kind="lens",
                overlay_tier="lens",
                layer_ids=("lens-A",),
            ),
        ],
    )
    section = SectionPlacement(
        section_id=section_id,
        section_name="A-A",
        along_m={cpt_a: 0.0, borehole: 300.0, cpt_b: 600.0},
    )

    bands, _body_ids, correspondences, _selection = _use_case()._plan_borehole_bands_litho_confined(
        inv_id=borehole,
        bh_x=300.0,
        bh_y=0.0,
        bh_surface_elev=5.0,
        geo_top_m=0.0,
        geo_base_m=8.0,
        cpt_segs=[_cpt_pick(cpt_a, 0.0, 8.0), _cpt_pick(cpt_b, 0.0, 8.0)],
        litho_abs_min_class=_NAD_LOOSE,
        geotech_layer_by_inv_depth={},
        cpt_xy={UUID(cpt_a): (0.0, 0.0, 5.0), UUID(cpt_b): (600.0, 0.0, 5.0)},
        cpt_names={UUID(cpt_a): "CPT-A", UUID(cpt_b): "CPT-B"},
        section_placements=[section],
        section_partitions={UUID(section_id): partition},
        geotech_formation_info={
            matrix_formation: (_NAD_LOOSE, uuid7(), None),
            lens_formation: (_NAD_DENSE, uuid7(), None),
        },
    )

    assert [b.nad_class for b in bands] == [_NAD_LOOSE]
    assert correspondences == [("matrix-A", "matrix-B")]


def test_pg3_without_a_partition_the_donor_rule_still_answers() -> None:
    """PG3: the geometry outranks the donor rule only where it reaches. The
    preview, and any borehole no partition covers, keep today's answer — so the
    new path can never make a column worse than it was."""
    cpt = str(uuid7())
    layers = {cpt: [(0.0, 8.0, uuid7(), uuid7(), _NAD_DENSE, uuid7())]}

    bands, _body_ids, _correspondences, selection = _use_case()._plan_borehole_bands_litho_confined(
        inv_id=str(uuid7()),
        bh_x=100.0,
        bh_y=0.0,
        bh_surface_elev=5.0,
        geo_top_m=0.0,
        geo_base_m=8.0,
        cpt_segs=[_cpt_pick(cpt, 0.0, 8.0)],
        litho_abs_min_class=_NAD_LOOSE,
        geotech_layer_by_inv_depth=layers,
        cpt_xy={UUID(cpt): (0.0, 0.0, 5.0)},
        cpt_names={UUID(cpt): "CPT-A"},
        section_placements=[],
        section_partitions={},
        geotech_formation_info={},
    )

    assert [b.nad_class for b in bands] == [_NAD_DENSE]
    assert selection.mode in {"single_donor", "nearest_fallback"}


def test_pg4_a_partly_covered_layer_still_comes_out_contiguous() -> None:
    """PG4: the sampler PRESERVES gaps — depth the partition does not cover is
    genuinely unclassified and it will not invent a class for it. But a
    ``litho_layer`` column must be gap-free: the database trigger rejects the
    whole transaction otherwise, which is exactly how this surfaced on the
    owner's first geometry press ("litho_layer column not contiguous: 10
    gap/overlap(s)").

    So the cuts go through the same conservative filler the donor path uses.
    Here the geometry covers only the top 2 m of an 8 m unit; the rest must come
    back as a conservative band, and the column must tile its extent exactly.
    """
    cpt_a, cpt_b, borehole = str(uuid7()), str(uuid7()), str(uuid7())
    section_id = str(uuid7())
    covered_formation = str(uuid7())
    partition = _partition(
        columns=[(cpt_a, 0.0), (cpt_b, 600.0)],
        regions=[
            # Elevation 5.0 down to 3.0 only — the unit runs 5.0 down to -3.0.
            RegionInput(
                formation_id=covered_formation,
                body_id=None,
                polygon=((0.0, 5.0), (1.0, 5.0), (1.0, 3.0), (0.0, 3.0)),
                gap_index=0,
                kind="quad",
                layer_ids=("band-A", "band-B"),
            ),
        ],
    )
    section = SectionPlacement(
        section_id=section_id,
        section_name="A-A",
        along_m={cpt_a: 0.0, borehole: 300.0, cpt_b: 600.0},
    )

    bands, _body_ids, correspondences, _selection = _use_case()._plan_borehole_bands_litho_confined(
        inv_id=borehole,
        bh_x=300.0,
        bh_y=0.0,
        bh_surface_elev=5.0,
        geo_top_m=0.0,
        geo_base_m=8.0,
        cpt_segs=[_cpt_pick(cpt_a, 0.0, 8.0), _cpt_pick(cpt_b, 0.0, 8.0)],
        litho_abs_min_class=_NAD_LOOSE,
        geotech_layer_by_inv_depth={},
        cpt_xy={UUID(cpt_a): (0.0, 0.0, 5.0), UUID(cpt_b): (600.0, 0.0, 5.0)},
        cpt_names={UUID(cpt_a): "CPT-A", UUID(cpt_b): "CPT-B"},
        section_placements=[section],
        section_partitions={UUID(section_id): partition},
        geotech_formation_info={covered_formation: (_NAD_DENSE, uuid7(), None)},
    )

    # Tiles the extent exactly, no gap and no overlap — what the trigger checks.
    assert bands[0].top == 0.0
    assert bands[-1].base == 8.0
    for upper, lower in zip(bands, bands[1:]):
        assert upper.base == lower.top

    # The covered stretch keeps its geometry class AND its correspondence; the
    # uncovered stretch is a conservative fill that continues nothing, so it
    # carries no tie — inventing one there would claim a correlation from
    # ground the section never described.
    assert bands[0].nad_class == _NAD_DENSE
    assert correspondences[0] == ("band-A", "band-B")
    assert bands[-1].source in {"body_min", "absolute_min"}
    assert correspondences[-1] == ()


def test_pg5_any_geometry_produces_a_column_that_tiles_its_extent() -> None:
    """PG5: the property the database enforces, fuzzed.

    A ``litho_layer`` column must tile its extent exactly — the contiguity
    trigger refuses the WHOLE transaction on any gap or overlap, so one bad
    column takes the entire press down and nothing is written. That happened
    twice on the owner's real model (10, then 5 gap/overlap(s)), which is why
    this is a fuzz rather than one example: the geometry that reaches a borehole
    is whatever the engineer's correlations drew, and it will not be tidy.

    Regions here deliberately overlap each other, leave gaps, hang outside the
    unit and duplicate spans — everything the partition can hand a column.
    """
    rng = random.Random(20260816)
    cpt_a, cpt_b, borehole = str(uuid7()), str(uuid7()), str(uuid7())
    section_id = str(uuid7())
    formation = str(uuid7())
    section = SectionPlacement(
        section_id=section_id,
        section_name="A-A",
        along_m={cpt_a: 0.0, borehole: 300.0, cpt_b: 600.0},
    )

    geometry_cases = 0
    for case in range(300):
        regions = []
        for _ in range(rng.randint(0, 6)):
            top = rng.uniform(-4.0, 6.0)
            base = top - rng.uniform(0.0, 5.0)
            left = rng.uniform(0.0, 0.6)
            right = rng.uniform(left, 1.0)
            regions.append(
                RegionInput(
                    formation_id=formation,
                    body_id=None,
                    polygon=((left, top), (right, top), (right, base), (left, base)),
                    gap_index=0,
                    kind=rng.choice(["quad", "pinch", "lens"]),
                    overlay_tier=rng.choice([None, "lens", "onlap"]),
                    layer_ids=("band-A", "band-B"),
                )
            )
        extent_top = rng.uniform(0.0, 3.0)
        extent_base = extent_top + rng.uniform(0.05, 9.0)

        bands, _body_ids, correspondences, _selection = (
            _use_case()._plan_borehole_bands_litho_confined(
                inv_id=borehole,
                bh_x=300.0,
                bh_y=0.0,
                bh_surface_elev=5.0,
                geo_top_m=extent_top,
                geo_base_m=extent_base,
                cpt_segs=[_cpt_pick(cpt_a, 0.0, 8.0), _cpt_pick(cpt_b, 0.0, 8.0)],
                litho_abs_min_class=_NAD_LOOSE,
                geotech_layer_by_inv_depth={},
                cpt_xy={UUID(cpt_a): (0.0, 0.0, 5.0), UUID(cpt_b): (600.0, 0.0, 5.0)},
                cpt_names={UUID(cpt_a): "CPT-A", UUID(cpt_b): "CPT-B"},
                section_placements=[section],
                section_partitions={
                    UUID(section_id): _partition(
                        columns=[(cpt_a, 0.0), (cpt_b, 600.0)], regions=regions
                    )
                },
                geotech_formation_info={formation: (_NAD_DENSE, uuid7(), None)},
            )
        )

        assert bands, f"case {case}: a column may never come back empty"
        assert len(correspondences) == len(bands), f"case {case}: correspondence count"
        # Did the GEOMETRY answer, or did the tiling guard fall back to the
        # donor rule? Only the geometry can carry a region's layer ids here
        # (no donor bands exist in this scene), so this is what separates
        # "the sampler produced a good column" from "the guard rescued a bad
        # one" — without it the fuzz passes even with the sampler broken, which
        # is exactly what it did on first writing.
        if any(ids for ids in correspondences):
            geometry_cases += 1
        # Exactly what the trigger checks, on the mm grid it stores.
        assert abs(bands[0].top - extent_top) <= 0.0005, f"case {case}: top {bands[0].top}"
        assert abs(bands[-1].base - extent_base) <= 0.0005, f"case {case}: base"
        for upper, lower in zip(bands, bands[1:]):
            assert abs(upper.base - lower.top) <= 0.0005, (
                f"case {case}: seam {upper.base} -> {lower.top} is a gap or overlap"
            )

    # The guard is insurance, not the mechanism. If the sampler starts handing
    # out non-tiling columns the guard hides it behind the donor rule and every
    # assertion above still passes — so the fuzz only means something while the
    # geometry is answering most of the time.
    assert geometry_cases >= 200, (
        f"only {geometry_cases}/300 cases were answered by the section geometry — "
        "the tiling guard is falling back, which means the sampler is producing "
        "columns the database would refuse"
    )


def test_p10_a_straddling_tie_lands_even_when_an_interbed_splits_the_donor() -> None:
    """P10: 1411-GEO-23/126-B2 in miniature (owner dogfeed 2026-08-18: "at
    b2's column we have a very dense sand band bounded by two ties, that
    doesn't get rendered").

    The borehole's single sand unit spans what the left column reads as TWO
    litho units (a silt interbed splits its sand). The engineer's two VD ties
    start from the left column's LOWER sand — outside the one pick the flank
    machinery keeps per column — and straddle the borehole to the right
    column. The ties are his statement that the VD sheet runs through here:
    they land at the drawn lines' elevations and the borehole reads
    MD / VD / MD, not one top-to-bottom band."""
    borehole = str(uuid7())
    left, right = str(uuid7()), str(uuid7())
    body_sand = uuid7()
    upper_fm, silt_fm, lower_fm = uuid7(), uuid7(), uuid7()
    l_upper, l_silt, l_vd = uuid7(), uuid7(), uuid7()
    r_md, r_vd, r_md2 = uuid7(), uuid7(), uuid7()
    layers = {
        left: [
            # One MD sand unit, then a SILT interbed, then the VD sand unit.
            (8.8, 13.2, l_upper, upper_fm, _NAD_LOOSE, body_sand),
            (13.2, 14.1, l_silt, silt_fm, 16, body_sand),
            (14.1, 16.2, l_vd, lower_fm, _NAD_VERY_DENSE, body_sand),
        ],
        right: [
            (13.0, 14.0, r_md, lower_fm, _NAD_LOOSE, body_sand),
            (14.0, 16.3, r_vd, lower_fm, _NAD_VERY_DENSE, body_sand),
            (16.3, 18.9, r_md2, lower_fm, _NAD_LOOSE, body_sand),
        ],
    }
    section_id = str(uuid7())
    section = SectionPlacement(
        section_id=section_id,
        section_name="CS1",
        along_m={left: 575.0, borehole: 578.0, right: 725.0},
    )
    ties = [
        # VD top: left lower-sand top (elev 12.9-14.1 = -1.2) <-> right VD top
        # (13.0-14.0 = -1.0).
        AcceptedTie(
            investigation_a=left,
            layer_a_id=str(l_vd),
            investigation_b=right,
            layer_b_id=str(r_vd),
            section_id=section_id,
        ),
        # VD base: left lower-sand base (16.2 = -3.3) <-> right bottom-MD top
        # (16.3 = -3.3).
        AcceptedTie(
            investigation_a=left,
            layer_a_id=str(l_vd),
            investigation_b=right,
            layer_b_id=str(r_md2),
            section_id=section_id,
            side_a="base",
            side_b="top",
        ),
    ]
    # The flank machinery keeps ONE pick per column: the left column's pick is
    # its UPPER sand unit (the better window overlap) — the tie endpoints live
    # in the lower one.
    left_pick = BodyLayerPick(
        investigation_id=left,
        x_m=575.0,
        y_m=0.0,
        surface_elev_m=12.9,
        body_id=str(body_sand),
        formation_id=str(upper_fm),
        top_depth_m=8.8,
        base_depth_m=13.2,
        kind="cpt",
    )
    right_pick = BodyLayerPick(
        investigation_id=right,
        x_m=725.0,
        y_m=0.0,
        surface_elev_m=13.0,
        body_id=str(body_sand),
        formation_id=str(lower_fm),
        top_depth_m=13.0,
        base_depth_m=18.9,
        kind="cpt",
    )

    bands, _body_ids, _donor_ids, _selection = _use_case()._plan_borehole_bands_litho_confined(
        inv_id=borehole,
        bh_x=578.0,
        bh_y=0.0,
        bh_surface_elev=13.0,
        geo_top_m=8.8,
        geo_base_m=17.5,
        cpt_segs=[left_pick, right_pick],
        litho_abs_min_class=_NAD_LOOSE,
        geotech_layer_by_inv_depth=layers,
        cpt_xy={UUID(left): (575.0, 0.0, 12.9), UUID(right): (725.0, 0.0, 13.0)},
        cpt_names={UUID(left): "S10", UUID(right): "S6"},
        section_placements=[section],
        accepted_ties=ties,
        unit_soil_code="ZAND",
        soil_by_formation={
            str(upper_fm): "ZAND",
            str(lower_fm): "ZAND",
            str(silt_fm): "SILT",
        },
    )

    assert [b.nad_class for b in bands] == [_NAD_LOOSE, _NAD_VERY_DENSE, _NAD_LOOSE], (
        f"the ties bound a VD band through the borehole, got "
        f"{[(round(b.top, 2), round(b.base, 2), b.nad_class) for b in bands]}"
    )
    # The boundaries sit on the drawn lines: 2 % across a 150 m gap.
    frac = (578.0 - 575.0) / 150.0
    line1 = -1.2 + frac * (-1.0 - -1.2)
    line2 = -3.3 + frac * (-3.3 - -3.3)
    assert bands[0].base == pytest.approx(13.0 - line1, abs=0.001)
    assert bands[1].base == pytest.approx(13.0 - line2, abs=0.001)


def test_planned_band_carries_source_litho_layer_id() -> None:
    """A borehole geotech band names the covering litho band it fills (A3).

    The divide caller stamps every band of a segment with the borehole's own
    accepted litho layer (``unit_layer[0]``) so the Parameters tree can place
    the band under its litho body. The field is additive — a band that names no
    parent (a conservative fill outside any litho layer) reads ``None``.
    """
    parent = uuid7()
    band = PlannedBand(
        depth_top_m=0.0,
        depth_base_m=1.0,
        nad_class=_NAD_LOOSE,
        source="cpt_interpolated",
        confidence="high",
        body_id=None,
        source_litho_formation_id=uuid7(),
        source_geo_formation_id=None,
        source_litho_layer_id=parent,
    )
    assert band.source_litho_layer_id == parent
    # Default when the caller has no covering litho band.
    orphan = PlannedBand(
        depth_top_m=0.0,
        depth_base_m=1.0,
        nad_class=_NAD_LOOSE,
        source="absolute_min",
        confidence="low",
        body_id=None,
        source_litho_formation_id=uuid7(),
        source_geo_formation_id=None,
    )
    assert orphan.source_litho_layer_id is None
