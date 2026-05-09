"""Unit tests for the ImportSamplesDov use case (Phase C3).

DovSampleClient + DovGrainSizeClient (network) and the persistence layer
(session.add) are mocked. We assert on:

* empty permkey map → fast-return, no client call, no session.add
* successful sample fetch → SampleOrm rows added with correct borehole_id
* sample for unknown borehole → skipped (defensive — should be filtered
  client-side anyway)
* successful grain-size fetch → GrainSizeOrm rows added with correct
  sample_id
* grain-size with empty curve → counted as failed, not persisted
* per-row sample persist failure → counted, others still attached
* per-row grain-size persist failure → counted, others still attached
"""

from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest

from groundmodel.application.import_samples_dov import ImportSamplesDov
from groundmodel.application.import_samples_dov_result import ImportSamplesDovResult
from groundmodel.domain.models.lab.grain_size import GrainSize
from groundmodel.infrastructure.parsers.borehole.dov.sample_wfs_row import SampleWfsRow
from groundmodel.infrastructure.parsers.lab.dov.grain_size_parse_result import (
    GrainSizeParseResult,
)
from groundmodel.infrastructure.parsers.lab.dov.grain_size_wfs_row import GrainSizeWfsRow


def _sample_row(
    *,
    permkey: str = "2017-137886",
    parent_permkey: str = "2025-200001",
    depth_top_m: float | None = 5.0,
    depth_base_m: float | None = 6.0,
) -> SampleWfsRow:
    """Build a SampleWfsRow with sensible test defaults."""
    return SampleWfsRow(
        permkey=permkey,
        parent_borehole_permkey=parent_permkey,
        monster_xml_url=f"https://www.dov.vlaanderen.be/data/monster/{permkey}",
        depth_top_m=depth_top_m,
        depth_base_m=depth_base_m,
        sample_number="0",
        sample_type="geroerd",
        composition="Enkelvoudig monster",
        instrument="spoelboor",
        sampling_date=date(2025, 6, 13),
        observation_count=2,
    )


def _gs_row(
    *,
    permkey: str = "2022-2618228",
    parent_sample_permkey: str = "2017-137886",
) -> GrainSizeWfsRow:
    """Build a GrainSizeWfsRow with sensible test defaults."""
    return GrainSizeWfsRow(
        permkey=permkey,
        parent_sample_permkey=parent_sample_permkey,
        fiche_url=f"https://www.dov.vlaanderen.be/data/observatie/{permkey}",
        xml_url=f"https://www.dov.vlaanderen.be/xdov/proxy/export/observatie/{permkey}",
    )


def _gs_parse_result(
    *,
    sample_id: UUID,
    n_points: int = 5,
    method: str = "Zeving",
) -> GrainSizeParseResult:
    """Build a GrainSizeParseResult with N synthetic curve points."""
    diameters = [0.063 * (2.0**i) for i in range(n_points)]
    pcts = [95.0 - 10.0 * i for i in range(n_points)]
    grain_size = GrainSize(
        sample_id=sample_id,
        diameters_mm=diameters,
        pct_larger=pcts,
        method=method,
        test_date=date(2002, 11, 26),
        lime_removed=False,
        organics_removed=False,
    )
    return GrainSizeParseResult(grain_size=grain_size, issues=[])


def _gs_empty_curve(*, sample_id: UUID) -> GrainSizeParseResult:
    """Build a GrainSizeParseResult with an empty curve (parser flagged INVALID_CURVE)."""
    grain_size = GrainSize(
        sample_id=sample_id,
        diameters_mm=[],
        pct_larger=[],
        method=None,
        test_date=None,
        lime_removed=None,
        organics_removed=None,
    )
    return GrainSizeParseResult(grain_size=grain_size, issues=[])


@pytest.fixture
def use_case() -> ImportSamplesDov:
    """ImportSamplesDov with a fully mocked AsyncSession."""
    session = MagicMock()
    session.add = MagicMock()
    return ImportSamplesDov(session)


# ---------------------------------------------------------------------------
# Empty map — fast return
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_empty_permkey_map_returns_zero_no_client_call(
    use_case: ImportSamplesDov,
) -> None:
    """No boreholes to attach to → zero result, neither client invoked."""
    with patch(
        "groundmodel.application.import_samples_dov.DovSampleClient",
        side_effect=AssertionError("DovSampleClient should not be constructed"),
    ):
        result = await use_case.execute(
            west=3.0,
            south=51.0,
            east=3.1,
            north=51.1,
            permkey_to_borehole_id={},
            sample_cache=MagicMock(),
            grain_size_cache=MagicMock(),
            http=MagicMock(),
        )

    assert result == ImportSamplesDovResult()
    use_case._session.add.assert_not_called()  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Happy path — samples + grain-sizes attach with correct FKs
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_full_pipeline_attaches_samples_and_grain_sizes(
    use_case: ImportSamplesDov,
) -> None:
    """Two samples for two boreholes, one grain-size each → all attached."""
    bh1 = uuid4()
    bh2 = uuid4()
    permkey_map = {"2025-200001": bh1, "2025-200002": bh2}

    sample_rows = [
        _sample_row(permkey="2017-100001", parent_permkey="2025-200001"),
        _sample_row(permkey="2017-100002", parent_permkey="2025-200002"),
    ]

    added: list = []
    use_case._session.add = MagicMock(  # type: ignore[method-assign]
        side_effect=lambda orm: added.append(orm)
    )

    # The grain-size client receives a parser-closure — we can't introspect
    # the closure cleanly, so we mock its return value directly. Each tuple
    # is (row, parse_result); we resolve sample_id from the post-add order.

    def _gs_fetch_mock(west, south, east, north, process, parent_permkeys=None):
        # Look up sample IDs from the orm rows we just added so we use real UUIDs.
        sample_id_by_permkey = {
            row.permkey: orm.id for orm, row in zip(added, sample_rows, strict=True)
        }
        rows = [
            _gs_row(permkey="2022-100001", parent_sample_permkey="2017-100001"),
            _gs_row(permkey="2022-100002", parent_sample_permkey="2017-100002"),
        ]
        return [
            (
                rows[0],
                _gs_parse_result(sample_id=sample_id_by_permkey["2017-100001"]),
            ),
            (
                rows[1],
                _gs_parse_result(sample_id=sample_id_by_permkey["2017-100002"]),
            ),
        ]

    with (
        patch(
            "groundmodel.application.import_samples_dov.DovSampleClient.fetch_bbox",
            new=AsyncMock(return_value=sample_rows),
        ),
        patch(
            "groundmodel.application.import_samples_dov.DovGrainSizeClient.fetch_bbox_processed",
            new=AsyncMock(side_effect=_gs_fetch_mock),
        ),
    ):
        result = await use_case.execute(
            west=3.0,
            south=51.0,
            east=3.1,
            north=51.1,
            permkey_to_borehole_id=permkey_map,
            sample_cache=MagicMock(),
            grain_size_cache=MagicMock(),
            http=MagicMock(),
        )

    assert result.samples_attached == 2
    assert result.samples_failed == 0
    assert result.samples_skipped_no_borehole == 0
    assert result.grain_sizes_fetched == 2
    assert result.grain_sizes_attached == 2
    assert result.grain_sizes_failed == 0

    # 2 samples + 2 grain-sizes added in total.
    assert len(added) == 4


# ---------------------------------------------------------------------------
# Empty grain-size curve drops the row but still counts as failed
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_grain_size_with_empty_curve_is_dropped_and_counted_failed(
    use_case: ImportSamplesDov,
) -> None:
    """Parse with empty curve → not added, counted as failed."""
    bh = uuid4()
    sample_rows = [_sample_row(permkey="S1", parent_permkey="BH-PK")]

    added: list = []
    use_case._session.add = MagicMock(  # type: ignore[method-assign]
        side_effect=lambda orm: added.append(orm)
    )

    def _gs_fetch_mock(west, south, east, north, process, parent_permkeys=None):
        sample_id = added[0].id  # the SampleOrm we just added
        return [
            (
                _gs_row(permkey="GS1", parent_sample_permkey="S1"),
                _gs_empty_curve(sample_id=sample_id),
            )
        ]

    with (
        patch(
            "groundmodel.application.import_samples_dov.DovSampleClient.fetch_bbox",
            new=AsyncMock(return_value=sample_rows),
        ),
        patch(
            "groundmodel.application.import_samples_dov.DovGrainSizeClient.fetch_bbox_processed",
            new=AsyncMock(side_effect=_gs_fetch_mock),
        ),
    ):
        result = await use_case.execute(
            west=3.0,
            south=51.0,
            east=3.1,
            north=51.1,
            permkey_to_borehole_id={"BH-PK": bh},
            sample_cache=MagicMock(),
            grain_size_cache=MagicMock(),
            http=MagicMock(),
        )

    assert result.samples_attached == 1
    assert result.grain_sizes_fetched == 1
    assert result.grain_sizes_attached == 0
    assert result.grain_sizes_failed == 1
    # Only the SampleOrm was added — no GrainSizeOrm.
    assert len(added) == 1


# ---------------------------------------------------------------------------
# Per-row sample persist failure isolated
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_per_sample_persist_failure_does_not_abort_batch(
    use_case: ImportSamplesDov,
) -> None:
    """One sample.add raises → only that one counted, rest still attached.

    Subsequent grain-size phase still runs but skips observations belonging
    to the failed sample (its permkey isn't in the post-add map).
    """
    bh = uuid4()

    sample_rows = [
        _sample_row(permkey="S1", parent_permkey="BH-PK"),
        _sample_row(permkey="S2", parent_permkey="BH-PK"),
        _sample_row(permkey="S3", parent_permkey="BH-PK"),
    ]

    added_orms: list = []
    call_count = {"n": 0}

    def _add(orm):
        # Second call (S2) fails — count every call regardless of outcome.
        call_count["n"] += 1
        if call_count["n"] == 2:
            raise RuntimeError("constraint violation")
        added_orms.append(orm)

    use_case._session.add = MagicMock(side_effect=_add)  # type: ignore[method-assign]

    with (
        patch(
            "groundmodel.application.import_samples_dov.DovSampleClient.fetch_bbox",
            new=AsyncMock(return_value=sample_rows),
        ),
        patch(
            "groundmodel.application.import_samples_dov.DovGrainSizeClient.fetch_bbox_processed",
            new=AsyncMock(return_value=[]),  # no grain-sizes for this test
        ),
    ):
        result = await use_case.execute(
            west=3.0,
            south=51.0,
            east=3.1,
            north=51.1,
            permkey_to_borehole_id={"BH-PK": bh},
            sample_cache=MagicMock(),
            grain_size_cache=MagicMock(),
            http=MagicMock(),
        )

    assert result.samples_attached == 2
    assert result.samples_failed == 1
