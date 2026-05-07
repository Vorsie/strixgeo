"""Unit tests for the ImportCptDov use case orchestration.

DovClient (network) and ImportCpt.persist (DB) are mocked. The DovParser is
real but receives synthetic XMLs from the mocked client. We verify:

- empty bbox → all-zero result, no commit
- all-new CPTs → every persist is called, single commit at the end
- all-duplicates → no persist calls, dedup ids preserved
- mix of new/duplicate → both counts correct
- per-CPT persist failure → counted as failed, others still imported
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import polars as pl
import pytest

from groundmodel.application.import_cpt_dov import ImportCptDov
from groundmodel.application.import_cpt_result import ImportCptResult
from groundmodel.infrastructure.parsers.cpt.gef.cpt_type import CPTType
from groundmodel.infrastructure.parsers.cpt.gef.gef_header import GEFHeader
from groundmodel.infrastructure.parsers.cpt.gef.gef_parse_result import GEFParseResult
from groundmodel.shared.exceptions import DuplicateCptError


def _result(test_id: str) -> GEFParseResult:
    """Build a synthetic GEFParseResult with valid coords (so persist accepts it)."""
    return GEFParseResult(
        header=GEFHeader(
            project_id="DOV",
            test_id=test_id,
            x=200000.0,
            y=200000.0,
            z=5.0,
            epsg=31370,
            z_epsg=5710,
        ),
        cpt_type=CPTType.CPTM,
        data=pl.DataFrame({"depth_m": [0.2, 0.4], "qc_mpa": [1.0, 2.0]}),
    )


@pytest.fixture
def use_case() -> ImportCptDov:
    """ImportCptDov with a fully mocked AsyncSession."""
    session = MagicMock()
    session.commit = AsyncMock()
    return ImportCptDov(session)


# ------------------------------------------------------------------
# Empty bbox
# ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_empty_bbox_returns_zeros_and_skips_commit(use_case: ImportCptDov):
    """No CPTs in bbox → empty result, commit is never called."""
    with patch(
        "groundmodel.application.import_cpt_dov.DovClient.fetch_bbox_processed",
        new=AsyncMock(return_value=[]),
    ):
        result = await use_case.execute(west=3.0, south=51.0, east=3.1, north=51.1)

    assert result.imported == 0
    assert result.duplicates == 0
    assert result.failed == 0
    assert result.cpt_ids == []
    use_case._session.commit.assert_not_called()  # type: ignore[attr-defined]


# ------------------------------------------------------------------
# All new CPTs
# ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_all_new_cpts_persist_and_single_commit(use_case: ImportCptDov):
    """Every CPT new → all persisted, ONE commit at the end."""
    parsed = [(f"CPT-{i}", _result(f"TID-{i}")) for i in range(3)]
    persist_mock = AsyncMock(
        side_effect=[ImportCptResult(cpt_id=uuid4(), issues=[]) for _ in parsed]
    )

    with (
        patch(
            "groundmodel.application.import_cpt_dov.DovClient.fetch_bbox_processed",
            new=AsyncMock(return_value=parsed),
        ),
        patch.object(use_case._repo, "find_existing_test_ids", new=AsyncMock(return_value={})),
        patch.object(use_case._import, "persist", new=persist_mock),
    ):
        result = await use_case.execute(west=3.0, south=51.0, east=3.1, north=51.1)

    assert result.imported == 3
    assert result.duplicates == 0
    assert result.failed == 0
    assert len(result.cpt_ids) == 3
    assert persist_mock.await_count == 3
    # Single commit for the whole batch (not per-CPT).
    use_case._session.commit.assert_awaited_once()  # type: ignore[attr-defined]


# ------------------------------------------------------------------
# All duplicates
# ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_all_duplicates_skip_persist_and_skip_commit(use_case: ImportCptDov):
    """Every CPT already exists → no persist calls, no commit, ids returned for UI."""
    parsed = [(f"CPT-{i}", _result(f"TID-{i}")) for i in range(3)]
    existing_ids = {f"TID-{i}": uuid4() for i in range(3)}
    persist_mock = AsyncMock()

    with (
        patch(
            "groundmodel.application.import_cpt_dov.DovClient.fetch_bbox_processed",
            new=AsyncMock(return_value=parsed),
        ),
        patch.object(
            use_case._repo, "find_existing_test_ids", new=AsyncMock(return_value=existing_ids)
        ),
        patch.object(use_case._import, "persist", new=persist_mock),
    ):
        result = await use_case.execute(west=3.0, south=51.0, east=3.1, north=51.1)

    assert result.imported == 0
    assert result.duplicates == 3
    assert result.failed == 0
    assert set(result.cpt_ids) == set(existing_ids.values())
    persist_mock.assert_not_awaited()
    use_case._session.commit.assert_not_called()  # type: ignore[attr-defined]


# ------------------------------------------------------------------
# Mixed new + duplicate
# ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mixed_new_and_duplicate_counts_both(use_case: ImportCptDov):
    parsed = [(f"CPT-{i}", _result(f"TID-{i}")) for i in range(4)]
    # Mark TID-1 and TID-3 as already existing.
    existing_ids = {"TID-1": uuid4(), "TID-3": uuid4()}
    new_persist_ids = [uuid4(), uuid4()]
    persist_mock = AsyncMock(
        side_effect=[ImportCptResult(cpt_id=cid, issues=[]) for cid in new_persist_ids]
    )

    with (
        patch(
            "groundmodel.application.import_cpt_dov.DovClient.fetch_bbox_processed",
            new=AsyncMock(return_value=parsed),
        ),
        patch.object(
            use_case._repo, "find_existing_test_ids", new=AsyncMock(return_value=existing_ids)
        ),
        patch.object(use_case._import, "persist", new=persist_mock),
    ):
        result = await use_case.execute(west=3.0, south=51.0, east=3.1, north=51.1)

    assert result.imported == 2
    assert result.duplicates == 2
    assert result.failed == 0
    # Persist called only for the 2 new ones, not the 2 duplicates.
    assert persist_mock.await_count == 2
    use_case._session.commit.assert_awaited_once()  # type: ignore[attr-defined]


# ------------------------------------------------------------------
# Per-CPT persist failure isolated
# ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_persist_failure_is_isolated(use_case: ImportCptDov):
    """One CPT raising during persist must not stop the others; counted as failed."""
    parsed = [(f"CPT-{i}", _result(f"TID-{i}")) for i in range(3)]
    success_id = uuid4()
    persist_mock = AsyncMock(
        side_effect=[
            ImportCptResult(cpt_id=success_id, issues=[]),
            ValueError("simulated DB error"),
            ImportCptResult(cpt_id=uuid4(), issues=[]),
        ]
    )

    with (
        patch(
            "groundmodel.application.import_cpt_dov.DovClient.fetch_bbox_processed",
            new=AsyncMock(return_value=parsed),
        ),
        patch.object(use_case._repo, "find_existing_test_ids", new=AsyncMock(return_value={})),
        patch.object(use_case._import, "persist", new=persist_mock),
    ):
        result = await use_case.execute(west=3.0, south=51.0, east=3.1, north=51.1)

    assert result.imported == 2
    assert result.duplicates == 0
    assert result.failed == 1
    # Commit still happens for the surviving CPTs.
    use_case._session.commit.assert_awaited_once()  # type: ignore[attr-defined]


# ------------------------------------------------------------------
# DuplicateCptError surfaced from persist (e.g. race condition)
# ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_persist_raising_duplicate_counted_as_failed_not_imported(use_case: ImportCptDov):
    """DuplicateCptError from persist (rare race) shouldn't crash the batch.

    Normally dedup catches duplicates before persist, but a race between dedup and
    insert is possible. The use case currently treats this as 'failed' (logged
    error), not 'duplicate' — that's the expected behaviour today.
    """
    parsed = [("CPT-1", _result("TID-1"))]
    persist_mock = AsyncMock(side_effect=DuplicateCptError("race", existing_id=uuid4()))

    with (
        patch(
            "groundmodel.application.import_cpt_dov.DovClient.fetch_bbox_processed",
            new=AsyncMock(return_value=parsed),
        ),
        patch.object(use_case._repo, "find_existing_test_ids", new=AsyncMock(return_value={})),
        patch.object(use_case._import, "persist", new=persist_mock),
    ):
        result = await use_case.execute(west=3.0, south=51.0, east=3.1, north=51.1)

    assert result.imported == 0
    assert result.failed == 1
    use_case._session.commit.assert_not_called()  # type: ignore[attr-defined]


# ------------------------------------------------------------------
# Cache wiring
# ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dov_client_receives_the_cache(use_case: ImportCptDov):
    """The use case must hand its DovXmlCache to DovClient on construction.

    Regression guard: if a future refactor forgets to plumb cache=self._cache
    into DovClient(...), every import would silently fall back to a no-cache path.
    """
    captured: dict[str, object] = {}

    class _FakeClient:
        def __init__(self, http: object, cache: object | None = None) -> None:
            captured["cache"] = cache

        async def fetch_bbox_processed(self, *_a: object, **_k: object) -> list:  # type: ignore[type-arg]
            return []

    with patch("groundmodel.application.import_cpt_dov.DovClient", _FakeClient):
        await use_case.execute(west=3.0, south=51.0, east=3.1, north=51.1)

    assert captured["cache"] is use_case._cache
