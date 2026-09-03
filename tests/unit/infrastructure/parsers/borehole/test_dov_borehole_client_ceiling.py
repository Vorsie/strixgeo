"""The borehole DOV client stops before download when discovery is too dense.

Rule (Codex row 4): a request that would discover more than
``DOV_MAX_IMPORT_FEATURES`` stops after discovery with a too-large error naming
the count and the limit, BEFORE any XML download. The borehole client resolves
discovery and download in one method (``fetch_bbox_processed``), so the guard
sits between the recursive WFS collect and the parallel download — this test
patches both boundaries to prove the ordering.
"""

from __future__ import annotations

from dataclasses import dataclass
from unittest.mock import AsyncMock, patch

import pytest

from groundmodel.infrastructure.parsers.borehole.dov.dov_client import DovBoreholeClient
from groundmodel.infrastructure.parsers.dov.dov_common import DOV_MAX_IMPORT_FEATURES
from groundmodel.shared.exceptions import DovImportTooLargeError

_CLIENT_MODULE = "groundmodel.infrastructure.parsers.borehole.dov.dov_client"


@dataclass
class _Row:
    """Minimal stand-in for a BoreholeWfsRow (only ``permkey`` is read here)."""

    permkey: str


def _rows(n: int) -> list[_Row]:
    return [_Row(permkey=f"2024-{i:06d}") for i in range(n)]


@pytest.mark.asyncio
async def test_discovery_over_ceiling_raises_before_download() -> None:
    """Over-ceiling discovery raises DovImportTooLargeError before download."""
    over = DOV_MAX_IMPORT_FEATURES + 1
    download_mock = AsyncMock(return_value=[])
    client = DovBoreholeClient(http=object())  # type: ignore[arg-type]

    with (
        patch(
            f"{_CLIENT_MODULE}.collect_wfs_features_recursive",
            new=AsyncMock(return_value=_rows(over)),
        ),
        patch(f"{_CLIENT_MODULE}.parallel_download_and_process", new=download_mock),
    ):
        with pytest.raises(DovImportTooLargeError) as excinfo:
            await client.fetch_bbox_processed(
                west=3.0,
                south=51.0,
                east=3.1,
                north=51.1,
                process=lambda xml, name: xml,
            )

    assert excinfo.value.discovered == over
    assert excinfo.value.limit == DOV_MAX_IMPORT_FEATURES
    download_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_discovery_at_ceiling_downloads() -> None:
    """Exactly at the ceiling downloads normally — the guard is a strict '>'."""
    download_mock = AsyncMock(return_value=[])
    client = DovBoreholeClient(http=object())  # type: ignore[arg-type]

    with (
        patch(
            f"{_CLIENT_MODULE}.collect_wfs_features_recursive",
            new=AsyncMock(return_value=_rows(DOV_MAX_IMPORT_FEATURES)),
        ),
        patch(f"{_CLIENT_MODULE}.parallel_download_and_process", new=download_mock),
    ):
        discovered, results = await client.fetch_bbox_processed(
            west=3.0,
            south=51.0,
            east=3.1,
            north=51.1,
            process=lambda xml, name: xml,
        )

    assert discovered == DOV_MAX_IMPORT_FEATURES
    download_mock.assert_awaited_once()
