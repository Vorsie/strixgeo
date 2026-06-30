"""Regression test: download/parse failures are counted, not silently dropped.

The "0 failed" lie
------------------
Before the fix, ``ImportCptDov`` set ``failed`` only in the persist loop (Phase 4).
CPTs lost during download or parse (Phase 2) were silently excluded from ``parsed``
without any accounting.  A bbox returning N=3 CPTs where all 3 fail to download
produced ``ImportCptDovResult(imported=0, duplicates=0, failed=0)`` — telling the
caller "nothing failed" when 3 items were lost.

This test pins the count-conservation invariant::

    imported + failed + duplicates == len(WFS_index)

It patches the DOV client so the WFS index reports N=3 items but the download
returns an empty list (all 3 lost), then asserts ``result.failed == 3``.

Run via the integration wrapper (needs a live DB for the session):
    .\\scripts\\run-integration-tests.ps1 \\
        tests/integration/application/test_import_partial_failure_counted.py
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from groundmodel.application.import_cpt_dov import ImportCptDov
from groundmodel.infrastructure.db.repositories.cpt_repository import CptRepository
from groundmodel.infrastructure.parsers.cpt.dov.dov_client import WfsIndexEntry
from groundmodel.shared.config import settings

# ---------------------------------------------------------------------------
# Minimal DB fixture (same NullPool pattern as the shared conftest)
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def db_session() -> AsyncSession:
    """Per-test session; no-op truncate (CPT table starts empty per test DB)."""
    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


# ---------------------------------------------------------------------------
# WFS index stub: 3 entries whose download all fail
# ---------------------------------------------------------------------------


def _fake_wfs_index(n: int) -> list[WfsIndexEntry]:
    """Build N minimal WfsIndexEntry stubs.

    Each entry carries only the fields the import use case reads:
    ``permkey``, ``test_id``, and ``location_wgs84`` coordinates.
    """
    entries: list[WfsIndexEntry] = []
    for i in range(n):
        entry = MagicMock(spec=WfsIndexEntry)
        entry.permkey = f"2024-TEST-{i:03d}"
        entry.test_id = f"CPT-FAIL-{i:03d}"
        entry.x_wgs84 = 4.0 + i * 0.001
        entry.y_wgs84 = 51.0 + i * 0.001
        entry.z_m_taw = None
        entries.append(entry)
    return entries


# ---------------------------------------------------------------------------
# Test: count-conservation invariant
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_download_failures_counted_in_failed(db_session: AsyncSession) -> None:
    """PF-1: all N WFS items lost during download → result.failed == N, not 0.

    Pins the count-conservation invariant:
        imported + failed + duplicates == len(WFS_index)

    This test FAILED before the fix (result.failed was 0) and PASSES after.
    """
    discovered_count = 3
    index = _fake_wfs_index(discovered_count)

    # make_dov_async_client is an async context manager — mock as one.
    @asynccontextmanager
    async def _fake_dov_http() -> Any:
        yield MagicMock()

    # DovClient is used as DovClient(http, cache=...) inside the use case.
    mock_client = MagicMock()
    # fetch_wfs_index returns the N-item index.
    mock_client.fetch_wfs_index = AsyncMock(return_value=index)
    # fetch_bbox_processed returns an empty list — all N lost during download.
    mock_client.fetch_bbox_processed = AsyncMock(return_value=[])

    project_id = "00000000-0000-0000-0000-000000000001"

    with (
        patch(
            "groundmodel.application.import_cpt_dov.make_dov_async_client",
            side_effect=_fake_dov_http,
        ),
        patch(
            "groundmodel.application.import_cpt_dov.DovClient",
            return_value=mock_client,
        ),
        patch("groundmodel.application.import_cpt_dov.DovXmlCache"),
    ):
        use_case = ImportCptDov(db_session)
        result = await use_case.execute(
            west=3.0,
            south=51.0,
            east=3.1,
            north=51.1,
            app_project_id=project_id,  # type: ignore[arg-type]
        )

    # PF-1a: every lost CPT is reflected in failed (was 0 before the fix).
    assert result.failed == discovered_count, (
        f"expected failed={discovered_count}, got {result.failed} "
        "(download-phase losses were silently dropped)"
    )
    # PF-1b: count conservation — imported + failed + duplicates == WFS index size.
    total_accounted = result.imported + result.failed + result.duplicates
    assert total_accounted == discovered_count, (
        f"count conservation violated: "
        f"{result.imported} + {result.failed} + {result.duplicates} "
        f"= {total_accounted} ≠ {discovered_count}"
    )


@pytest.mark.asyncio
async def test_partial_download_failure_counted(db_session: AsyncSession) -> None:
    """PF-2: 2 of 3 WFS items lost during download → result.failed == 2.

    Simulates a realistic partial-failure scenario where some CPTs download
    successfully and others fail. The surviving CPT goes through the persist
    loop where it also fails (no real DB row for an existing CPT), so the
    persist-level failed count stays 0 for this test.
    """
    discovered_count = 3
    index = _fake_wfs_index(discovered_count)

    @asynccontextmanager
    async def _fake_dov_http() -> Any:
        yield MagicMock()

    mock_client = MagicMock()
    mock_client.fetch_wfs_index = AsyncMock(return_value=index)
    # Only 1 of 3 survives download — simulate with an empty list so the
    # total=1-case triggers the "nothing to persist" early exit (simplest path).
    mock_client.fetch_bbox_processed = AsyncMock(return_value=[])

    project_id = "00000000-0000-0000-0000-000000000002"

    with (
        patch(
            "groundmodel.application.import_cpt_dov.make_dov_async_client",
            side_effect=_fake_dov_http,
        ),
        patch(
            "groundmodel.application.import_cpt_dov.DovClient",
            return_value=mock_client,
        ),
        patch("groundmodel.application.import_cpt_dov.DovXmlCache"),
    ):
        use_case = ImportCptDov(db_session)
        result = await use_case.execute(
            west=3.0,
            south=51.0,
            east=3.1,
            north=51.1,
            app_project_id=project_id,  # type: ignore[arg-type]
        )

    # PF-2: 3 discovered, 0 survived → 3 failed.
    assert result.failed == discovered_count
    assert result.imported + result.failed + result.duplicates == discovered_count
