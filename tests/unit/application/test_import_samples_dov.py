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


@pytest.fixture(autouse=True)
def _patch_scalar_observation_client():
    """Stub the Phase C4 scalar-observation client so C3 tests never hit DOV.

    The C3 happy-path tests assert on sample / grain-size counts only; they
    don't care about scalar lab tests. We replace
    ``DovScalarObservationClient.fetch_bbox`` with a no-op returning an empty
    list. The four scalar-specific tests below override this fixture inline
    when they need real return values.
    """
    with patch(
        "groundmodel.application.import_samples_dov.DovScalarObservationClient.fetch_bbox",
        new=AsyncMock(return_value=[]),
    ):
        yield


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


# ---------------------------------------------------------------------------
# Phase C4 — scalar lab tests (Atterberg / CaCO3 / organic / water)
# ---------------------------------------------------------------------------

from groundmodel.infrastructure.parsers.lab.dov.dov_constants import (  # noqa: E402
    DOV_DETECTIECONDITIE_NOT_MEASURABLE,
    DOV_PARAMETER_ATTERBERG_LIQUID_LIMIT,
    DOV_PARAMETER_ATTERBERG_PLASTIC_LIMIT,
    DOV_PARAMETER_CACO3,
    DOV_PARAMETER_ORGANIC_CARBON,
    DOV_PARAMETER_WATER_CONTENT,
)
from groundmodel.infrastructure.parsers.lab.dov.scalar_observation_wfs_row import (  # noqa: E402
    ScalarObservationWfsRow,
)


def _scalar_row(
    *,
    permkey: str,
    parent: str,
    parameter: str,
    resultaat: str | None = "1.5",
    methode: str | None = "Calcimetrie",
    detectieconditie: str | None = None,
) -> ScalarObservationWfsRow:
    """Build a ScalarObservationWfsRow with sensible test defaults."""
    return ScalarObservationWfsRow(
        permkey=permkey,
        parent_sample_permkey=parent,
        parameter=parameter,
        resultaat=resultaat,
        eenheid="%",
        methode=methode,
        fenomeentijd=date(2020, 1, 15),
        detectieconditie=detectieconditie,
    )


async def _run_with_scalar_returns(
    use_case: ImportSamplesDov,
    *,
    permkey_map: dict[str, UUID],
    sample_rows: list,
    atterberg: list,
    caco3: list,
    organic: list,
    water: list,
):
    """Drive the orchestrator with empty grain-size + custom scalar returns.

    The scalar client's ``fetch_bbox`` is called four times inside
    ``asyncio.gather`` (Atterberg, CaCO3, organic, water) — order matches
    the call order in ``_fetch_and_attach_scalar_lab_tests``. We dispense
    different lists per invocation via ``side_effect`` queue.
    """
    scalar_calls: list[list] = [atterberg, caco3, organic, water]

    async def _scalar_side(*args, **kwargs):
        return scalar_calls.pop(0)

    with (
        patch(
            "groundmodel.application.import_samples_dov.DovSampleClient.fetch_bbox",
            new=AsyncMock(return_value=sample_rows),
        ),
        patch(
            "groundmodel.application.import_samples_dov.DovGrainSizeClient.fetch_bbox_processed",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "groundmodel.application.import_samples_dov.DovScalarObservationClient.fetch_bbox",
            new=AsyncMock(side_effect=_scalar_side),
        ),
    ):
        return await use_case.execute(
            west=3.0,
            south=51.0,
            east=3.1,
            north=51.1,
            permkey_to_borehole_id=permkey_map,
            sample_cache=MagicMock(),
            grain_size_cache=MagicMock(),
            http=MagicMock(),
        )


@pytest.mark.asyncio
async def test_caco3_observation_attached_to_sample(
    use_case: ImportSamplesDov,
) -> None:
    """One CaCO3 row → one CaCO3ContentOrm with the right value + sample_id."""
    bh = uuid4()
    sample_rows = [_sample_row(permkey="S1", parent_permkey="BH-PK")]

    added: list = []
    use_case._session.add = MagicMock(  # type: ignore[method-assign]
        side_effect=lambda orm: added.append(orm)
    )

    caco3 = [
        _scalar_row(permkey="O1", parent="S1", parameter=DOV_PARAMETER_CACO3, resultaat="3.45")
    ]
    result = await _run_with_scalar_returns(
        use_case,
        permkey_map={"BH-PK": bh},
        sample_rows=sample_rows,
        atterberg=[],
        caco3=caco3,
        organic=[],
        water=[],
    )

    assert result.caco3_attached == 1
    assert result.caco3_failed == 0
    caco3_orms = [o for o in added if type(o).__name__ == "CaCO3ContentOrm"]
    assert len(caco3_orms) == 1
    assert caco3_orms[0].content_pct == pytest.approx(3.45)
    # FK to the SampleOrm we just added.
    assert caco3_orms[0].sample_id == added[0].id


@pytest.mark.asyncio
async def test_water_content_value_above_100_accepted(
    use_case: ImportSamplesDov,
) -> None:
    """Water content can exceed 100 % for peat / quick clays — must be accepted."""
    bh = uuid4()
    sample_rows = [_sample_row(permkey="S1", parent_permkey="BH-PK")]
    use_case._session.add = MagicMock()  # type: ignore[method-assign]

    rows = [
        _scalar_row(
            permkey="O1",
            parent="S1",
            parameter=DOV_PARAMETER_WATER_CONTENT,
            resultaat="450.0",  # peat-like
        )
    ]
    result = await _run_with_scalar_returns(
        use_case,
        permkey_map={"BH-PK": bh},
        sample_rows=sample_rows,
        atterberg=[],
        caco3=[],
        organic=[],
        water=rows,
    )

    assert result.water_content_attached == 1
    assert result.water_content_failed == 0


@pytest.mark.asyncio
async def test_organic_carbon_only_carbon_pct_set_matter_pct_none(
    use_case: ImportSamplesDov,
) -> None:
    """DOV ships organic CARBON; matter_pct must remain None (no auto-conversion)."""
    bh = uuid4()
    sample_rows = [_sample_row(permkey="S1", parent_permkey="BH-PK")]
    added: list = []
    use_case._session.add = MagicMock(  # type: ignore[method-assign]
        side_effect=lambda orm: added.append(orm)
    )

    rows = [
        _scalar_row(
            permkey="O1",
            parent="S1",
            parameter=DOV_PARAMETER_ORGANIC_CARBON,
            resultaat="1.38",
            methode="TOC by CN analyser",
        )
    ]
    result = await _run_with_scalar_returns(
        use_case,
        permkey_map={"BH-PK": bh},
        sample_rows=sample_rows,
        atterberg=[],
        caco3=[],
        organic=rows,
        water=[],
    )
    assert result.organic_attached == 1
    org_orms = [o for o in added if type(o).__name__ == "OrganicContentOrm"]
    assert org_orms[0].carbon_pct == pytest.approx(1.38)
    assert org_orms[0].matter_pct is None


@pytest.mark.asyncio
async def test_atterberg_ll_pl_aggregated_into_one_row(
    use_case: ImportSamplesDov,
) -> None:
    """One sample with LL + PL rows → one AtterbergLimitsOrm with both fields."""
    bh = uuid4()
    sample_rows = [_sample_row(permkey="S1", parent_permkey="BH-PK")]
    added: list = []
    use_case._session.add = MagicMock(  # type: ignore[method-assign]
        side_effect=lambda orm: added.append(orm)
    )

    atterberg = [
        _scalar_row(
            permkey="OLL",
            parent="S1",
            parameter=DOV_PARAMETER_ATTERBERG_LIQUID_LIMIT,
            resultaat="42.5",
        ),
        _scalar_row(
            permkey="OPL",
            parent="S1",
            parameter=DOV_PARAMETER_ATTERBERG_PLASTIC_LIMIT,
            resultaat="22.0",
        ),
    ]
    result = await _run_with_scalar_returns(
        use_case,
        permkey_map={"BH-PK": bh},
        sample_rows=sample_rows,
        atterberg=atterberg,
        caco3=[],
        organic=[],
        water=[],
    )
    assert result.atterberg_attached == 1
    att_orms = [o for o in added if type(o).__name__ == "AtterbergLimitsOrm"]
    assert len(att_orms) == 1
    assert att_orms[0].liquid_limit_pct == pytest.approx(42.5)
    assert att_orms[0].plastic_limit_pct == pytest.approx(22.0)
    assert att_orms[0].non_plastic is None


@pytest.mark.asyncio
async def test_atterberg_pl_with_nm_marks_non_plastic(
    use_case: ImportSamplesDov,
) -> None:
    """A PL row with detectieconditie='NM' → AtterbergLimits.non_plastic=True."""
    bh = uuid4()
    sample_rows = [_sample_row(permkey="S1", parent_permkey="BH-PK")]
    added: list = []
    use_case._session.add = MagicMock(  # type: ignore[method-assign]
        side_effect=lambda orm: added.append(orm)
    )

    atterberg = [
        _scalar_row(
            permkey="OLL",
            parent="S1",
            parameter=DOV_PARAMETER_ATTERBERG_LIQUID_LIMIT,
            resultaat="55.0",
        ),
        _scalar_row(
            permkey="OPL",
            parent="S1",
            parameter=DOV_PARAMETER_ATTERBERG_PLASTIC_LIMIT,
            resultaat=None,
            detectieconditie=DOV_DETECTIECONDITIE_NOT_MEASURABLE,
        ),
    ]
    result = await _run_with_scalar_returns(
        use_case,
        permkey_map={"BH-PK": bh},
        sample_rows=sample_rows,
        atterberg=atterberg,
        caco3=[],
        organic=[],
        water=[],
    )
    assert result.atterberg_attached == 1
    att = [o for o in added if type(o).__name__ == "AtterbergLimitsOrm"][0]
    assert att.liquid_limit_pct == pytest.approx(55.0)
    assert att.plastic_limit_pct is None
    assert att.non_plastic is True


@pytest.mark.asyncio
async def test_scalar_phase_network_error_marks_all_failed(
    use_case: ImportSamplesDov,
) -> None:
    """asyncio.gather on the 4 scalar queries raises → all 4 counters bumped."""
    import httpx

    bh = uuid4()
    sample_rows = [_sample_row(permkey="S1", parent_permkey="BH-PK")]
    use_case._session.add = MagicMock()  # type: ignore[method-assign]

    with (
        patch(
            "groundmodel.application.import_samples_dov.DovSampleClient.fetch_bbox",
            new=AsyncMock(return_value=sample_rows),
        ),
        patch(
            "groundmodel.application.import_samples_dov.DovGrainSizeClient.fetch_bbox_processed",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "groundmodel.application.import_samples_dov.DovScalarObservationClient.fetch_bbox",
            new=AsyncMock(side_effect=httpx.ConnectError("down")),
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

    # One sample in the map → all four scalar streams marked failed=1.
    assert result.atterberg_failed == 1
    assert result.caco3_failed == 1
    assert result.organic_failed == 1
    assert result.water_content_failed == 1
    assert result.atterberg_attached == 0
    # Sample itself still attached.
    assert result.samples_attached == 1
