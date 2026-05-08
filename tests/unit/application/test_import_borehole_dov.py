"""Unit tests for the ImportBoreholeDov use case orchestration.

DovBoreholeClient (network) and BoreholeRepository (DB) are mocked.
DovBoringParser is real but receives synthetic outputs we construct
directly. We verify:

* empty bbox → all-zero result, no commit
* all-new boreholes → every save called, single commit at the end
* all-duplicates → no save calls, dedup ids preserved
* mix of new and duplicate → both counts correct
* per-borehole save failure → counted as failed, others still imported
* WFS-row metadata merged into Borehole when XML omitted it
* Z fallback from WFS Z_mTAW when boring XML omitted Z
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from groundmodel.application.import_borehole_dov import ImportBoreholeDov
from groundmodel.domain.models.borehole.borehole import Borehole
from groundmodel.infrastructure.parsers.borehole.dov.borehole_parse_result import (
    BoreholeParseResult,
)
from groundmodel.infrastructure.parsers.borehole.dov.dov_client import (
    BoreholeWfsRow,
)


def _wfs_row(
    *,
    test_id: str = "GEO-25/001-B1",
    permkey: str = "2025-200001",
    z: float | None = 5.0,
    drill_method: str | None = "Meerdere technieken",
) -> BoreholeWfsRow:
    """Build a BoreholeWfsRow with sensible test defaults."""
    return BoreholeWfsRow(
        permkey=permkey,
        test_id=test_id,
        fiche_url=f"https://www.dov.vlaanderen.be/data/boring/{permkey}",
        xml_url=f"https://www.dov.vlaanderen.be/xdov/proxy/export/boring/{permkey}",
        x=200000.0,
        y=200000.0,
        z=z,
        drill_method=drill_method,
        municipality="Test",
        executor="TestLab",
        purpose="Geotechnisch onderzoek",
        total_depth_m=8.5,
        has_coded_lithology=True,
        has_geotechnical_coding=False,
        has_lithological_description=False,
        has_informal_stratigraphy=False,
        has_formal_stratigraphy=True,
        has_quaternary_stratigraphy=False,
        has_hydrogeological_stratigraphy=False,
        has_informal_hydrogeological_stratigraphy=False,
    )


def _parse_result(
    *, test_id: str = "GEO-25/001-B1", elevation_m: float | None = 5.0
) -> BoreholeParseResult:
    """Build a synthetic BoreholeParseResult — valid coords so persist accepts it."""
    return BoreholeParseResult(
        borehole=Borehole(
            name=test_id,
            location_x=200000.0,
            location_y=200000.0,
            elevation_m=elevation_m,
            epsg=31370,
            z_epsg=5710 if elevation_m is not None else None,
            total_depth_m=8.5,
        ),
        drill_segments=[],
        field_log=[],
        issues=[],
    )


@pytest.fixture
def use_case() -> ImportBoreholeDov:
    """ImportBoreholeDov with a fully mocked AsyncSession + BoreholeRepository."""
    session = MagicMock()
    session.commit = AsyncMock()
    session.add = MagicMock()
    session.flush = AsyncMock()
    session.execute = AsyncMock()
    uc = ImportBoreholeDov(session)
    # Mock the repository methods used by execute().
    uc._repo.find_existing_test_ids = AsyncMock(return_value={})  # type: ignore[method-assign]
    uc._repo.save = AsyncMock()  # type: ignore[method-assign]
    return uc


# ---------------------------------------------------------------------------
# Empty bbox
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_empty_bbox_returns_zeros_and_skips_commit(
    use_case: ImportBoreholeDov,
) -> None:
    """No boreholes in bbox → all-zero result, commit never called."""
    with patch(
        "groundmodel.application.import_borehole_dov.DovBoreholeClient.fetch_bbox_processed",
        new=AsyncMock(return_value=[]),
    ):
        result = await use_case.execute(west=3.0, south=51.0, east=3.1, north=51.1)

    assert result.imported == 0
    assert result.duplicates == 0
    assert result.failed == 0
    assert result.borehole_ids == []
    use_case._session.commit.assert_not_called()  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# All-new boreholes
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_all_new_boreholes_imported_with_single_commit(
    use_case: ImportBoreholeDov,
) -> None:
    """No duplicates → every save called, exactly one commit at the end."""
    parsed = [
        (_wfs_row(test_id="BH-1", permkey="2025-200001"), _parse_result(test_id="BH-1")),
        (_wfs_row(test_id="BH-2", permkey="2025-200002"), _parse_result(test_id="BH-2")),
        (_wfs_row(test_id="BH-3", permkey="2025-200003"), _parse_result(test_id="BH-3")),
    ]
    with patch(
        "groundmodel.application.import_borehole_dov.DovBoreholeClient.fetch_bbox_processed",
        new=AsyncMock(return_value=parsed),
    ):
        result = await use_case.execute(west=3.0, south=51.0, east=3.1, north=51.1)

    assert result.imported == 3
    assert result.duplicates == 0
    assert result.failed == 0
    assert len(result.borehole_ids) == 3
    # save() called once per borehole, all with flush=False so the batch hits
    # one commit not three.
    assert use_case._repo.save.await_count == 3  # type: ignore[attr-defined]
    # Single commit at the end of the batch.
    use_case._session.commit.assert_awaited_once()  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# All-duplicates
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_all_duplicates_skip_save_but_return_existing_ids(
    use_case: ImportBoreholeDov,
) -> None:
    """Every borehole already imported → no saves, no commit, ids returned."""
    bh1, bh2 = uuid4(), uuid4()
    use_case._repo.find_existing_test_ids = AsyncMock(  # type: ignore[method-assign]
        return_value={"BH-1": bh1, "BH-2": bh2}
    )

    parsed = [
        (_wfs_row(test_id="BH-1", permkey="2025-200001"), _parse_result(test_id="BH-1")),
        (_wfs_row(test_id="BH-2", permkey="2025-200002"), _parse_result(test_id="BH-2")),
    ]
    with patch(
        "groundmodel.application.import_borehole_dov.DovBoreholeClient.fetch_bbox_processed",
        new=AsyncMock(return_value=parsed),
    ):
        result = await use_case.execute(west=3.0, south=51.0, east=3.1, north=51.1)

    assert result.imported == 0
    assert result.duplicates == 2
    assert result.failed == 0
    assert set(result.borehole_ids) == {bh1, bh2}
    use_case._repo.save.assert_not_called()  # type: ignore[attr-defined]
    use_case._session.commit.assert_not_called()  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Mix of new and duplicate
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mixed_new_and_duplicate_counts_both(
    use_case: ImportBoreholeDov,
) -> None:
    """One existing + two new → counts split, all ids returned, one commit."""
    existing_id = uuid4()
    use_case._repo.find_existing_test_ids = AsyncMock(  # type: ignore[method-assign]
        return_value={"BH-1": existing_id}
    )
    parsed = [
        (_wfs_row(test_id="BH-1", permkey="2025-200001"), _parse_result(test_id="BH-1")),
        (_wfs_row(test_id="BH-2", permkey="2025-200002"), _parse_result(test_id="BH-2")),
        (_wfs_row(test_id="BH-3", permkey="2025-200003"), _parse_result(test_id="BH-3")),
    ]
    with patch(
        "groundmodel.application.import_borehole_dov.DovBoreholeClient.fetch_bbox_processed",
        new=AsyncMock(return_value=parsed),
    ):
        result = await use_case.execute(west=3.0, south=51.0, east=3.1, north=51.1)

    assert result.imported == 2
    assert result.duplicates == 1
    assert result.failed == 0
    assert existing_id in result.borehole_ids
    assert use_case._repo.save.await_count == 2  # type: ignore[attr-defined]
    use_case._session.commit.assert_awaited_once()  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Per-borehole save failure isolated from the batch
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_persist_failure_for_one_borehole_does_not_abort_batch(
    use_case: ImportBoreholeDov,
) -> None:
    """One save() raises → that borehole counted as failed, the rest still saved."""
    parsed = [
        (_wfs_row(test_id="BH-1", permkey="2025-200001"), _parse_result(test_id="BH-1")),
        (_wfs_row(test_id="BH-2", permkey="2025-200002"), _parse_result(test_id="BH-2")),
        (_wfs_row(test_id="BH-3", permkey="2025-200003"), _parse_result(test_id="BH-3")),
    ]

    # Second save fails.
    side_effects: list[BaseException | None] = [None, RuntimeError("boom"), None]
    use_case._repo.save = AsyncMock(side_effect=side_effects)  # type: ignore[method-assign]

    with patch(
        "groundmodel.application.import_borehole_dov.DovBoreholeClient.fetch_bbox_processed",
        new=AsyncMock(return_value=parsed),
    ):
        result = await use_case.execute(west=3.0, south=51.0, east=3.1, north=51.1)

    assert result.imported == 2
    assert result.duplicates == 0
    assert result.failed == 1
    assert use_case._repo.save.await_count == 3  # type: ignore[attr-defined]
    use_case._session.commit.assert_awaited_once()  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# WFS-row → Borehole field merge
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_wfs_drill_method_fills_when_xml_omitted_it(
    use_case: ImportBoreholeDov,
) -> None:
    """The boring XML never carries drill_method; the merge step fills from WFS."""
    parsed = [
        (
            _wfs_row(test_id="BH-1", drill_method="Meerdere technieken"),
            _parse_result(test_id="BH-1"),
        )
    ]
    saved: list = []
    use_case._repo.save = AsyncMock(  # type: ignore[method-assign]
        side_effect=lambda orm, **kw: saved.append(orm)
    )
    with patch(
        "groundmodel.application.import_borehole_dov.DovBoreholeClient.fetch_bbox_processed",
        new=AsyncMock(return_value=parsed),
    ):
        await use_case.execute(west=3.0, south=51.0, east=3.1, north=51.1)

    assert len(saved) == 1
    assert saved[0].drill_method == "Meerdere technieken"


@pytest.mark.asyncio
async def test_wfs_z_fills_when_boring_xml_omitted_elevation(
    use_case: ImportBoreholeDov,
) -> None:
    """Boring XML had no Z (NO_ELEVATION case) — WFS Z_mTAW fills the gap."""
    parsed = [
        (
            _wfs_row(test_id="BH-1", z=7.84),
            _parse_result(test_id="BH-1", elevation_m=None),
        )
    ]
    saved: list = []
    use_case._repo.save = AsyncMock(  # type: ignore[method-assign]
        side_effect=lambda orm, **kw: saved.append(orm)
    )
    with patch(
        "groundmodel.application.import_borehole_dov.DovBoreholeClient.fetch_bbox_processed",
        new=AsyncMock(return_value=parsed),
    ):
        await use_case.execute(west=3.0, south=51.0, east=3.1, north=51.1)

    assert saved[0].elevation_m == pytest.approx(7.84)
    assert saved[0].z_epsg == 5710


@pytest.mark.asyncio
async def test_xml_elevation_wins_over_wfs_z(
    use_case: ImportBoreholeDov,
) -> None:
    """When boring XML had Z, the WFS Z_mTAW does NOT overwrite it (XML is authoritative)."""
    parsed = [
        (
            _wfs_row(test_id="BH-1", z=99.0),  # would be wrong if it overwrote
            _parse_result(test_id="BH-1", elevation_m=7.84),  # XML's authoritative value
        )
    ]
    saved: list = []
    use_case._repo.save = AsyncMock(  # type: ignore[method-assign]
        side_effect=lambda orm, **kw: saved.append(orm)
    )
    with patch(
        "groundmodel.application.import_borehole_dov.DovBoreholeClient.fetch_bbox_processed",
        new=AsyncMock(return_value=parsed),
    ):
        await use_case.execute(west=3.0, south=51.0, east=3.1, north=51.1)

    assert saved[0].elevation_m == pytest.approx(7.84)
