"""Unit tests for the ImportCptDov use case orchestration.

DovClient (network) and ImportCpt.persist (DB) are mocked. The DovParser is
real but receives synthetic XMLs from the mocked client. We verify:

- empty bbox → all-zero result, no commit
- all-new CPTs → every persist is called, single commit at the end
- all-duplicates → no persist calls, dedup ids preserved
- mix of new/duplicate → both counts correct
- per-CPT persist failure → counted as failed, others still imported
- pins_cb receives the WFS index before download phase
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import polars as pl
import pytest

from groundmodel.application.import_cpt_dov import ImportCptDov
from groundmodel.application.import_cpt_result import ImportCptResult
from groundmodel.infrastructure.parsers.cpt.dov.dov_client import WfsIndexEntry
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


def _index_entry(name: str) -> WfsIndexEntry:
    """Build a synthetic WfsIndexEntry for a given CPT name."""
    return WfsIndexEntry(
        permkey=f"2024-{name}",
        name=name,
        xml_url=f"https://www.dov.vlaanderen.be/xdov/proxy/export/sondering/2024-{name}",
        x_lambert72=200000.0,
        y_lambert72=200000.0,
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
    with (
        patch(
            "groundmodel.application.import_cpt_dov.DovClient.fetch_wfs_index",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "groundmodel.application.import_cpt_dov.DovClient.fetch_bbox_processed",
            new=AsyncMock(return_value=[]),
        ),
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
    index = [_index_entry(f"CPT-{i}") for i in range(3)]
    persist_mock = AsyncMock(
        side_effect=[ImportCptResult(cpt_id=uuid4(), issues=[]) for _ in parsed]
    )

    with (
        patch(
            "groundmodel.application.import_cpt_dov.DovClient.fetch_wfs_index",
            new=AsyncMock(return_value=index),
        ),
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
    index = [_index_entry(f"CPT-{i}") for i in range(3)]
    existing_ids = {f"TID-{i}": uuid4() for i in range(3)}
    persist_mock = AsyncMock()

    with (
        patch(
            "groundmodel.application.import_cpt_dov.DovClient.fetch_wfs_index",
            new=AsyncMock(return_value=index),
        ),
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
    """Mix of new and existing CPTs — counts both correctly."""
    parsed = [(f"CPT-{i}", _result(f"TID-{i}")) for i in range(4)]
    index = [_index_entry(f"CPT-{i}") for i in range(4)]
    # Mark TID-1 and TID-3 as already existing.
    existing_ids = {"TID-1": uuid4(), "TID-3": uuid4()}
    new_persist_ids = [uuid4(), uuid4()]
    persist_mock = AsyncMock(
        side_effect=[ImportCptResult(cpt_id=cid, issues=[]) for cid in new_persist_ids]
    )

    with (
        patch(
            "groundmodel.application.import_cpt_dov.DovClient.fetch_wfs_index",
            new=AsyncMock(return_value=index),
        ),
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
    index = [_index_entry(f"CPT-{i}") for i in range(3)]
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
            "groundmodel.application.import_cpt_dov.DovClient.fetch_wfs_index",
            new=AsyncMock(return_value=index),
        ),
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
    index = [_index_entry("CPT-1")]
    persist_mock = AsyncMock(side_effect=DuplicateCptError("race", existing_id=uuid4()))

    with (
        patch(
            "groundmodel.application.import_cpt_dov.DovClient.fetch_wfs_index",
            new=AsyncMock(return_value=index),
        ),
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
        def __init__(
            self, http: object, cache: object | None = None, backoff: object | None = None
        ) -> None:
            captured["cache"] = cache
            captured["backoff"] = backoff

        async def fetch_wfs_index(self, *_a: object, **_k: object) -> list:  # type: ignore[type-arg]
            """Return empty index so execute() short-circuits before fetch."""
            return []

        async def fetch_bbox_processed(self, *_a: object, **_k: object) -> list:  # type: ignore[type-arg]
            return []

    with patch("groundmodel.application.import_cpt_dov.DovClient", _FakeClient):
        await use_case.execute(west=3.0, south=51.0, east=3.1, north=51.1)

    assert captured["cache"] is use_case._cache


# ------------------------------------------------------------------
# pins_cb receives the WFS index before download phase
# ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pins_cb_receives_index_before_download(use_case: ImportCptDov):
    """pins_cb must be called with the full WfsIndexEntry list before any download.

    The SSE router wires this callback to emit the "pins" event so the map renders
    pending markers within ~1 s.  We verify (a) it is called with the right entries
    and (b) it fires BEFORE fetch_bbox_processed is awaited.
    """
    index = [_index_entry("CPT-A"), _index_entry("CPT-B")]
    parsed = [("CPT-A", _result("TID-A")), ("CPT-B", _result("TID-B"))]
    call_order: list[str] = []

    async def _fake_pins_cb(received_index: list[WfsIndexEntry]) -> None:
        call_order.append("pins_cb")
        assert received_index == index

    async def _fake_fetch_processed(*_a: object, **_k: object) -> list:  # type: ignore[type-arg]
        call_order.append("fetch_bbox_processed")
        return parsed

    persist_mock = AsyncMock(
        side_effect=[ImportCptResult(cpt_id=uuid4(), issues=[]) for _ in parsed]
    )

    with (
        patch(
            "groundmodel.application.import_cpt_dov.DovClient.fetch_wfs_index",
            new=AsyncMock(return_value=index),
        ),
        patch(
            "groundmodel.application.import_cpt_dov.DovClient.fetch_bbox_processed",
            new=_fake_fetch_processed,
        ),
        patch.object(use_case._repo, "find_existing_test_ids", new=AsyncMock(return_value={})),
        patch.object(use_case._import, "persist", new=persist_mock),
    ):
        await use_case.execute(west=3.0, south=51.0, east=3.1, north=51.1, pins_cb=_fake_pins_cb)

    # pins_cb fired before fetch_bbox_processed — the whole point of Phase 1-A.
    assert call_order[0] == "pins_cb"
    assert "fetch_bbox_processed" in call_order


# ------------------------------------------------------------------
# pins_cb = None is safe (no-op)
# ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_discovery_over_ceiling_stops_before_download(use_case: ImportCptDov):
    """Discovery above DOV_MAX_IMPORT_FEATURES raises before any download.

    Rule (Codex row 4): a request that would discover more than the ceiling stops
    after discovery with a too-large error naming the count and the limit, BEFORE
    any XML download. So fetch_bbox_processed must never be awaited, and the
    error carries both numbers.
    """
    from groundmodel.infrastructure.parsers.dov.dov_common import DOV_MAX_IMPORT_FEATURES
    from groundmodel.shared.exceptions import DovImportTooLargeError

    over = DOV_MAX_IMPORT_FEATURES + 1
    index = [_index_entry(f"CPT-{i}") for i in range(over)]
    download_mock = AsyncMock(return_value=[])
    pins_calls: list[int] = []

    async def _pins_cb(entries: list[WfsIndexEntry]) -> None:
        pins_calls.append(len(entries))

    with (
        patch(
            "groundmodel.application.import_cpt_dov.DovClient.fetch_wfs_index",
            new=AsyncMock(return_value=index),
        ),
        patch(
            "groundmodel.application.import_cpt_dov.DovClient.fetch_bbox_processed",
            new=download_mock,
        ),
    ):
        with pytest.raises(DovImportTooLargeError) as excinfo:
            await use_case.execute(west=3.0, south=51.0, east=3.1, north=51.1, pins_cb=_pins_cb)

    assert excinfo.value.discovered == over
    assert excinfo.value.limit == DOV_MAX_IMPORT_FEATURES
    assert str(over) in str(excinfo.value)
    assert str(DOV_MAX_IMPORT_FEATURES) in str(excinfo.value)
    download_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_discovery_at_ceiling_is_allowed(use_case: ImportCptDov):
    """Exactly DOV_MAX_IMPORT_FEATURES is allowed — the ceiling is a strict '>'."""
    from groundmodel.infrastructure.parsers.dov.dov_common import DOV_MAX_IMPORT_FEATURES

    index = [_index_entry(f"CPT-{i}") for i in range(DOV_MAX_IMPORT_FEATURES)]

    with (
        patch(
            "groundmodel.application.import_cpt_dov.DovClient.fetch_wfs_index",
            new=AsyncMock(return_value=index),
        ),
        patch(
            "groundmodel.application.import_cpt_dov.DovClient.fetch_bbox_processed",
            new=AsyncMock(return_value=[]),
        ),
        patch.object(use_case._repo, "find_existing_test_ids", new=AsyncMock(return_value={})),
    ):
        # No raise: at-limit imports proceed (download mock returns nothing).
        result = await use_case.execute(west=3.0, south=51.0, east=3.1, north=51.1)

    assert result.imported == 0


@pytest.mark.asyncio
async def test_pins_cb_none_is_noop(use_case: ImportCptDov):
    """Omitting pins_cb must not raise — all existing callers are unaffected."""
    index = [_index_entry("CPT-X")]
    parsed = [("CPT-X", _result("TID-X"))]
    persist_mock = AsyncMock(return_value=ImportCptResult(cpt_id=uuid4(), issues=[]))

    with (
        patch(
            "groundmodel.application.import_cpt_dov.DovClient.fetch_wfs_index",
            new=AsyncMock(return_value=index),
        ),
        patch(
            "groundmodel.application.import_cpt_dov.DovClient.fetch_bbox_processed",
            new=AsyncMock(return_value=parsed),
        ),
        patch.object(use_case._repo, "find_existing_test_ids", new=AsyncMock(return_value={})),
        patch.object(use_case._import, "persist", new=persist_mock),
    ):
        result = await use_case.execute(west=3.0, south=51.0, east=3.1, north=51.1)

    assert result.imported == 1
