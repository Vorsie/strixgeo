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
from groundmodel.domain.services.geotech_body_aggregation import BandProfile
from groundmodel.domain.services.geotech_subdivision import GeotechSplit
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


def _cpt_pick(*, top: float, base: float, litho_layer_id: str) -> BodyLayerPick:
    """One CPT segment (one accepted litho layer) in the shared sand body."""
    return BodyLayerPick(
        investigation_id="cpt-1",
        x_m=0.0,
        y_m=0.0,
        surface_elev_m=0.0,
        body_id="body-1",
        formation_id="fm-1",
        top_depth_m=top,
        base_depth_m=base,
        kind="cpt",
        litho_layer_id=litho_layer_id,
    )


def test_the_cpt_press_keeps_a_split_layer_split_even_at_one_class() -> None:
    """Owner, 2026-09-12: *"if a layer is split into two in the litho then it
    has to stay split in geotech ofcourse"* — the CPT axis of that rule.

    A litho layer the engineer split into two same-composition halves reaches
    the CPT press as TWO segments (two ``BodyLayerPick`` rows, one per litho
    layer id). ``_build_column_plans`` segments each one against its own qc
    window, so even when both halves classify the SAME NAD class the split
    survives: two plans, a boundary exactly at the split depth, each plan
    naming its own litho layer. (Guard, not red-first: the CPT press keeps this
    by construction — each segment is planned alone — so this pins the invariant
    RULING B needs on the CPT axis rather than fixing a regression.)
    """
    upper = _cpt_pick(top=1.0, base=2.0, litho_layer_id="L-upper")
    lower = _cpt_pick(top=2.0, base=3.0, litho_layer_id="L-lower")

    plans = _use_case()._build_column_plans(
        group_segs=[upper, lower],
        anchor_kind={"cpt-1": "cpt"},
        profile_by_seg_key={
            ("cpt-1", 1.0): BandProfile("cpt-1", [GeotechSplit(1.0, 2.0, 6)]),
            ("cpt-1", 2.0): BandProfile("cpt-1", [GeotechSplit(2.0, 3.0, 6)]),
        },
    )

    assert len(plans) == 2
    # The split depth is a boundary, and no plan's band spans it.
    assert plans[0].sub_intervals == [(1.0, 2.0)]
    assert plans[1].sub_intervals == [(2.0, 3.0)]
    # Each half names the litho layer it was minted from — never welded onto one.
    assert [p.litho_layer_id for p in plans] == ["L-upper", "L-lower"]
    # Both halves classify NAD 6 and still stay two bands.
    assert plans[0].nad_classes == [6]
    assert plans[1].nad_classes == [6]
