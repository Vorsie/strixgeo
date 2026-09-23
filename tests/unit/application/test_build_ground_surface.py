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

from groundmodel.application import build_ground_surface
from groundmodel.application.build_ground_surface import BuildGroundSurface
from groundmodel.domain.services.dem_clip_constants import KIND_DEM_CELL_LOW_CONFIDENCE
from groundmodel.infrastructure.dem.dem_provider import DemZGrid

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _EveryTest(set):
    """A member set that holds every investigation — all tests are on a section."""

    def __contains__(self, item: object) -> bool:
        return True


@pytest.fixture(autouse=True)
def _every_test_on_a_section(monkeypatch: pytest.MonkeyPatch) -> None:
    """Membership (only tests a section draws feed the model, owner 2026-09-23)
    is the database's business and is pinned by the integration tests; these
    unit cases are about the DEM, so every scripted test counts as on a section
    and the fake session need not answer the section queries."""

    async def _all(_session: Any, *, project_id: Any) -> set:  # noqa: ARG001
        return _EveryTest()

    monkeypatch.setattr(build_ground_surface, "load_section_member_investigation_ids", _all)


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


def _script_for(
    boreholes: list[tuple[str, float, float]],
    elevations: dict[str, float] | None = None,
) -> list[list[Any]]:
    """Script a session that returns ``boreholes`` and no CPTs.

    ``elevations`` maps a borehole name to its surveyed collar (m TAW); a name
    absent from the map (or ``None`` for the whole arg) is returned with a NULL
    ``elevation_m``, mirroring a test imported without a Z. The location query
    now selects four columns — name, x, y, elevation_m — so the scripted rows
    carry the collar the ``BuildGroundSurface`` use case reads.
    """
    elev = elevations or {}
    ids = [uuid4() for _ in boreholes]
    return [ids, [], [(n, x, y, elev.get(n)) for n, x, y in boreholes]]


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


@pytest.mark.asyncio
async def test_a_surveyed_collar_beats_the_dem_at_that_test() -> None:
    """A test's own surveyed collar outranks the DEM at its location.

    Owner ruling 2026-08-28: "I trust surface elevation of a test more than a
    DEM we pulled off the web." B1 was surveyed at 5.8 m TAW while the DEM
    reads 12.0 everywhere; the ground vertex above B1 must be 5.8, not 12.0.
    """
    session = _FakeSession(
        _script_for(
            [("B1", 1000.0, 2000.0), ("B2", 1100.0, 2100.0)],
            elevations={"B1": 5.8},
        )
    )
    result = await BuildGroundSurface(session, _FakeProvider(lambda x, y: 12.0)).execute(  # type: ignore[arg-type]
        uuid4(), uuid4()
    )

    at_b1 = [v for v in result.vertices if v[0] == 1000.0 and v[1] == 2000.0]
    assert at_b1, "no ground vertex above the surveyed borehole B1"
    assert at_b1[0][2] == pytest.approx(5.8)
    # B2 has no surveyed Z, so it still reads the DEM (the between-tests source).
    at_b2 = [v for v in result.vertices if v[0] == 1100.0 and v[1] == 2100.0]
    assert at_b2 and at_b2[0][2] == pytest.approx(12.0)


@pytest.mark.asyncio
async def test_a_borehole_surveyed_at_zero_m_taw_is_not_treated_as_missing() -> None:
    """A collar of exactly 0 m TAW is a real measurement, not "no Z".

    Owner ruling 2026-08-28: "if something has ground level 0 (often happens
    in belgium) then this is a different case than no data." The DEM reads
    12.0, but B1's surveyed collar is 0 m TAW — the ground above B1 must
    anchor at 0.0, not fall back to the DEM.
    """
    session = _FakeSession(
        _script_for([("B1", 1000.0, 2000.0), ("B2", 1100.0, 2100.0)], elevations={"B1": 0.0})
    )
    result = await BuildGroundSurface(session, _FakeProvider(lambda x, y: 12.0)).execute(  # type: ignore[arg-type]
        uuid4(), uuid4()
    )

    at_b1 = [v for v in result.vertices if v[0] == 1000.0 and v[1] == 2000.0]
    assert at_b1, "a borehole surveyed at 0 m TAW was dropped as if it had no elevation"
    assert at_b1[0][2] == pytest.approx(0.0)
