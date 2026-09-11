"""A packing band never crosses the contact between two different litho units.

Owner dogfeed, 2026-09-11 (installer #32, borehole GEO-52/110/14-b13): *"i
subdivided the borehole in sand with a glauconitic sand below but the litho
split between these sand shifted upwards after subdivide boreholes according to
packing on geotech stage."*

His column, collar +14.30, after "Divide boreholes":

===========================  =========================================
litho (accepted)             geotech bands he got
===========================  =========================================
11.40-14.52 ZAND             11.40-12.93 NAD 6   src_litho = clean sand
14.52-25.00 ZAND (GL)        12.93-19.72 NAD 7   src_litho = clean sand
(same two units)             19.72-25.00 NAD 6   src_litho = clean sand
===========================  =========================================

Every band names the CLEAN sand as its source litho unit, the glauconitic unit
below got no band of its own, and the middle band runs straight through his
14.52 m contact — so on screen the split looked like it had moved up to 12.93,
which is a tie interpolation, not a litho boundary.

The rule these cases pin is the one the CPT axis already follows (seam identity
= soil | class | admixture, 2026-09-07, *"ZAND-VD / ZAND(f)-VD draw their
contact"*): a packing band belongs to ONE litho unit, admixture included, and
each band's ``source_litho_formation_id`` is the formation of the litho layer it
lies in.

The chain the cases walk is the press's own: ``_group_segments`` decides the
planning unit, the planner lays the flanking CPTs' packing onto each unit, the
bands are stamped with their unit's litho formation, and
``merge_geo_split_bands`` collapses same-class neighbours INSIDE one unit.  Only
the database reads are left out — every function here is the shipped one.
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
_GLAUCONITE_TOP_M = 14.52
_COLUMN_BASE_M = 25.00
# The two class changes the flanking CPTs read inside that sand.
_UPPER_CHANGE_M = 12.93
_LOWER_CHANGE_M = 19.72

# NAD 6 / 7 = medium dense / dense sand — his own two classes.
_NAD_6 = 6
_NAD_7 = 7

# One body: the litho resolver merges admixture variants of the SAME soil
# (``resolve_litho_instances.same_mass`` — "Admixture variants of the SAME soil
# (different formation rows, same ``litho_main_soil_code``) still merge"), so
# his clean sand and his glauconitic sand share a body id while carrying two
# different formation rows.  That is the shape this whole module is about.
_BODY_SAND = "BODY-ZAND"
_F_SAND = str(uuid7())
"""The clean ZAND litho formation — his ``d9b840``."""
_F_SAND_GL = str(uuid7())
"""The glauconitic ZAND litho formation his "Edit composition" minted."""

_BOREHOLE = str(uuid7())
_CPT_LEFT = str(uuid7())
_CPT_RIGHT = str(uuid7())

_SECTION = SectionPlacement(
    section_id=str(uuid7()),
    section_name="A-A'",
    along_m={_CPT_LEFT: 0.0, _BOREHOLE: 100.0, _CPT_RIGHT: 200.0},
)


def _pick(investigation: str, formation: str, top: float, base: float, kind: str) -> BodyLayerPick:
    """One accepted litho layer as the geotech stage reads it.

    Parameters
    ----------
    investigation : str
        The borehole/CPT id the layer is anchored to.
    formation : str
        The layer's OWN litho formation row.
    top, base : float
        Layer extent, metres below the collar.
    kind : str
        ``"borehole"`` or ``"cpt"``.

    Returns
    -------
    BodyLayerPick
        The pick, in the single sand body every column here shares.
    """
    return BodyLayerPick(
        investigation_id=investigation,
        x_m={_CPT_LEFT: 0.0, _BOREHOLE: 100.0, _CPT_RIGHT: 200.0}[investigation],
        y_m=0.0,
        surface_elev_m=_COLLAR_M,
        body_id=_BODY_SAND,
        formation_id=formation,
        top_depth_m=top,
        base_depth_m=base,
        kind=kind,
        litho_layer_id=str(uuid7()),
    )


def _b13_picks() -> list[BodyLayerPick]:
    """His b13 sand plus the two CPTs that flank it, clean sand first.

    Returns
    -------
    list[BodyLayerPick]
        Six picks — each column's clean sand over its glauconitic sand.  The
        clean sand leads the list because the press reads the group's FIRST
        segment for the litho formation, and his ``d9b840`` is the clean one.
    """
    return [
        _pick(_BOREHOLE, _F_SAND, _SAND_TOP_M, _GLAUCONITE_TOP_M, "borehole"),
        _pick(_CPT_LEFT, _F_SAND, _SAND_TOP_M, _GLAUCONITE_TOP_M, "cpt"),
        _pick(_CPT_RIGHT, _F_SAND, _SAND_TOP_M, _GLAUCONITE_TOP_M, "cpt"),
        _pick(_BOREHOLE, _F_SAND_GL, _GLAUCONITE_TOP_M, _COLUMN_BASE_M, "borehole"),
        _pick(_CPT_LEFT, _F_SAND_GL, _GLAUCONITE_TOP_M, _COLUMN_BASE_M, "cpt"),
        _pick(_CPT_RIGHT, _F_SAND_GL, _GLAUCONITE_TOP_M, _COLUMN_BASE_M, "cpt"),
    ]


def _cpt_geotech_layers() -> dict[str, list[tuple[float, float, UUID, UUID, int | None, UUID]]]:
    """Both flanking CPTs' packing bands: 6 / 7 across 12.93, 7 / 6 across 19.72.

    Returns
    -------
    dict
        ``investigation id -> [(top, base, layer_id, formation_id, nad_class,
        body_id)]`` — the index the planner reads donor packing from.
    """
    body_6, body_7 = uuid7(), uuid7()
    return {
        cpt: [
            (_SAND_TOP_M, _UPPER_CHANGE_M, uuid7(), uuid7(), _NAD_6, body_6),
            (_UPPER_CHANGE_M, _GLAUCONITE_TOP_M, uuid7(), uuid7(), _NAD_7, body_7),
            (_GLAUCONITE_TOP_M, _LOWER_CHANGE_M, uuid7(), uuid7(), _NAD_7, body_7),
            (_LOWER_CHANGE_M, _COLUMN_BASE_M, uuid7(), uuid7(), _NAD_6, body_6),
        ]
        for cpt in (_CPT_LEFT, _CPT_RIGHT)
    }


def _divide_b13() -> list[PlannedBand]:
    """Run the press's own chain over b13 and return the column it would write.

    Mirrors ``DivideBoreholes.plan``'s planning half with the database reads
    removed: group the picks, plan each borehole segment against its flanking
    CPTs, stamp every band with its group's litho formation — the transcription
    is the product line verbatim,
    ``source_litho_fid = UUID(group_segs[0].formation_id)`` — and merge back
    the same-class neighbours inside one litho unit.

    Returns
    -------
    list[PlannedBand]
        b13's bands, top to bottom.
    """
    use_case = DivideBoreholes(cast(AsyncSession, None))
    picks = _b13_picks()
    layers = _cpt_geotech_layers()
    cpt_xy = {
        UUID(_CPT_LEFT): (0.0, 0.0, _COLLAR_M),
        UUID(_CPT_RIGHT): (200.0, 0.0, _COLLAR_M),
    }

    planned: list[PlannedBand] = []
    # No geological parent model in this fixture: every pick is labelled None,
    # exactly as ``_group_segments`` does when the litho model has no parent.
    for group_segs in use_case._group_segments(picks, []).values():
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
    return merge_geo_split_bands(planned)


def test_b13_the_litho_split_between_these_sands_must_not_shift_after_divide_boreholes() -> None:
    """His 14.52 m contact is still a band boundary, and no band runs through it.

    The band he saw, 12.93-19.72, is the failure: it starts at a tie
    interpolation and ends at another one, and the litho contact in between has
    vanished.
    """
    bands = _divide_b13()

    boundaries = {round(band.depth_top_m, 3) for band in bands} | {
        round(band.depth_base_m, 3) for band in bands
    }
    assert _GLAUCONITE_TOP_M in boundaries, (
        "the litho split at 14.52 m is gone from the geotech column: "
        f"{[(b.depth_top_m, b.depth_base_m, b.nad_class) for b in bands]}"
    )
    crossing = [
        band
        for band in bands
        if band.depth_top_m < _GLAUCONITE_TOP_M - 0.001
        and band.depth_base_m > _GLAUCONITE_TOP_M + 0.001
    ]
    assert not crossing, f"a packing band crosses the litho contact: {crossing}"


def test_b13_the_glauconitic_unit_gets_its_own_bands() -> None:
    """Each band names the litho unit it lies in — the GL one included.

    He got the clean sand stamped on all three bands, so the glauconitic unit
    owned nothing on its own column and could never receive its own geotech
    formation rows (they are found-or-created on
    ``(nad_class, source_litho_formation_id)``).
    """
    bands = _divide_b13()

    for band in bands:
        expected = _F_SAND if band.depth_base_m <= _GLAUCONITE_TOP_M + 0.001 else _F_SAND_GL
        assert str(band.source_litho_formation_id) == expected, (
            f"band {band.depth_top_m}-{band.depth_base_m} names "
            f"{band.source_litho_formation_id}, not the unit it lies in"
        )
    assert {str(band.source_litho_formation_id) for band in bands} == {_F_SAND, _F_SAND_GL}


def test_b13_the_flanking_cpts_class_changes_are_the_only_other_boundaries() -> None:
    """Four bands: 6 | 7 across 12.93, then 7 | 6 across 19.72, cut at 14.52.

    The whole column in one assertion, so a fix that keeps the contact by
    dropping a class change would not read as a pass.
    """
    assert [
        (round(band.depth_top_m, 2), round(band.depth_base_m, 2), band.nad_class)
        for band in _divide_b13()
    ] == [
        (_SAND_TOP_M, _UPPER_CHANGE_M, _NAD_6),
        (_UPPER_CHANGE_M, _GLAUCONITE_TOP_M, _NAD_7),
        (_GLAUCONITE_TOP_M, _LOWER_CHANGE_M, _NAD_7),
        (_LOWER_CHANGE_M, _COLUMN_BASE_M, _NAD_6),
    ]


def test_a_planning_group_never_mixes_two_litho_formations() -> None:
    """The assumption both presses make — "all segs share one" — must hold.

    ``DivideBoreholes`` and ``SubdivideAllBodies`` each read
    ``group_segs[0].formation_id`` as THE litho formation of the group.  A body
    that spans two admixture variants of one soil makes that read a lie, and
    every band of the group is then stamped with whichever formation happened to
    be first.
    """
    groups = DivideBoreholes(cast(AsyncSession, None))._group_segments(_b13_picks(), [])

    for key, group_segs in groups.items():
        assert len({seg.formation_id for seg in group_segs}) == 1, (
            f"group {key} mixes litho formations: {sorted({s.formation_id for s in group_segs})}"
        )


def test_one_litho_unit_across_three_columns_is_still_one_planning_group() -> None:
    """The guard against over-splitting: the same formation stays one group.

    A planning group is a body's ONE litho unit — splitting it per column would
    strand every borehole with no flanking donor at all.
    """
    clean_sand_only = [pick for pick in _b13_picks() if pick.formation_id == _F_SAND]

    groups = DivideBoreholes(cast(AsyncSession, None))._group_segments(clean_sand_only, [])

    assert len(groups) == 1
    ((group_segs),) = groups.values()
    assert len(group_segs) == 3
