"""No writer may put a packing class on ground of another soil.

Owner ruling 2026-08-26: *"no a zand body can never carry a silt packing
class"*, reinforced the same day as *"the nad coupling is absolute."*

The domain predicate is pinned in
``tests/unit/domain/services/test_nad_soil_family_coupling.py``. These pins are
about the WRITERS — the paths that pick a class and hand it to a band — and
about the structure that keeps a future writer from re-opening the hole.

Claims pinned here:
  FC1  The section-geometry sampler will not read a class off a region of
       another soil. The 2-D fill can flood a clay into the gap a sand
       borehole stands in (the owner's B8, 2026-08-24); the flood is a
       statement about the clay, and it is not evidence about this sand.
  FC2  A same-soil region is read exactly as before — the clamp is a filter
       on foreign evidence, not a new rule about how geometry is sampled.
  FC3  Dropping the foreign cut does not leave a hole: the column still tiles
       its litho extent, because the ground the clay was covering falls to
       the same conservative floor as any ground no column spoke for (owner
       ruling 2026-08-17: *"the sand on B4 has no neighbours so it should
       default to the lowest packing class on B4"*).
  FC4  A borehole whose litho soil is unknown keeps today's answer — there is
       no family to judge the region against, so the sampler is not entitled
       to discard it.
  FC5  STRUCTURAL. A geotech formation carrying a packing class is created in
       exactly ONE place in the codebase, and that place applies the clamp.
       A new writer that mints one elsewhere fails this pin by construction,
       whatever class it happens to choose.
"""

from __future__ import annotations

import ast
import inspect
from pathlib import Path
from typing import cast
from uuid import UUID

import pytest
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

import groundmodel
from groundmodel.api.schemas.project.geological_formation import (
    GeologicalFormationCreateRequest,
)
from groundmodel.application.divide_boreholes import DivideBoreholes
from groundmodel.application.geotech_borehole_materialiser import GeotechBoreholeMaterialiser
from groundmodel.domain.services.borehole_flank_donors import SectionPlacement
from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)

# Real class integers, so a mis-wired lookup reads as a wrong label rather than
# a passing tautology. 5/7 are ZAND (loose / dense); 21 is KLEI, the family the
# owner's B8 flood put on a sand column.
_ZAND_LOOSE = 5
_ZAND_DENSE = 7
_KLEI_SLIGHTLY_FIRM = 21


def _use_case() -> DivideBoreholes:
    """The planner never queries — these paths take only in-memory inputs."""
    return DivideBoreholes(cast(AsyncSession, None))


def _cpt_pick(investigation_id: str, top: float, base: float) -> BodyLayerPick:
    """One CPT's litho pick over the shared unit."""
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


def _two_band_scene(
    upper_formation: str, lower_formation: str
) -> tuple[SectionPartitionInput, SectionPlacement, str, str, str]:
    """A gap holding an upper band over a lower one, split at elevation 1.0 m.

    The borehole stands halfway across with an 8 m unit of its own, so the
    split lands 4 m down it when both regions are read.
    """
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
    return partition, section, cpt_a, cpt_b, borehole


def _plan_over_scene(
    *,
    upper_class: int,
    lower_class: int,
    unit_soil_code: str | None,
) -> list:
    """Plan the halfway borehole's bands off the two-band scene."""
    upper_formation, lower_formation = str(uuid7()), str(uuid7())
    partition, section, cpt_a, cpt_b, borehole = _two_band_scene(upper_formation, lower_formation)
    bands, _body_ids, _correspondences, _selection = (
        _use_case()._plan_borehole_bands_litho_confined(
            inv_id=borehole,
            bh_x=300.0,
            bh_y=0.0,
            bh_surface_elev=5.0,
            geo_top_m=0.0,
            geo_base_m=8.0,
            cpt_segs=[_cpt_pick(cpt_a, 0.0, 8.0), _cpt_pick(cpt_b, 0.0, 8.0)],
            litho_abs_min_class=_ZAND_LOOSE,
            geotech_layer_by_inv_depth={},
            cpt_xy={UUID(cpt_a): (0.0, 0.0, 5.0), UUID(cpt_b): (600.0, 0.0, 5.0)},
            cpt_names={UUID(cpt_a): "CPT-A", UUID(cpt_b): "CPT-B"},
            section_placements=[section],
            section_partitions={UUID(section.section_id): partition},
            geotech_formation_info={
                upper_formation: (upper_class, uuid7(), None),
                lower_formation: (lower_class, uuid7(), None),
            },
            unit_soil_code=unit_soil_code,
        )
    )
    return bands


# ---------------------------------------------------------------------------
# FC1 / FC2 / FC3 — the section-geometry sampler
# ---------------------------------------------------------------------------


def test_fc1_a_clay_region_is_not_read_onto_a_sand_borehole() -> None:
    """FC1 — the flood in the gap says nothing about the sand standing in it.

    The lower half of the gap is a KLEI region (NAD 21). The borehole's own
    litho unit is ZAND, so that region is not evidence here and no band of
    this column may come back carrying a clay class.
    """
    bands = _plan_over_scene(
        upper_class=_ZAND_DENSE,
        lower_class=_KLEI_SLIGHTLY_FIRM,
        unit_soil_code="ZAND",
    )
    assert _KLEI_SLIGHTLY_FIRM not in [b.nad_class for b in bands]


def test_fc2_a_sand_region_is_still_read_exactly_as_before() -> None:
    """FC2 — same-family evidence keeps today's answer, split and all."""
    bands = _plan_over_scene(
        upper_class=_ZAND_LOOSE,
        lower_class=_ZAND_DENSE,
        unit_soil_code="ZAND",
    )
    assert [b.nad_class for b in bands] == [_ZAND_LOOSE, _ZAND_DENSE]
    assert bands[0].base == pytest.approx(4.0)


def test_fc3_the_column_still_tiles_its_extent_after_the_clay_is_dropped() -> None:
    """FC3 — the ground the clay covered falls to the column's own floor.

    A ``litho_layer`` column must tile its extent exactly (the DB trigger
    refuses the whole transaction otherwise), so dropping a cut must never
    leave a hole — it leaves ground that no column spoke for, which is what
    the conservative floor is for.
    """
    bands = _plan_over_scene(
        upper_class=_ZAND_DENSE,
        lower_class=_KLEI_SLIGHTLY_FIRM,
        unit_soil_code="ZAND",
    )
    assert bands, "the column must still be planned, not abandoned"
    assert (bands[0].top, bands[-1].base) == (0.0, 8.0)
    for earlier, later in zip(bands, bands[1:]):
        assert earlier.base == pytest.approx(later.top)
    for band in bands:
        assert band.nad_class in range(5, 13), f"class {band.nad_class} is not a ZAND class"


def test_fc4_an_unknown_soil_cannot_convict_a_region() -> None:
    """FC4 — with no family to judge against, the sampler keeps today's answer.

    ``unit_soil_code=None`` is how every caller that has no soil to offer
    reaches this method (and how the existing sampler pins call it). The
    clamp must be silent there rather than discarding evidence on a suspicion.
    """
    bands = _plan_over_scene(
        upper_class=_ZAND_LOOSE,
        lower_class=_KLEI_SLIGHTLY_FIRM,
        unit_soil_code=None,
    )
    assert [b.nad_class for b in bands] == [_ZAND_LOOSE, _KLEI_SLIGHTLY_FIRM]


# ---------------------------------------------------------------------------
# FC5 — the structural pin
# ---------------------------------------------------------------------------

# Every module that constructs a geotech ``GeologicalFormationOrm`` carrying a
# packing class, and why it is allowed to.
#
# ``geotech_borehole_materialiser`` is the find-or-create every geotech writer
# goes through — SubdivideAllBodies, DivideBoreholes, and each band-edit verb
# inherit or call it — so clamping there covers all of them at once.
#
# ``geology_repository`` is the generic formation writer behind ``POST`` and
# ``PATCH /formations``. It takes the class from the caller and is guarded one
# layer up instead: the create request validates the coupling itself (both
# fields arrive together) and the PATCH route checks the class against the
# stored row's soil. Both answer 422 — pinned below.
#
# ``bundle_restore_core`` is deliberately absent from the clamp rather than
# from this list: it replays rows a .strix already holds, and a file written
# before this ruling must still open (see docs/backwards-compat.md). It writes
# ``**kwargs`` off the bundle, never a class it chose, so it is not a writer in
# the sense this pin polices.
_CLASS_MINTING_MODULES = {"geotech_borehole_materialiser.py", "geology_repository.py"}


def _formation_constructions_with_a_class() -> dict[str, int]:
    """Source files constructing ``GeologicalFormationOrm(nad_class=...)``, counted."""
    package_root = Path(inspect.getfile(groundmodel)).parent
    found: dict[str, int] = {}
    for path in package_root.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            callee = node.func
            if not (isinstance(callee, ast.Name) and callee.id == "GeologicalFormationOrm"):
                continue
            if any(kw.arg == "nad_class" for kw in node.keywords):
                found[path.name] = found.get(path.name, 0) + 1
    return found


def test_fc5_a_packing_class_is_minted_in_exactly_one_place() -> None:
    """FC5 — the coupling is absolute, so it is enforced at one door, not many.

    This pin fails the moment any module other than the materialiser mints a
    classified geotech formation — before anyone has to notice that the class
    it chose came from the wrong soil. A new writer is not forbidden; it is
    required to come back here and say why it does not need the clamp.
    """
    assert set(_formation_constructions_with_a_class()) == _CLASS_MINTING_MODULES


def test_fc5_that_one_place_applies_the_clamp() -> None:
    """FC5 — and the door actually holds: the clamp is called on the way in."""
    source = inspect.getsource(GeotechBoreholeMaterialiser)
    assert "clamp_class_to_soil" in source, (
        "GeotechBoreholeMaterialiser mints every classified geotech formation; "
        "it must clamp the class to the source litho unit's soil family."
    )


# ---------------------------------------------------------------------------
# FC6 — the other minting door: the formation API
# ---------------------------------------------------------------------------


def test_fc6_creating_a_sand_unit_with_a_silt_class_is_refused() -> None:
    """FC6 — the request carries both halves, so it can refuse itself.

    A packing class describes one soil column. Asking for a ZAND unit that
    carries NAD 14 is asking for a row that contradicts itself, and the answer
    names the family rather than the field.
    """
    with pytest.raises(ValidationError) as caught:
        GeologicalFormationCreateRequest(
            name="Sand unit",
            nad_class=_KLEI_SLIGHTLY_FIRM,
            litho_main_soil_code="ZAND",
        )
    message = str(caught.value)
    assert "KLEI" in message and "ZAND" in message
    assert "absolute" in message


def test_fc6_creating_a_sand_unit_with_a_sand_class_still_works() -> None:
    """FC6 — the guard is a filter on foreign classes, not a new obstacle."""
    request = GeologicalFormationCreateRequest(
        name="Sand unit",
        nad_class=_ZAND_DENSE,
        litho_main_soil_code="ZAND",
    )
    assert request.nad_class == _ZAND_DENSE


def test_fc6_a_geological_formation_carries_neither_and_is_untouched() -> None:
    """FC6 — most formations have no class and no soil; nothing to couple."""
    request = GeologicalFormationCreateRequest(name="Formation of Kortrijk")
    assert (request.nad_class, request.litho_main_soil_code) == (None, None)
