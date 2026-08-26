"""Gap-local fractions become absolute along-distances, or they are dropped.

``BuildSectionPolygons`` is the join between the renderer's drawn fill
(fractions inside one gap) and the D-Series exporters (metres along the
section line). The rules it encodes:

* fraction 0 is the gap's LEFT column and fraction 1 its RIGHT column,
  and the conversion is linear in the columns' own ``along_m`` — the
  same mapping the 3-D voxel builder uses, so a D-Stability export and a
  3-D build of one section describe the same ground;
* a region naming a gap the partition does not have, or a formation the
  project does not have, is DROPPED and counted — a partition can
  outlive the model it was drawn against;
* only units that actually fill something are declared.

The DB is mocked here: this test is about the conversion, and the
scope guards it inherits are exercised by the integration suite.
"""

from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID

import pytest

from groundmodel.application.build_section_polygons import BuildSectionPolygons
from groundmodel.application.section_snapshot import SectionSnapshot
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)

_PROJECT_ID = UUID("11111111-1111-1111-1111-111111111111")
_SECTION_ID = UUID("22222222-2222-2222-2222-222222222222")
_SAND_ID = UUID("33333333-3333-3333-3333-333333333333")
_CLAY_ID = UUID("44444444-4444-4444-4444-444444444444")


def _formation(
    formation_id: UUID,
    name: str,
    *,
    nad_class: int | None = None,
    soil: str | None = None,
    display_order: int = 0,
) -> SimpleNamespace:
    """A stand-in for the ORM row the repository returns."""
    return SimpleNamespace(
        id=formation_id,
        name=name,
        nad_class=nad_class,
        litho_main_soil_code=soil,
        color="#e8c56a",
        display_order=display_order,
    )


def _snapshot() -> SectionSnapshot:
    return SectionSnapshot(
        project_id=_PROJECT_ID,
        project_name="Quay 7",
        section_id=_SECTION_ID,
        section_name="A–A'",
        section_length_m=100.0,
        crs_epsg=31370,
        vertical_datum_label="m TAW",
    )


def _partition(regions: tuple[RegionInput, ...]) -> SectionPartitionInput:
    """Three columns at 10 m / 50 m / 90 m along a 100 m section."""
    return SectionPartitionInput(
        start_x=0.0,
        start_y=0.0,
        end_x=100.0,
        end_y=0.0,
        columns=(
            SectionColumnInput(investigation_id="c0", along_m=10.0, world_x=10.0, world_y=0.0),
            SectionColumnInput(investigation_id="c1", along_m=50.0, world_x=50.0, world_y=0.0),
            SectionColumnInput(investigation_id="c2", along_m=90.0, world_x=90.0, world_y=0.0),
        ),
        regions=regions,
    )


class _StubRepository:
    """Returns a fixed formation list; records the project it was asked for."""

    def __init__(self, formations: list[SimpleNamespace]) -> None:
        self._formations = formations
        self.asked_for: UUID | None = None

    async def list_formations(self, app_project_id: UUID) -> list[SimpleNamespace]:
        self.asked_for = app_project_id
        return self._formations


def _build(
    regions: tuple[RegionInput, ...],
    formations: list[SimpleNamespace],
) -> tuple[object, _StubRepository]:
    repository = _StubRepository(formations)
    use_case = BuildSectionPolygons(session=None, formation_repository=repository)  # type: ignore[arg-type]
    return use_case, repository


# --- happy path -------------------------------------------------------


@pytest.mark.asyncio
async def test_bp1_fraction_zero_is_the_left_column_and_one_is_the_right() -> None:
    """Gap 0 spans 10 m to 50 m, so f=0 lands at 10 m and f=1 at 50 m."""
    region = RegionInput(
        formation_id=str(_SAND_ID),
        body_id="b1",
        polygon=((0.0, 5.0), (1.0, 4.0), (1.0, -1.0), (0.0, 0.0)),
        gap_index=0,
    )
    use_case, _ = _build((region,), [_formation(_SAND_ID, "Zand", nad_class=6, soil="ZAND")])

    result = await use_case.execute(snapshot=_snapshot(), partition=_partition((region,)))

    assert result.polygons[0].points == (
        (10.0, 5.0),
        (50.0, 4.0),
        (50.0, -1.0),
        (10.0, 0.0),
    )


@pytest.mark.asyncio
async def test_bp2_a_mid_gap_fraction_interpolates_linearly_in_along_distance() -> None:
    """Half-way across gap 1 (50 m to 90 m) is 70 m, not 50 m of the section."""
    region = RegionInput(
        formation_id=str(_SAND_ID),
        body_id=None,
        polygon=((0.0, 0.0), (0.5, 0.0), (0.5, -5.0), (0.0, -5.0)),
        gap_index=1,
    )
    use_case, _ = _build((region,), [_formation(_SAND_ID, "Zand", nad_class=6, soil="ZAND")])

    result = await use_case.execute(snapshot=_snapshot(), partition=_partition((region,)))

    assert {point[0] for point in result.polygons[0].points} == {50.0, 70.0}


@pytest.mark.asyncio
async def test_bp3_the_unit_carries_its_characterisation_from_the_formation_row() -> None:
    """NAD class and soil code are pass-through, not derived here."""
    region = RegionInput(
        formation_id=str(_CLAY_ID),
        body_id=None,
        polygon=((0.0, 0.0), (1.0, 0.0), (1.0, -5.0), (0.0, -5.0)),
        gap_index=0,
    )
    use_case, repository = _build(
        (region,),
        [_formation(_CLAY_ID, "Klei — NAD 21", nad_class=21, soil="KLEI", display_order=2)],
    )

    result = await use_case.execute(snapshot=_snapshot(), partition=_partition((region,)))

    assert repository.asked_for == _PROJECT_ID
    unit = result.units[0]
    assert unit.name == "Klei — NAD 21"
    assert unit.nad_class == 21
    assert unit.litho_main_soil_code == "KLEI"


@pytest.mark.asyncio
async def test_bp4_the_section_metadata_rides_through_from_the_snapshot() -> None:
    """The exporters name the project and the datum from this."""
    region = RegionInput(
        formation_id=str(_SAND_ID),
        body_id=None,
        polygon=((0.0, 0.0), (1.0, 0.0), (1.0, -5.0), (0.0, -5.0)),
        gap_index=0,
    )
    use_case, _ = _build((region,), [_formation(_SAND_ID, "Zand")])

    result = await use_case.execute(snapshot=_snapshot(), partition=_partition((region,)))

    assert result.project_name == "Quay 7"
    assert result.section_name == "A–A'"
    assert result.section_length_m == 100.0
    assert result.vertical_datum_label == "m TAW"
    assert result.column_positions_m == (10.0, 50.0, 90.0)


@pytest.mark.asyncio
async def test_bp5_units_are_ordered_by_display_order_then_name() -> None:
    """The engineer's top-to-bottom sequence carries into the export."""
    regions = (
        RegionInput(
            formation_id=str(_CLAY_ID),
            body_id=None,
            polygon=((0.0, -5.0), (1.0, -5.0), (1.0, -9.0), (0.0, -9.0)),
            gap_index=0,
        ),
        RegionInput(
            formation_id=str(_SAND_ID),
            body_id=None,
            polygon=((0.0, 0.0), (1.0, 0.0), (1.0, -5.0), (0.0, -5.0)),
            gap_index=0,
        ),
    )
    use_case, _ = _build(
        regions,
        [
            _formation(_CLAY_ID, "Klei", display_order=2),
            _formation(_SAND_ID, "Zand", display_order=1),
        ],
    )

    result = await use_case.execute(snapshot=_snapshot(), partition=_partition(regions))

    assert [unit.name for unit in result.units] == ["Zand", "Klei"]


# --- structural error paths -------------------------------------------


@pytest.mark.asyncio
async def test_bp6_a_region_naming_a_gap_the_partition_does_not_have_is_dropped() -> None:
    """Three columns give two gaps; gap 5 belongs to a partition that moved on."""
    stray = RegionInput(
        formation_id=str(_SAND_ID),
        body_id=None,
        polygon=((0.0, 0.0), (1.0, 0.0), (1.0, -5.0), (0.0, -5.0)),
        gap_index=5,
    )
    use_case, _ = _build((stray,), [_formation(_SAND_ID, "Zand")])

    result = await use_case.execute(snapshot=_snapshot(), partition=_partition((stray,)))

    assert result.polygons == ()
    assert result.units == ()


@pytest.mark.asyncio
async def test_bp7_a_region_naming_a_formation_the_project_lost_is_dropped() -> None:
    """A partition outlives the model it was drawn against."""
    orphan = RegionInput(
        formation_id=str(_CLAY_ID),
        body_id=None,
        polygon=((0.0, 0.0), (1.0, 0.0), (1.0, -5.0), (0.0, -5.0)),
        gap_index=0,
    )
    use_case, _ = _build((orphan,), [_formation(_SAND_ID, "Zand")])

    result = await use_case.execute(snapshot=_snapshot(), partition=_partition((orphan,)))

    assert result.polygons == ()


@pytest.mark.asyncio
async def test_bp8_a_region_whose_formation_id_is_not_a_uuid_is_dropped() -> None:
    """The payload is user-supplied JSON; a non-UUID must not crash the export."""
    malformed = RegionInput(
        formation_id="not-a-uuid",
        body_id=None,
        polygon=((0.0, 0.0), (1.0, 0.0), (1.0, -5.0), (0.0, -5.0)),
        gap_index=0,
    )
    use_case, _ = _build((malformed,), [_formation(_SAND_ID, "Zand")])

    result = await use_case.execute(snapshot=_snapshot(), partition=_partition((malformed,)))

    assert result.polygons == ()


@pytest.mark.asyncio
async def test_bp9_a_partition_with_fewer_than_two_columns_has_no_gaps() -> None:
    """One column cannot bracket a gap — the whole partition converts to nothing."""
    region = RegionInput(
        formation_id=str(_SAND_ID),
        body_id=None,
        polygon=((0.0, 0.0), (1.0, 0.0), (1.0, -5.0), (0.0, -5.0)),
        gap_index=0,
    )
    single = SectionPartitionInput(
        start_x=0.0,
        start_y=0.0,
        end_x=100.0,
        end_y=0.0,
        columns=(
            SectionColumnInput(investigation_id="c0", along_m=10.0, world_x=10.0, world_y=0.0),
        ),
        regions=(region,),
    )
    use_case, _ = _build((region,), [_formation(_SAND_ID, "Zand")])

    result = await use_case.execute(snapshot=_snapshot(), partition=single)

    assert result.polygons == ()


# --- variant detection -------------------------------------------------


@pytest.mark.asyncio
async def test_bp10_a_unit_that_fills_nothing_is_not_declared() -> None:
    """An export never emits a material no layer uses."""
    region = RegionInput(
        formation_id=str(_SAND_ID),
        body_id=None,
        polygon=((0.0, 0.0), (1.0, 0.0), (1.0, -5.0), (0.0, -5.0)),
        gap_index=0,
    )
    use_case, _ = _build(
        (region,),
        [_formation(_SAND_ID, "Zand"), _formation(_CLAY_ID, "Klei")],
    )

    result = await use_case.execute(snapshot=_snapshot(), partition=_partition((region,)))

    assert [unit.name for unit in result.units] == ["Zand"]


@pytest.mark.asyncio
async def test_bp11_the_body_identity_survives_the_conversion() -> None:
    """A target that can group layers keeps one body as one entity."""
    region = RegionInput(
        formation_id=str(_SAND_ID),
        body_id="body-7",
        polygon=((0.0, 0.0), (1.0, 0.0), (1.0, -5.0), (0.0, -5.0)),
        gap_index=0,
    )
    use_case, _ = _build((region,), [_formation(_SAND_ID, "Zand")])

    result = await use_case.execute(snapshot=_snapshot(), partition=_partition((region,)))

    assert result.polygons[0].body_id == "body-7"
    assert result.polygons[0].gap_index == 0
