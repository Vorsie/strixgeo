"""Unit tests for ``SubdivideAllBodies`` pure seams (Parameters body-tree A3).

The geotech CPT band is minted BY splitting one accepted litho band (one
``BodyLayerPick`` segment), so the covering litho band is the parent id the
materialiser already holds. ``_build_column_plans`` is where that id is carried
from the segment onto the per-column plan the writer transcribes — a pure
method (``None`` session), so the carry is testable without a database.
"""

from __future__ import annotations

from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.subdivide_all_bodies import SubdivideAllBodies
from groundmodel.domain.services.litho_body_pick import BodyLayerPick


def _use_case() -> SubdivideAllBodies:
    """A ``SubdivideAllBodies`` whose session is never used by the pure method."""
    return SubdivideAllBodies(cast(AsyncSession, None))


def _borehole_pick(*, litho_layer_id: str) -> BodyLayerPick:
    """A borehole segment (no qc) carrying its source litho layer id."""
    return BodyLayerPick(
        investigation_id="bh-1",
        x_m=0.0,
        y_m=0.0,
        surface_elev_m=0.0,
        body_id="body-1",
        formation_id="fm-1",
        top_depth_m=1.0,
        base_depth_m=3.0,
        kind="borehole",
        litho_layer_id=litho_layer_id,
    )


def test_column_plan_carries_the_segment_source_litho_layer_id() -> None:
    """A band subdivided out of litho band L carries L's id on its column plan.

    A borehole segment (no qc → one skeleton band) is enough to exercise the
    carry: the plan the writer stamps must name the litho band it came from.
    """
    seg = _borehole_pick(litho_layer_id="litho-layer-42")
    plans = _use_case()._build_column_plans(
        group_segs=[seg],
        anchor_kind={"bh-1": "borehole"},
        profile_by_seg_key={},
    )
    assert len(plans) == 1
    assert plans[0].litho_layer_id == "litho-layer-42"
