"""A "Split here" of ONE composition survives the borehole planner itself.

Owner, 2026-09-12: *"if a layer is split into two in the litho then it has to
stay split in geotech ofcourse."*

RULING B has two routes and this module pins the harder one -- the PLANNER, not
just the merge-back. When the engineer splits one litho layer into two layers of
the SAME composition, the two are different ``litho_layer`` rows sharing a
formation, so they fall into ONE planning group (the group key is
``(body, geo, formation)`` and cannot carry the per-column-unique layer id -- see
``docs/design/geotech-stage.md`` section 8-0c). The danger: if the planner
emitted a single donor/tie-interpolated band over the UNION of both segments,
there would be no boundary at the split depth for the merge-back to preserve in
the first place.

The scene is his b13 column made same-composition: the flanking CPTs read the
same NAD class (7) on BOTH sides of the split at 14.52 m, so a band that spanned
the union -- or a merge-back that welded the two class-7 halves -- would run
straight through the litho contact.

The chain the case walks is the press's own planning half with the database
reads removed, exactly as ``test_geotech_admixture_litho_split.py`` does:
``_group_segments`` decides the planning unit, ``_plan_borehole_bands_litho_
confined`` lays the flanking CPTs' packing onto EACH borehole segment, every band
is stamped with its own litho layer, and ``merge_geo_split_bands`` collapses
same-class neighbours only INSIDE one litho layer.
"""

from __future__ import annotations

from typing import cast
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.divide_boreholes import (
    DivideBoreholes,
    PlannedBand,
    merge_geo_split_bands,
)
from groundmodel.domain.services.borehole_flank_donors import SectionPlacement
from groundmodel.domain.services.litho_body_pick import BodyLayerPick

# His column, to the centimetre.
_COLLAR_M = 14.30
_SAND_TOP_M = 11.40
_SPLIT_M = 14.52  # the "Split here" depth -- a litho contact between two layers
_COLUMN_BASE_M = 25.00
# The two class changes the flanking CPTs read -- class 7 straddles the split.
_UPPER_CHANGE_M = 12.93
_LOWER_CHANGE_M = 19.72

_NAD_6 = 6
_NAD_7 = 7

# ONE composition, split into two litho LAYERS: same formation row, two layer
# ids. This is the case yesterday's admixture fix (formation in the group key)
# does NOT separate -- both halves share the formation -- so the planner and the
# merge must keep them apart on the LAYER instead.
_BODY_SAND = "BODY-ZAND"
_F_SAND = str(uuid7())

_BOREHOLE = str(uuid7())
_CPT_LEFT = str(uuid7())
_CPT_RIGHT = str(uuid7())

_SECTION = SectionPlacement(
    section_id=str(uuid7()),
    section_name="A-Aprime",
    along_m={_CPT_LEFT: 0.0, _BOREHOLE: 100.0, _CPT_RIGHT: 200.0},
)

# The two borehole halves' litho layer ids -- the identity the split hangs on.
_LAYER_UPPER = str(uuid7())
_LAYER_LOWER = str(uuid7())


def _pick(investigation: str, top: float, base: float, kind: str, layer_id: str) -> BodyLayerPick:
    """One accepted litho layer of the shared sand as the geotech stage reads it."""
    return BodyLayerPick(
        investigation_id=investigation,
        x_m={_CPT_LEFT: 0.0, _BOREHOLE: 100.0, _CPT_RIGHT: 200.0}[investigation],
        y_m=0.0,
        surface_elev_m=_COLLAR_M,
        body_id=_BODY_SAND,
        formation_id=_F_SAND,
        top_depth_m=top,
        base_depth_m=base,
        kind=kind,
        litho_layer_id=layer_id,
    )


def _split_picks() -> list[BodyLayerPick]:
    """The borehole's two same-composition halves plus the two flanking CPTs.

    The borehole is split at 14.52 m; each CPT carries the whole sand as one
    litho layer (only the borehole was split).
    """
    return [
        _pick(_BOREHOLE, _SAND_TOP_M, _SPLIT_M, "borehole", _LAYER_UPPER),
        _pick(_BOREHOLE, _SPLIT_M, _COLUMN_BASE_M, "borehole", _LAYER_LOWER),
        _pick(_CPT_LEFT, _SAND_TOP_M, _COLUMN_BASE_M, "cpt", str(uuid7())),
        _pick(_CPT_RIGHT, _SAND_TOP_M, _COLUMN_BASE_M, "cpt", str(uuid7())),
    ]


def _cpt_geotech_layers() -> dict[str, list[tuple[float, float, UUID, UUID, int | None, UUID]]]:
    """Both flanking CPTs read 6 | 7 | 6 -- class 7 straddles the 14.52 split.

    Returns
    -------
    dict
        ``investigation id -> [(top, base, layer_id, formation_id, nad_class,
        body_id)]`` -- the donor index the planner reads packing from.
    """
    body_6, body_7 = uuid7(), uuid7()
    return {
        cpt: [
            (_SAND_TOP_M, _UPPER_CHANGE_M, uuid7(), uuid7(), _NAD_6, body_6),
            (_UPPER_CHANGE_M, _LOWER_CHANGE_M, uuid7(), uuid7(), _NAD_7, body_7),
            (_LOWER_CHANGE_M, _COLUMN_BASE_M, uuid7(), uuid7(), _NAD_6, body_6),
        ]
        for cpt in (_CPT_LEFT, _CPT_RIGHT)
    }


def _plan_split(*, merge: bool) -> list[PlannedBand]:
    """Run the press's planning half over the split column.

    Parameters
    ----------
    merge : bool
        When ``False`` the raw emitted bands are returned (isolating the
        EMISSION step); when ``True`` ``merge_geo_split_bands`` is applied on top,
        as the real ``DivideBoreholes.plan`` does.

    Returns
    -------
    list[PlannedBand]
        The borehole's bands, top to bottom.
    """
    use_case = DivideBoreholes(cast(AsyncSession, None))
    layers = _cpt_geotech_layers()
    cpt_xy = {
        UUID(_CPT_LEFT): (0.0, 0.0, _COLLAR_M),
        UUID(_CPT_RIGHT): (200.0, 0.0, _COLLAR_M),
    }

    planned: list[PlannedBand] = []
    for group_segs in use_case._group_segments(_split_picks(), []).values():
        source_litho_fid = UUID(group_segs[0].formation_id)
        borehole_segs = [seg for seg in group_segs if seg.kind == "borehole"]
        cpt_segs = [seg for seg in group_segs if seg.kind == "cpt"]
        for bh_seg in borehole_segs:
            bands, _body_ids, _donor_ids, _selection = use_case._plan_borehole_bands_litho_confined(
                inv_id=bh_seg.investigation_id,
                bh_x=bh_seg.x_m,
                bh_y=bh_seg.y_m,
                bh_surface_elev=bh_seg.surface_elev_m,
                geo_top_m=bh_seg.top_depth_m,
                geo_base_m=bh_seg.base_depth_m,
                litho_layer_top_m=bh_seg.top_depth_m,
                litho_layer_base_m=bh_seg.base_depth_m,
                cpt_segs=cpt_segs,
                litho_abs_min_class=5,
                geotech_layer_by_inv_depth=layers,
                cpt_xy=cpt_xy,
                cpt_names={UUID(_CPT_LEFT): "CPT-L", UUID(_CPT_RIGHT): "CPT-R"},
                section_placements=[_SECTION],
                unit_soil_code="ZAND",
            )
            planned.extend(
                PlannedBand(
                    depth_top_m=band.top,
                    depth_base_m=band.base,
                    nad_class=band.nad_class,
                    source=band.source,
                    confidence="high" if band.source == "cpt_interpolated" else "low",
                    body_id=None,
                    source_litho_formation_id=source_litho_fid,
                    source_geo_formation_id=None,
                    source_litho_layer_id=UUID(cast(str, bh_seg.litho_layer_id)),
                )
                for band in bands
            )
    if merge:
        return merge_geo_split_bands(planned)
    return sorted(planned, key=lambda b: b.depth_top_m)


def _spans_crossing_split(bands: list[PlannedBand]) -> list[PlannedBand]:
    """Bands whose interval strictly contains the split depth."""
    return [
        band
        for band in bands
        if band.depth_top_m < _SPLIT_M - 0.001 and band.depth_base_m > _SPLIT_M + 0.001
    ]


def test_the_planner_never_emits_a_band_across_the_split() -> None:
    """EMISSION step: the split at 14.52 is a boundary before any merge runs.

    Each borehole half is planned within its own litho-layer extent
    (``derive = unit_layer``, then ``clip_bands_to_slice``), so no emitted band
    can span the union of the two halves even though the flanking CPTs read one
    class across it.
    """
    raw = _plan_split(merge=False)

    boundaries = {round(b.depth_top_m, 3) for b in raw} | {round(b.depth_base_m, 3) for b in raw}
    assert _SPLIT_M in boundaries, (
        "the split at 14.52 m never appears as a band boundary -- the planner "
        f"emitted across it: {[(b.depth_top_m, b.depth_base_m, b.nad_class) for b in raw]}"
    )
    assert not _spans_crossing_split(raw), (
        "a raw emitted band spans the split: "
        f"{[(b.depth_top_m, b.depth_base_m, b.nad_class) for b in _spans_crossing_split(raw)]}"
    )


def test_if_a_layer_is_split_into_two_in_the_litho_then_it_stays_split_in_geotech() -> None:
    """After the full planning half (merge-back included) the split still stands.

    The flanking CPTs read class 7 on BOTH sides of 14.52, so a merge-back that
    keyed only on class + formation would weld the two class-7 halves into one
    band running through the litho contact (his b13 defect, here with one
    composition). The split's two layer ids keep them apart.
    """
    bands = _plan_split(merge=True)

    boundaries = {round(b.depth_top_m, 3) for b in bands} | {
        round(b.depth_base_m, 3) for b in bands
    }
    assert _SPLIT_M in boundaries, (
        "the split at 14.52 m is gone after the geotech divide: "
        f"{[(b.depth_top_m, b.depth_base_m, b.nad_class) for b in bands]}"
    )
    assert not _spans_crossing_split(bands), (
        "a packing band crosses the litho split: "
        f"{[(b.depth_top_m, b.depth_base_m, b.nad_class) for b in _spans_crossing_split(bands)]}"
    )


def test_each_band_names_the_litho_layer_it_lies_in() -> None:
    """Every band's ``source_litho_layer_id`` is the half it sits in, not the other."""
    bands = _plan_split(merge=True)

    for band in bands:
        expected = _LAYER_UPPER if band.depth_base_m <= _SPLIT_M + 0.001 else _LAYER_LOWER
        assert str(band.source_litho_layer_id) == expected, (
            f"band {band.depth_top_m}-{band.depth_base_m} names layer "
            f"{band.source_litho_layer_id}, not the split half it lies in"
        )
    assert {str(b.source_litho_layer_id) for b in bands} == {_LAYER_UPPER, _LAYER_LOWER}
