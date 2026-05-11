"""Unit tests for the ImportInterpretationsDov use case (Phase C2).

DovInterpretationClient (network) and the persistence layer (session.add)
are mocked. We assert on:

* empty test_id map → fast-return, no client call, no session.add
* successful fetch → ObservationOrm rows added with correct borehole_id FK
* per-row persist failure → counted, others still attached
* parse-with-no-layers → dropped (no-op), not counted as attached
* interpretation routed to the right parent borehole via test_id lookup
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest

from groundmodel.application.import_interpretations_dov import ImportInterpretationsDov
from groundmodel.application.import_interpretations_dov_result import (
    ImportInterpretationsDovResult,
)
from groundmodel.domain.models.borehole.observation import Observation
from groundmodel.domain.models.borehole.observation_layer import ObservationLayer
from groundmodel.domain.value_objects.observation_type import ObservationType
from groundmodel.infrastructure.parsers.borehole.dov.interpretation_parse_result import (
    InterpretationParseResult,
)
from groundmodel.infrastructure.parsers.borehole.dov.interpretation_wfs_row import (
    InterpretationWfsRow,
)


def _wfs_row(
    *,
    test_id: str = "BH-1",
    permkey: str = "2025-300001",
    observation_type: ObservationType = ObservationType.CODED_LITHOLOGY,
) -> InterpretationWfsRow:
    """Build an InterpretationWfsRow with sensible test defaults."""
    return InterpretationWfsRow(
        permkey=permkey,
        test_id=test_id,
        observation_type=observation_type,
        fiche_url=f"https://www.dov.vlaanderen.be/data/interpretatie/{permkey}",
        xml_url=f"https://www.dov.vlaanderen.be/xdov/proxy/export/interpretatie/{permkey}",
    )


def _parse_result(
    *,
    borehole_id: UUID,
    observation_type: ObservationType = ObservationType.CODED_LITHOLOGY,
    n_layers: int = 2,
) -> InterpretationParseResult:
    """Build an InterpretationParseResult with N synthetic layers."""
    obs = Observation(
        borehole_id=borehole_id,
        observation_type=observation_type,
        author="Test Lab (Geolab)",
    )
    obs.layers = [
        ObservationLayer(
            observation_id=obs.id,
            top_m=float(i),
            base_m=float(i + 1),
            color="bruin",
            main_soil_codes=["LE"],
            description=None,
            layer_index=i,
        )
        for i in range(n_layers)
    ]
    return InterpretationParseResult(observation=obs, issues=[])


@pytest.fixture
def use_case() -> ImportInterpretationsDov:
    """ImportInterpretationsDov with a fully mocked AsyncSession.

    ``session.execute`` returns an empty result by default so the
    refresh-on-duplicate dedup helper finds "no existing observations"
    and lets the test assert on persist behaviour without separately
    stubbing the dedup query.
    """
    session = MagicMock()
    session.add = MagicMock()
    empty_result = MagicMock()
    empty_result.scalars.return_value = iter([])
    empty_result.all.return_value = []
    session.execute = AsyncMock(return_value=empty_result)
    return ImportInterpretationsDov(session)


# ---------------------------------------------------------------------------
# Empty map → fast return
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_empty_test_id_map_returns_zero_no_client_call(
    use_case: ImportInterpretationsDov,
) -> None:
    """No boreholes to attach to → zero result, client never invoked."""
    cache = MagicMock()
    http = MagicMock()

    # If the client were invoked, this would raise. The fast-return path
    # short-circuits before we even construct the client.
    with patch(
        "groundmodel.application.import_interpretations_dov.DovInterpretationClient",
        side_effect=AssertionError("DovInterpretationClient should not be constructed"),
    ):
        result = await use_case.execute(
            west=3.0,
            south=51.0,
            east=3.1,
            north=51.1,
            test_id_to_borehole_id={},
            cache=cache,
            http=http,
        )

    assert result == ImportInterpretationsDovResult()
    use_case._session.add.assert_not_called()  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Happy path — successful fetch + attach
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_successful_fetch_attaches_observations_to_correct_boreholes(
    use_case: ImportInterpretationsDov,
) -> None:
    """Two interpretations for two boreholes → both attached with right FK."""
    bh1 = uuid4()
    bh2 = uuid4()
    test_id_map = {"BH-1": bh1, "BH-2": bh2}

    parsed = [
        (
            _wfs_row(test_id="BH-1", permkey="2025-300001"),
            _parse_result(borehole_id=bh1, observation_type=ObservationType.CODED_LITHOLOGY),
        ),
        (
            _wfs_row(
                test_id="BH-2",
                permkey="2025-300002",
                observation_type=ObservationType.FORMAL_STRATIGRAPHY,
            ),
            _parse_result(
                borehole_id=bh2,
                observation_type=ObservationType.FORMAL_STRATIGRAPHY,
            ),
        ),
    ]

    added: list = []
    use_case._session.add = MagicMock(side_effect=lambda orm: added.append(orm))  # type: ignore[method-assign]

    with patch(
        "groundmodel.application.import_interpretations_dov."
        "DovInterpretationClient.fetch_bbox_processed",
        new=AsyncMock(return_value=parsed),
    ):
        result = await use_case.execute(
            west=3.0,
            south=51.0,
            east=3.1,
            north=51.1,
            test_id_to_borehole_id=test_id_map,
            cache=MagicMock(),
            http=MagicMock(),
        )

    assert result.fetched == 2
    assert result.attached == 2
    assert result.failed == 0
    assert result.skipped_no_borehole == 0
    # Per-stream breakdown lands in the result for the API summary.
    assert result.per_stream == {
        ObservationType.CODED_LITHOLOGY.value: 1,
        ObservationType.FORMAL_STRATIGRAPHY.value: 1,
    }

    # Both ORMs added with correct borehole_id and the right number of layers.
    assert len(added) == 2
    by_borehole = {orm.borehole_id: orm for orm in added}
    assert by_borehole[bh1].observation_type == ObservationType.CODED_LITHOLOGY.value
    assert by_borehole[bh2].observation_type == ObservationType.FORMAL_STRATIGRAPHY.value
    assert len(by_borehole[bh1].layers) == 2
    assert len(by_borehole[bh2].layers) == 2


# ---------------------------------------------------------------------------
# Empty-layers parse drops the observation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_observation_with_zero_layers_is_dropped(
    use_case: ImportInterpretationsDov,
) -> None:
    """A parse with no layers should not produce an ObservationOrm row.

    Per ``_build_orm`` returning ``None`` when ``layers`` is empty: we don't
    save observations the consumer can't render.
    """
    bh1 = uuid4()
    test_id_map = {"BH-1": bh1}

    parsed = [
        (
            _wfs_row(test_id="BH-1", permkey="2025-300001"),
            _parse_result(borehole_id=bh1, n_layers=0),
        ),
    ]

    use_case._session.add = MagicMock()  # type: ignore[method-assign]

    with patch(
        "groundmodel.application.import_interpretations_dov."
        "DovInterpretationClient.fetch_bbox_processed",
        new=AsyncMock(return_value=parsed),
    ):
        result = await use_case.execute(
            west=3.0,
            south=51.0,
            east=3.1,
            north=51.1,
            test_id_to_borehole_id=test_id_map,
            cache=MagicMock(),
            http=MagicMock(),
        )

    assert result.fetched == 1
    assert result.attached == 0
    assert result.skipped_no_borehole == 1
    use_case._session.add.assert_not_called()  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Per-row persist failure isolated
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_persist_failure_for_one_observation_does_not_abort_batch(
    use_case: ImportInterpretationsDov,
) -> None:
    """One session.add raises → only that one counted as failed, rest attached."""
    bh1 = uuid4()
    bh2 = uuid4()
    bh3 = uuid4()
    test_id_map = {"BH-1": bh1, "BH-2": bh2, "BH-3": bh3}

    parsed = [
        (_wfs_row(test_id="BH-1", permkey="2025-300001"), _parse_result(borehole_id=bh1)),
        (_wfs_row(test_id="BH-2", permkey="2025-300002"), _parse_result(borehole_id=bh2)),
        (_wfs_row(test_id="BH-3", permkey="2025-300003"), _parse_result(borehole_id=bh3)),
    ]

    # Second add() raises.
    side_effects: list = [None, RuntimeError("constraint violation"), None]
    use_case._session.add = MagicMock(side_effect=side_effects)  # type: ignore[method-assign]

    with patch(
        "groundmodel.application.import_interpretations_dov."
        "DovInterpretationClient.fetch_bbox_processed",
        new=AsyncMock(return_value=parsed),
    ):
        result = await use_case.execute(
            west=3.0,
            south=51.0,
            east=3.1,
            north=51.1,
            test_id_to_borehole_id=test_id_map,
            cache=MagicMock(),
            http=MagicMock(),
        )

    assert result.fetched == 3
    assert result.attached == 2
    assert result.failed == 1


# ---------------------------------------------------------------------------
# Issue #6 — WFS gap detection: has_<type>=True but no row from the
# corresponding interpretation WFS stream → WARNING + result.wfs_gaps++
# ---------------------------------------------------------------------------


def _borehole_wfs_row(
    *,
    test_id: str = "BH-1",
    permkey: str = "2024-216503",
    has_formal_stratigraphy: bool = True,
    has_geotechnical_coding: bool = False,
) -> BoreholeWfsRow:  # noqa: F821 — annotation resolved at runtime
    """Build a BoreholeWfsRow with sensible test defaults.

    All other flags default False; per-test flips set what the WFS
    cross-check should expect.
    """
    from groundmodel.infrastructure.parsers.borehole.dov.borehole_wfs_row import (
        BoreholeWfsRow,
    )

    return BoreholeWfsRow(
        permkey=permkey,
        test_id=test_id,
        fiche_url=f"https://www.dov.vlaanderen.be/data/boring/{permkey}",
        xml_url=f"https://www.dov.vlaanderen.be/xdov/proxy/export/boring/{permkey}",
        x=150000.0,
        y=200000.0,
        z=12.0,
        drill_method=None,
        municipality=None,
        executor=None,
        purpose=None,
        total_depth_m=None,
        has_coded_lithology=False,
        has_geotechnical_coding=has_geotechnical_coding,
        has_lithological_description=False,
        has_informal_stratigraphy=False,
        has_formal_stratigraphy=has_formal_stratigraphy,
        has_quaternary_stratigraphy=False,
        has_hydrogeological_stratigraphy=False,
        has_informal_hydrogeological_stratigraphy=False,
    )


@pytest.mark.asyncio
async def test_wfs_gap_warning_when_flag_true_but_no_row(
    use_case: ImportInterpretationsDov,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Issue #6: WFS says ``has_formal_stratigraphy=True`` but the
    ``interpretaties:formele_stratigrafie`` WFS returned no row for
    this borehole → log a WARNING and bump ``wfs_gaps``.
    """
    bh1 = uuid4()
    test_id_map = {"BH-1": bh1}
    wfs_row_map = {"BH-1": _borehole_wfs_row(has_formal_stratigraphy=True)}

    # WFS for formal_stratigraphy is empty (the issue's scenario).
    parsed: list = []

    with patch(
        "groundmodel.application.import_interpretations_dov."
        "DovInterpretationClient.fetch_bbox_processed",
        new=AsyncMock(return_value=parsed),
    ):
        with caplog.at_level("WARNING"):
            result = await use_case.execute(
                west=3.0,
                south=51.0,
                east=3.1,
                north=51.1,
                test_id_to_borehole_id=test_id_map,
                cache=MagicMock(),
                http=MagicMock(),
                wfs_row_map=wfs_row_map,
            )

    assert result.wfs_gaps == 1
    # WARNING should reference the borehole's permkey + the DOV data URL
    # so the engineer can click through and verify by hand.
    warning_lines = [rec.message for rec in caplog.records if rec.levelname == "WARNING"]
    gap_warnings = [w for w in warning_lines if "WFS gap" in w]
    assert len(gap_warnings) == 1
    assert "2024-216503" in gap_warnings[0]
    assert "has_formal_stratigraphy" in gap_warnings[0]
    assert "/data/boring/2024-216503" in gap_warnings[0]


@pytest.mark.asyncio
async def test_wfs_gap_silent_when_flag_matches_fetched_row(
    use_case: ImportInterpretationsDov,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """No gap to report when the WFS returned a row that satisfies the flag."""
    bh1 = uuid4()
    test_id_map = {"BH-1": bh1}
    wfs_row_map = {"BH-1": _borehole_wfs_row(has_formal_stratigraphy=True)}

    parsed = [
        (
            _wfs_row(
                test_id="BH-1",
                permkey="2025-300001",
                observation_type=ObservationType.FORMAL_STRATIGRAPHY,
            ),
            _parse_result(
                borehole_id=bh1,
                observation_type=ObservationType.FORMAL_STRATIGRAPHY,
            ),
        ),
    ]

    with patch(
        "groundmodel.application.import_interpretations_dov."
        "DovInterpretationClient.fetch_bbox_processed",
        new=AsyncMock(return_value=parsed),
    ):
        with caplog.at_level("WARNING"):
            result = await use_case.execute(
                west=3.0,
                south=51.0,
                east=3.1,
                north=51.1,
                test_id_to_borehole_id=test_id_map,
                cache=MagicMock(),
                http=MagicMock(),
                wfs_row_map=wfs_row_map,
            )

    assert result.wfs_gaps == 0
    gap_warnings = [
        rec.message
        for rec in caplog.records
        if rec.levelname == "WARNING" and "WFS gap" in rec.message
    ]
    assert gap_warnings == []


@pytest.mark.asyncio
async def test_wfs_gap_check_skipped_when_wfs_row_map_missing(
    use_case: ImportInterpretationsDov,
) -> None:
    """Backwards compatibility: omitting ``wfs_row_map`` keeps the old
    behaviour. ``wfs_gaps`` stays 0; no warnings.
    """
    bh1 = uuid4()
    test_id_map = {"BH-1": bh1}

    with patch(
        "groundmodel.application.import_interpretations_dov."
        "DovInterpretationClient.fetch_bbox_processed",
        new=AsyncMock(return_value=[]),
    ):
        result = await use_case.execute(
            west=3.0,
            south=51.0,
            east=3.1,
            north=51.1,
            test_id_to_borehole_id=test_id_map,
            cache=MagicMock(),
            http=MagicMock(),
        )
    assert result.wfs_gaps == 0
