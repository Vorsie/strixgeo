"""Unit tests for progress callback plumbing in DOV import use cases.

Covers:
- ``fire_progress`` helper: no-op on None, sync callback, async callback,
  exception swallowing.
- ``ImportCptDov.execute`` with a callback: every phase fires with
  monotonic ``done <= total``.
- Omitting the callback preserves identical behaviour to today (backward
  compat: all-zero result, single commit semantics unchanged).
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import polars as pl
import pytest

from groundmodel.application.import_cpt_dov import ImportCptDov
from groundmodel.application.import_cpt_result import ImportCptResult
from groundmodel.infrastructure.parsers.cpt.gef.cpt_type import CPTType
from groundmodel.infrastructure.parsers.cpt.gef.gef_header import GEFHeader
from groundmodel.infrastructure.parsers.cpt.gef.gef_parse_result import GEFParseResult
from groundmodel.shared.progress import fire_progress

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _result(test_id: str) -> GEFParseResult:
    """Minimal synthetic parse result accepted by persist."""
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


# ---------------------------------------------------------------------------
# fire_progress — unit tests for the shared helper
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fire_progress_none_is_noop() -> None:
    """Passing None is always a no-op — no exception, no side effects."""
    await fire_progress(None, "wfs", 10, 10)


@pytest.mark.asyncio
async def test_fire_progress_sync_callback_called_with_correct_args() -> None:
    """A synchronous callback receives (phase, done, total) as positional args."""
    received: list[tuple[str, int, int]] = []

    def cb(phase: str, done: int, total: int) -> None:
        received.append((phase, done, total))

    await fire_progress(cb, "download", 5, 20)

    assert received == [("download", 5, 20)]


@pytest.mark.asyncio
async def test_fire_progress_async_callback_is_awaited() -> None:
    """An async callback is properly awaited, not just called."""
    received: list[tuple[str, int, int]] = []

    async def cb(phase: str, done: int, total: int) -> None:
        # Yield once to verify we're in an async context.
        await asyncio.sleep(0)
        received.append((phase, done, total))

    await fire_progress(cb, "persist", 3, 10)

    assert received == [("persist", 3, 10)]


@pytest.mark.asyncio
async def test_fire_progress_swallows_sync_callback_exceptions() -> None:
    """A crashing sync callback must not propagate — import must continue."""

    def boom(_p: str, _d: int, _t: int) -> None:
        raise RuntimeError("broken SSE connection")

    # Must not raise.
    await fire_progress(boom, "commit", 1, 1)


@pytest.mark.asyncio
async def test_fire_progress_swallows_async_callback_exceptions() -> None:
    """A crashing async callback must not propagate either."""

    async def boom(_p: str, _d: int, _t: int) -> None:
        raise OSError("pipe closed")

    await fire_progress(boom, "wfs", 0, 0)


# ---------------------------------------------------------------------------
# ImportCptDov + progress_cb — monotonicity
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_progress_callback_fires_with_monotonic_done_lte_total(
    use_case: ImportCptDov,
) -> None:
    """Every progress event must satisfy done <= total and done is non-decreasing."""
    n = 5
    parsed = [(f"CPT-{i}", _result(f"TID-{i}")) for i in range(n)]
    persist_mock = AsyncMock(
        side_effect=[ImportCptResult(cpt_id=uuid4(), issues=[]) for _ in parsed]
    )

    events: list[tuple[str, int, int]] = []

    def cb(phase: str, done: int, total: int) -> None:
        events.append((phase, done, total))

    with (
        patch(
            "groundmodel.application.import_cpt_dov.DovClient.fetch_bbox_processed",
            new=AsyncMock(return_value=parsed),
        ),
        patch.object(use_case._repo, "find_existing_test_ids", new=AsyncMock(return_value={})),
        patch.object(use_case._import, "persist", new=persist_mock),
    ):
        result = await use_case.execute(
            west=3.0,
            south=51.0,
            east=3.1,
            north=51.1,
            progress_cb=cb,
        )

    assert result.imported == n
    assert len(events) > 0, "at least one progress event must fire"

    for phase, done, total in events:
        assert done <= total, f"done={done} > total={total} in phase {phase!r}"

    # done values within the persist phase must be non-decreasing.
    persist_dones = [done for phase, done, _ in events if phase == "persist"]
    assert persist_dones == sorted(persist_dones), "persist done values not monotonic"

    # A commit event must be the final progress event (after all per-row events).
    phase_sequence = [p for p, _, _ in events]
    assert "commit" in phase_sequence, "commit phase event missing"
    assert phase_sequence[-1] == "commit", "commit event must be last"


@pytest.mark.asyncio
async def test_progress_callback_fires_dedup_event(use_case: ImportCptDov) -> None:
    """The dedup phase event fires even when all CPTs are duplicates."""
    n = 3
    parsed = [(f"CPT-{i}", _result(f"TID-{i}")) for i in range(n)]
    existing_ids = {f"TID-{i}": uuid4() for i in range(n)}

    events: list[tuple[str, int, int]] = []

    def cb(phase: str, done: int, total: int) -> None:
        events.append((phase, done, total))

    with (
        patch(
            "groundmodel.application.import_cpt_dov.DovClient.fetch_bbox_processed",
            new=AsyncMock(return_value=parsed),
        ),
        patch.object(
            use_case._repo, "find_existing_test_ids", new=AsyncMock(return_value=existing_ids)
        ),
    ):
        result = await use_case.execute(
            west=3.0,
            south=51.0,
            east=3.1,
            north=51.1,
            progress_cb=cb,
        )

    assert result.duplicates == n
    phases = [p for p, _, _ in events]
    assert "dedup" in phases, "dedup phase event must fire even on all-duplicate input"


@pytest.mark.asyncio
async def test_progress_callback_fires_for_every_row_including_duplicates(
    use_case: ImportCptDov,
) -> None:
    """The persist phase fires once per row — new and duplicate alike.

    This ensures the progress bar advances smoothly rather than jumping
    only over the new rows.
    """
    n = 4
    parsed = [(f"CPT-{i}", _result(f"TID-{i}")) for i in range(n)]
    # 2 duplicates, 2 new.
    existing_ids = {"TID-0": uuid4(), "TID-2": uuid4()}
    persist_mock = AsyncMock(
        side_effect=[
            ImportCptResult(cpt_id=uuid4(), issues=[]),
            ImportCptResult(cpt_id=uuid4(), issues=[]),
        ]
    )

    events: list[tuple[str, int, int]] = []

    def cb(phase: str, done: int, total: int) -> None:
        events.append((phase, done, total))

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
        await use_case.execute(
            west=3.0,
            south=51.0,
            east=3.1,
            north=51.1,
            progress_cb=cb,
        )

    persist_events = [(d, t) for p, d, t in events if p == "persist"]
    # One persist-phase tick per row (4 total).
    assert len(persist_events) == n, (
        f"expected {n} persist ticks, got {len(persist_events)}: {persist_events}"
    )
    # done increments 1..n, total stays n throughout.
    for i, (done, total) in enumerate(persist_events, start=1):
        assert done == i, f"persist tick {i}: expected done={i}, got {done}"
        assert total == n, f"persist tick {i}: expected total={n}, got {total}"


# ---------------------------------------------------------------------------
# Backward compatibility — omitting progress_cb must not change behaviour
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_omitting_progress_cb_gives_identical_result(use_case: ImportCptDov) -> None:
    """No progress_cb → same result as today; no exception, no callback fires."""
    n = 3
    parsed = [(f"CPT-{i}", _result(f"TID-{i}")) for i in range(n)]
    ids = [uuid4() for _ in range(n)]
    persist_mock = AsyncMock(side_effect=[ImportCptResult(cpt_id=cid, issues=[]) for cid in ids])

    with (
        patch(
            "groundmodel.application.import_cpt_dov.DovClient.fetch_bbox_processed",
            new=AsyncMock(return_value=parsed),
        ),
        patch.object(use_case._repo, "find_existing_test_ids", new=AsyncMock(return_value={})),
        patch.object(use_case._import, "persist", new=persist_mock),
    ):
        # No progress_cb argument — must use default None path.
        result = await use_case.execute(west=3.0, south=51.0, east=3.1, north=51.1)

    assert result.imported == n
    assert result.duplicates == 0
    assert result.failed == 0
    assert len(result.cpt_ids) == n
    use_case._session.commit.assert_awaited_once()  # type: ignore[attr-defined]
