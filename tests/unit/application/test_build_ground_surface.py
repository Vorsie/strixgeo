"""Unit tests for the ``BuildGroundSurface`` use case (G7 ground surface).

The use case orchestrates: load the model's investigation locations → fetch a
DEM grid over their extent → build the terrain TIN → report what the DEM could
not answer for.  These tests pin the behaviour the user sees, with a fake
provider and a fake session — no DB, no network.

Rules under test, in the owner's terms:

* The ground keeps going past the outermost test (it is a reference to read a
  distance against, not a slab that stops at the last borehole).
* A test the DEM has no ground for is NAMED, not silently interpolated over.
* A model with no located investigations produces an empty surface, not a crash.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest

from groundmodel.application.build_ground_surface import BuildGroundSurface
from groundmodel.domain.services.dem_clip_constants import KIND_DEM_CELL_LOW_CONFIDENCE
from groundmodel.infrastructure.dem.dem_provider import DemZGrid

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _FakeResult:
    """Stands in for a SQLAlchemy ``Result`` for the two shapes we consume."""

    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def scalars(self) -> _FakeResult:
        return self

    def all(self) -> list[Any]:
        return self._rows


class _FakeSession:
    """Returns canned results in the order the use case issues its queries.

    ``BuildGroundSurface._load_hull_points`` issues up to four statements:
    distinct borehole ids, distinct cpt ids, then the location rows for each
    non-empty id list.  The fake simply pops from a scripted list.
    """

    def __init__(self, scripted: list[list[Any]]) -> None:
        self._scripted = list(scripted)
        self.calls = 0

    async def execute(self, _stmt: Any) -> _FakeResult:
        self.calls += 1
        return _FakeResult(self._scripted.pop(0) if self._scripted else [])


class _FakeProvider:
    """A DEM provider over a caller-supplied ``z(x, y)`` function."""

    provider_id = "fake"
    native_epsg = 31370

    def __init__(self, z_at: Any, *, from_cache: bool = True) -> None:
        self._z_at = z_at
        self._from_cache = from_cache
        self.requested_bbox: tuple[float, float, float, float] | None = None

    async def fetch_grid(
        self,
        bbox_min_x: float,
        bbox_min_y: float,
        bbox_max_x: float,
        bbox_max_y: float,
        resolution_m: float | None = None,
    ) -> DemZGrid:
        self.requested_bbox = (bbox_min_x, bbox_min_y, bbox_max_x, bbox_max_y)
        # A 1 m grid over the requested bbox, filled from the z function.
        n_cols = max(1, int(round(bbox_max_x - bbox_min_x)))
        n_rows = max(1, int(round(bbox_max_y - bbox_min_y)))
        values: list[float | None] = []
        for row in range(n_rows):
            y = bbox_max_y - row  # row 0 = max Y (north-up)
            for col in range(n_cols):
                values.append(self._z_at(bbox_min_x + col, y))
        return DemZGrid(
            bbox_min_x=bbox_min_x,
            bbox_min_y=bbox_min_y,
            bbox_max_x=bbox_max_x,
            bbox_max_y=bbox_max_y,
            resolution_m=1.0,
            n_cols=n_cols,
            n_rows=n_rows,
            values=tuple(values),
            from_cache=self._from_cache,
        )

    async def close(self) -> None:
        return None

    async def sample_along_line(self, **_kw: Any) -> list[Any]:
        return []


def _script_for(boreholes: list[tuple[str, float, float]]) -> list[list[Any]]:
    """Script a session that returns ``boreholes`` and no CPTs."""
    ids = [uuid4() for _ in boreholes]
    return [ids, [], [(n, x, y) for n, x, y in boreholes]]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ground_is_fetched_past_the_outermost_test() -> None:
    """The DEM tile is asked for beyond the investigation extent, not flush to it."""
    session = _FakeSession(_script_for([("B1", 1000.0, 2000.0), ("B2", 1100.0, 2100.0)]))
    provider = _FakeProvider(lambda x, y: 12.0)

    await BuildGroundSurface(session, provider).execute(uuid4(), uuid4())  # type: ignore[arg-type]

    assert provider.requested_bbox is not None
    min_x, min_y, max_x, max_y = provider.requested_bbox
    assert min_x < 1000.0
    assert min_y < 2000.0
    assert max_x > 1100.0
    assert max_y > 2100.0


@pytest.mark.asyncio
async def test_a_test_the_dem_has_no_ground_for_is_named() -> None:
    """A NoData cell under B2 is reported by name, not silently spanned."""
    session = _FakeSession(_script_for([("B1", 1000.0, 2000.0), ("B2", 1100.0, 2100.0)]))

    def z_at(x: float, y: float) -> float | None:
        # A NoData patch around B2 wide enough to defeat bilinear interpolation.
        if abs(x - 1100.0) <= 2.0 and abs(y - 2100.0) <= 2.0:
            return None
        return 12.0

    result = await BuildGroundSurface(session, _FakeProvider(z_at)).execute(uuid4(), uuid4())  # type: ignore[arg-type]

    kinds = [i.kind for i in result.issues]
    assert KIND_DEM_CELL_LOW_CONFIDENCE in kinds
    assert any("B2" in i.detail for i in result.issues)
    assert not any("B1" in i.detail for i in result.issues)


@pytest.mark.asyncio
async def test_full_dem_coverage_reports_no_issues() -> None:
    """When the DEM answers everywhere, the build is clean."""
    session = _FakeSession(_script_for([("B1", 1000.0, 2000.0), ("B2", 1100.0, 2100.0)]))
    result = await BuildGroundSurface(session, _FakeProvider(lambda x, y: 12.0)).execute(  # type: ignore[arg-type]
        uuid4(), uuid4()
    )
    assert result.issues == []
    assert result.vertices
    assert result.triangles


@pytest.mark.asyncio
async def test_model_without_located_investigations_returns_an_empty_surface() -> None:
    """No hull → empty surface, no provider call, no crash."""
    session = _FakeSession([[], []])
    provider = _FakeProvider(lambda x, y: 12.0)

    result = await BuildGroundSurface(session, provider).execute(uuid4(), uuid4())  # type: ignore[arg-type]

    assert result.vertices == []
    assert result.triangles == []
    assert result.issues == []
    assert provider.requested_bbox is None
