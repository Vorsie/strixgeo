"""Unit tests for the build-generation provenance row — debt #252.

``_write_generation`` records what a 3-D litho build was made FROM and WITH. It
is mostly a mapping from build state onto one ORM row, and the risk it carries is
exactly that: a field silently missing or holding the wrong value is invisible
until someone tries to reproduce a build months later and cannot.

These tests drive it with a fake session that captures what would be persisted,
so every field is asserted without a database. The migration itself is verified
against the real schema.
"""

from __future__ import annotations

import time
from typing import Any
from uuid import UUID

import pytest

from groundmodel.application.build_voxel_litho_model import BuildVoxelLithoModel
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)

_MODEL_ID = UUID("019e934c-70fd-7d11-a44a-b2073f4063a2")


class _FakeGrid:
    """Just the three axes ``_write_generation`` reads off a LabelGrid."""

    gx = [100.0, 102.0, 104.0]
    gy = [200.0, 202.0]
    gz = [-5.0, -4.75, -4.5, -4.25]


class _FakeMesh:
    """A mesh stand-in carrying only the triangle count the row records."""

    def __init__(self, n: int) -> None:
        self.triangles = [(0, 1, 2)] * n


class _FakeSession:
    """Captures ``add``ed rows; ``execute`` returns an empty result."""

    def __init__(self) -> None:
        self.added: list[Any] = []
        self.executed: list[Any] = []

    def add(self, obj: Any) -> None:
        self.added.append(obj)

    async def flush(self) -> None:
        return None

    async def execute(self, stmt: Any) -> Any:
        self.executed.append(stmt)

        class _Result:
            def all(self) -> list:
                return []

        return _Result()


def _section() -> SectionPartitionInput:
    """A one-gap section with a single band region."""
    return SectionPartitionInput(
        start_x=0.0,
        start_y=0.0,
        end_x=100.0,
        end_y=0.0,
        columns=(
            SectionColumnInput(investigation_id="A", along_m=0.0, world_x=10.0, world_y=20.0),
            SectionColumnInput(investigation_id="B", along_m=50.0, world_x=60.0, world_y=25.0),
        ),
        regions=(
            RegionInput(
                formation_id="ZAND",
                body_id="body-1",
                polygon=((0.0, 3.0), (1.0, 3.0), (1.0, -3.0), (0.0, -3.0)),
                gap_index=0,
            ),
        ),
    )


async def _write(session: _FakeSession, **over: Any) -> Any:
    """Run ``_write_generation`` against the fake session and return the row."""
    builder = BuildVoxelLithoModel(session)  # type: ignore[arg-type]
    kwargs: dict[str, Any] = dict(
        generation_id=UUID("019f0000-0000-7000-8000-000000000001"),
        model_id=_MODEL_ID,
        sections=[_section()],
        grid=_FakeGrid(),
        aliases={"body-1": "body-1", "body-2": "body-1"},
        checksum=b"\x01\x02\x03",
        geo_surfaces=(),
        horizontal_spacing_m=2.0,
        vertical_spacing_m=0.25,
        honor_radius_m=2.0,
        litho_snap_tolerance_m=0.3,
        meshes=[_FakeMesh(4), _FakeMesh(6)],
        started_at=time.perf_counter(),
    )
    kwargs.update(over)
    await builder._write_generation(**kwargs)
    return session.added[0]


@pytest.mark.asyncio
async def test_records_every_setting_that_changes_the_output() -> None:
    """A build is only reproducible if all four knobs are stored."""
    row = await _write(_FakeSession())

    assert row.horizontal_spacing_m == 2.0
    assert row.vertical_spacing_m == 0.25
    assert row.honor_radius_m == 2.0
    assert row.litho_snap_tolerance_m == 0.3


@pytest.mark.asyncio
async def test_records_the_grid_origin_not_just_its_size() -> None:
    """Grid PHASE decides which cell an investigation lands in.

    Two builds with identical spacing and different origins are not the same
    build, so the origin has to be stored alongside the dimensions.
    """
    row = await _write(_FakeSession())

    assert (row.grid_nx, row.grid_ny, row.grid_nz) == (3, 2, 4)
    assert (row.grid_origin_x, row.grid_origin_y, row.grid_origin_z) == (100.0, 200.0, -5.0)


@pytest.mark.asyncio
async def test_stores_the_payload_verbatim_enough_to_rebuild() -> None:
    """Every column position and region polygon survives the round trip."""
    row = await _write(_FakeSession())

    section = row.payload["sections"][0]
    assert section["columns"][1] == {
        "investigation_id": "B",
        "along_m": 50.0,
        "world_x": 60.0,
        "world_y": 25.0,
    }
    region = section["regions"][0]
    assert region["formation_id"] == "ZAND"
    assert region["body_id"] == "body-1"
    assert region["gap_index"] == 0
    assert region["polygon"] == [[0.0, 3.0], [1.0, 3.0], [1.0, -3.0], [0.0, -3.0]]


@pytest.mark.asyncio
async def test_records_the_derived_alias_map() -> None:
    """Answers "which source bodies make up this mesh?".

    This is DERIVED build data with provenance — it must never be read back as a
    user correlation.
    """
    row = await _write(_FakeSession())

    assert row.body_aliases == {"body-1": "body-1", "body-2": "body-1"}


@pytest.mark.asyncio
async def test_records_the_outcome_counts_and_the_builder() -> None:
    """So a mesh built by an older builder is recognisable after the algorithm moves on."""
    row = await _write(_FakeSession())

    assert row.sections_count == 1
    assert row.bodies_built == 2
    assert row.triangles == 10
    assert row.builder_version
    assert row.duration_s >= 0.0


@pytest.mark.asyncio
async def test_a_vertical_spacing_of_none_records_the_cubic_case() -> None:
    """A cubic build stores the horizontal spacing on both axes, not NULL."""
    row = await _write(_FakeSession(), vertical_spacing_m=None)

    assert row.vertical_spacing_m == 2.0


@pytest.mark.asyncio
async def test_prunes_older_generations() -> None:
    """The payload is hundreds of kB, so history has to be bounded."""
    session = _FakeSession()
    await _write(session)

    # One SELECT for the keep-list, then a DELETE only when there is something
    # to keep; the fake returns an empty keep-list, so no DELETE is issued.
    assert len(session.executed) == 1
