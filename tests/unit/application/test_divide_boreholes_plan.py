"""Unit tests for the extracted ``DivideBoreholes`` planner.

The planner is the half of the verb the preview endpoint reuses, so it has to
be exercisable without a database — that is the whole point of extracting it.
``_plan_borehole_bands_litho_confined`` takes only in-memory inputs and issues
no query, so these tests construct the use case around a ``None`` session and
never touch it.

Cases
-----
P1  Two CPTs whose packing transition sits at different depths → the borehole
    between them gets two bands, split at the TIN-interpolated depth, tiling its
    litho extent exactly.
P2  No same-lithology CPT band anywhere in the group → one conservative band at
    the lithology floor, stamped ``absolute_min`` / ``low``.
P3  A CPT-resolved band carries ``cpt_interpolated`` / ``high``.
P4  ``DivideBoreholePlan.columns`` aggregates a borehole's segments across body
    groups and sorts the bands top to bottom.
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


def test_p1_borehole_between_two_cpts_splits_at_interpolated_depth() -> None:
    """P1: the borehole gets two bands, split between the two CPTs' transitions."""
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

    bands, body_ids = _use_case()._plan_borehole_bands_litho_confined(
        inv_id=str(uuid7()),
        bh_x=300.0,
        bh_y=0.0,
        bh_surface_elev=5.0,
        geo_top_m=0.0,
        geo_base_m=8.0,
        cpt_segs=[_cpt_pick(cpt_a, 0.0, 8.0), _cpt_pick(cpt_b, 0.0, 8.0)],
        litho_abs_min_class=_NAD_LOOSE,
        geotech_layer_by_inv_depth=layers,
        cpt_xy=cpt_xy,
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


def test_p2_no_cpt_evidence_falls_to_the_lithology_floor() -> None:
    """P2: with no same-lithology CPT band, one band at the absolute minimum."""
    bands, body_ids = _use_case()._plan_borehole_bands_litho_confined(
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

    bands, _ = _use_case()._plan_borehole_bands_litho_confined(
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
