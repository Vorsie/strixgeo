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
    """ImportInterpretationsDov with a fully mocked AsyncSession."""
    session = MagicMock()
    session.add = MagicMock()
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
