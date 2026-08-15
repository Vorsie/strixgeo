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

from typing import cast
from uuid import UUID

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

# NAD 5 = SAND loose (the ZAND floor); 7 = SAND dense. Real class integers so a
# mis-wired lookup shows up as a wrong label rather than a passing tautology.
_NAD_LOOSE = 5
_NAD_DENSE = 7


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
        bh_surface_elev=0.0,
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
        bh_surface_elev=0.0,
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


def test_p8_a_tied_surface_is_rescaled_where_the_litho_body_thins() -> None:
    """P8: the tied packing surface stays inside a litho body that thins here."""
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

    # At the borehole the same sand is only 2 m thick, 3.0–5.0 m. Keeping the
    # donors' absolute 4.0 m would be inside by luck; a 1 m body at 3.0–4.0 m
    # would not. Both are checked: the surface must land at 40 % of whatever
    # thickness the litho body has HERE.
    for extent_top, extent_base, expected in ((3.0, 5.0, 3.8), (3.0, 4.0, 3.4)):
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
        assert [b.nad_class for b in bands] == [_NAD_LOOSE, _NAD_DENSE]
        assert round(bands[0].base, 3) == expected
        assert bands[0].top == extent_top
        assert bands[-1].base == extent_base
