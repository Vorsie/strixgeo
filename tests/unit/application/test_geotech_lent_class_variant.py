"""A lent packing class never changes the receiver sand's NAD family.

Owner finding on installer #36 (borehole GEO-07/182-B2, geotech axis, verbatim):
*"this sand on B2 somehow got an admixture, while it did not have that in the
original litho"* — its clean litho sand rendered as ``ZAND(f)·D`` because the
flanking CPTs carry ``ZAND(f)·D`` and the borehole press copied their NAD class
number verbatim. The class number encodes the NAD table's silt-/kleihoudend
column, so a clean sand received a with-admixture class.

The rule (owner): *"a lent class never changes the sand's family"* — the lend
carries only the PACKING LEVEL (los / matig / dicht / zeer dicht), mapped into
the RECEIVER'S own column of the NAD table; the receiver's litho composition is
never rewritten. So a clean-sand borehole flanked by silt-/kleihoudend CPTs
takes the CLEAN class of the same packing level (secondary dicht 11 → clean
dicht 7), and a genuinely silty borehole keeps the secondary column.

Claims pinned here:
  LV1  The pure re-map keeps the packing LEVEL and swaps only the column, both
       ways (secondary → clean and clean → secondary), and for every soil.
  LV2  A class the table cannot place is returned unchanged (the soil clamp is
       the backstop, not this function).
  LV3  BEHAVIOUR — a clean-sand borehole lent dense + medium classes from
       silt-/kleihoudend flanks comes back in the CLEAN column at the SAME
       packing levels (this is the B2 bug, red-first).
  LV4  BEHAVIOUR — a genuinely silty (secondary) borehole keeps the secondary
       column: the re-map is receiver-family, not "always clean".
  LV5  With no receiver variant supplied (the family-clamp pins' call shape) the
       planner is byte-identical to before — the re-map is opt-in.
"""

from __future__ import annotations

from typing import cast
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.divide_boreholes import DivideBoreholes
from groundmodel.domain.services.borehole_flank_donors import SectionPlacement
from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.domain.services.nad_classifier import remap_class_to_variant, resolve_variant
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)
from groundmodel.domain.value_objects.admixture import Admixture

# Real class integers so a mis-wired lookup reads as a wrong label, not a
# passing tautology. ZAND: clean 5/6/7/8 (los/matig/dicht/zeer dicht),
# secondary 9/10/11/12. SILT: clean 13-16, secondary 17-20.
_ZAND_CLEAN_MATIG = 6
_ZAND_CLEAN_DICHT = 7
_ZAND_SECONDARY_MATIG = 10
_ZAND_SECONDARY_DICHT = 11


# ---------------------------------------------------------------------------
# LV1 / LV2 — the pure re-map
# ---------------------------------------------------------------------------


def test_lv1_secondary_sand_class_remaps_to_the_clean_class_of_the_same_level() -> None:
    """LV1 — dicht stays dicht, matig stays matig; only the column changes."""
    assert remap_class_to_variant(_ZAND_SECONDARY_DICHT, "clean") == _ZAND_CLEAN_DICHT
    assert remap_class_to_variant(_ZAND_SECONDARY_MATIG, "clean") == _ZAND_CLEAN_MATIG


def test_lv1_clean_sand_class_remaps_to_the_secondary_class_of_the_same_level() -> None:
    """LV1 — the map is symmetric: a clean donor onto a silty receiver."""
    assert remap_class_to_variant(_ZAND_CLEAN_DICHT, "secondary") == _ZAND_SECONDARY_DICHT
    assert remap_class_to_variant(_ZAND_CLEAN_MATIG, "secondary") == _ZAND_SECONDARY_MATIG


def test_lv1_every_soil_maps_level_for_level() -> None:
    """LV1 — silt/clay/gravel map by level too, and a same-column map is a no-op."""
    # SILT clean vrij vast (15) → secondary vrij vast (19).
    assert remap_class_to_variant(15, "secondary") == 19
    # KLEI secondary weinig vast (25) → clean weinig vast (21).
    assert remap_class_to_variant(25, "clean") == 21
    # Same column requested → unchanged.
    assert remap_class_to_variant(_ZAND_CLEAN_DICHT, "clean") == _ZAND_CLEAN_DICHT


def test_lv2_a_class_the_table_cannot_place_is_unchanged() -> None:
    """LV2 — a foreign/unknown class is left for the soil clamp, not guessed."""
    assert remap_class_to_variant(999, "clean") == 999


def test_resolve_variant_prefers_the_override_then_the_admixtures() -> None:
    """The receiver variant: forced answer first, else the admixture rule."""
    assert resolve_variant("ZAND", (), None) == "clean"
    assert resolve_variant("ZAND", (Admixture(soil_code="KL", amount="M"),), None) == "secondary"
    # A stored "pure" answer forces clean even with a clay admixture present.
    assert resolve_variant("ZAND", (Admixture(soil_code="KL", amount="M"),), "clean") == "clean"


# ---------------------------------------------------------------------------
# LV3 / LV4 / LV5 — the borehole planner
# ---------------------------------------------------------------------------


def _use_case() -> DivideBoreholes:
    """The planner never queries in these paths — in-memory inputs only."""
    return DivideBoreholes(cast(AsyncSession, None))


def _cpt_pick(investigation_id: str, top: float, base: float) -> BodyLayerPick:
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


def _partition(
    columns: list[tuple[str, float]], regions: list[RegionInput]
) -> SectionPartitionInput:
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


def _plan_between_silty_flanks(
    *,
    upper_class: int,
    lower_class: int,
    receiver_variant: str | None,
) -> list:
    """Plan a clean-sand borehole standing between two flanking CPTs.

    The gap holds an upper band over a lower one, split at elevation 1.0 m; the
    borehole stands halfway across an 8 m sand unit of its own, so the split
    lands 4 m down it. ``upper_class`` / ``lower_class`` are the CPTs' own
    (silt-/kleihoudend) packing classes; ``receiver_variant`` is the borehole
    litho unit's own column.
    """
    upper_formation, lower_formation = str(uuid7()), str(uuid7())
    cpt_a, cpt_b, borehole = str(uuid7()), str(uuid7()), str(uuid7())
    partition = _partition(
        columns=[(cpt_a, 0.0), (cpt_b, 600.0)],
        regions=[
            RegionInput(
                formation_id=upper_formation,
                body_id=None,
                polygon=((0.0, 5.0), (1.0, 5.0), (1.0, 1.0), (0.0, 1.0)),
                gap_index=0,
                kind="quad",
                layer_ids=("upper-A", "upper-B"),
            ),
            RegionInput(
                formation_id=lower_formation,
                body_id=None,
                polygon=((0.0, 1.0), (1.0, 1.0), (1.0, -3.0), (0.0, -3.0)),
                gap_index=0,
                kind="quad",
                layer_ids=("lower-A", "lower-B"),
            ),
        ],
    )
    section = SectionPlacement(
        section_id=str(uuid7()),
        section_name="A-A",
        along_m={cpt_a: 0.0, borehole: 300.0, cpt_b: 600.0},
    )
    kwargs = dict(
        inv_id=borehole,
        bh_x=300.0,
        bh_y=0.0,
        bh_surface_elev=5.0,
        geo_top_m=0.0,
        geo_base_m=8.0,
        cpt_segs=[_cpt_pick(cpt_a, 0.0, 8.0), _cpt_pick(cpt_b, 0.0, 8.0)],
        litho_abs_min_class=_ZAND_CLEAN_MATIG if receiver_variant != "secondary" else 9,
        geotech_layer_by_inv_depth={},
        cpt_xy={UUID(cpt_a): (0.0, 0.0, 5.0), UUID(cpt_b): (600.0, 0.0, 5.0)},
        cpt_names={UUID(cpt_a): "CPT-A", UUID(cpt_b): "CPT-B"},
        section_placements=[section],
        section_partitions={UUID(section.section_id): partition},
        geotech_formation_info={
            upper_formation: (upper_class, uuid7(), None),
            lower_formation: (lower_class, uuid7(), None),
        },
        unit_soil_code="ZAND",
    )
    if receiver_variant is not None:
        kwargs["receiver_variant"] = receiver_variant
    bands, _body_ids, _correspondences, _selection = (
        _use_case()._plan_borehole_bands_litho_confined(**kwargs)
    )
    return bands


def test_lv3_a_clean_sand_borehole_takes_the_clean_class_of_the_lent_level() -> None:
    """LV3 — the B2 bug: silt-/kleihoudend flanks, clean borehole → clean column.

    The flanks read dense (11) over medium dense (10) silt-/kleihoudend sand.
    The borehole's own litho sand is clean, so its bands must come back dense (7)
    over medium dense (6) in the CLEAN column — the same packing levels, never
    the with-admixture ``ZAND(f)`` classes.
    """
    bands = _plan_between_silty_flanks(
        upper_class=_ZAND_SECONDARY_DICHT,
        lower_class=_ZAND_SECONDARY_MATIG,
        receiver_variant="clean",
    )
    classes = [b.nad_class for b in bands]
    assert _ZAND_SECONDARY_DICHT not in classes and _ZAND_SECONDARY_MATIG not in classes, (
        f"a clean sand kept a silt-/kleihoudend (ZAND(f)) class: {classes}"
    )
    assert classes == [_ZAND_CLEAN_DICHT, _ZAND_CLEAN_MATIG]


def test_lv4_a_silty_sand_borehole_keeps_the_secondary_column() -> None:
    """LV4 — the re-map is receiver-family, not "always clean".

    A borehole whose own litho sand IS silt-/kleihoudend keeps the secondary
    classes lent to it.
    """
    bands = _plan_between_silty_flanks(
        upper_class=_ZAND_SECONDARY_DICHT,
        lower_class=_ZAND_SECONDARY_MATIG,
        receiver_variant="secondary",
    )
    assert [b.nad_class for b in bands] == [_ZAND_SECONDARY_DICHT, _ZAND_SECONDARY_MATIG]


def test_lv5_no_receiver_variant_is_byte_identical_to_before() -> None:
    """LV5 — the re-map is opt-in; the old call shape is unchanged."""
    bands = _plan_between_silty_flanks(
        upper_class=_ZAND_SECONDARY_DICHT,
        lower_class=_ZAND_SECONDARY_MATIG,
        receiver_variant=None,
    )
    assert [b.nad_class for b in bands] == [_ZAND_SECONDARY_DICHT, _ZAND_SECONDARY_MATIG]
