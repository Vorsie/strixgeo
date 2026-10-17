"""Tests for the refresh-on-duplicate dedup logic.

When the user re-imports a bbox they've imported before:
* The boreholes are duplicates (same test_id, already in DB).
* Phases 4b/4c MUST still run for them so newly-published children
  (interpretations / samples / lab tests) flow into the existing rows.
* Per-row dedup against ``dov_permkey`` keeps existing children intact
  — the same WFS row that produced an existing ORM row is silently
  skipped, while a new WFS row that has no counterpart in DB persists.

These tests exercise the dedup helpers and the orchestrators' use of
them, mocking the session.execute boundary to control "what's already
in the DB".
"""

from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from groundmodel.application.import_samples_dov import ImportSamplesDov
from groundmodel.infrastructure.parsers.borehole.dov.sample_wfs_row import SampleWfsRow
from groundmodel.infrastructure.parsers.lab.dov.scalar_observation_wfs_row import (
    ScalarObservationWfsRow,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _execute_results(*returns: object) -> AsyncMock:
    """Build an AsyncMock for session.execute that yields different results per call.

    Each entry in ``returns`` becomes the next result the mock yields.
    Each result is a MagicMock with ``scalars`` and ``all`` returning
    whatever the entry says.
    """
    iter_returns = iter(returns)

    def _result_for(*_args, **_kw):
        try:
            spec = next(iter_returns)
        except StopIteration:
            spec = ()
        result = MagicMock()
        if isinstance(spec, dict):
            result.scalars.return_value = iter(spec.keys())
            result.all.return_value = [(v, k) for k, v in spec.items()]
        else:
            # spec is iterable of permkeys
            permkeys = list(spec)
            result.scalars.return_value = iter(permkeys)
            result.all.return_value = []
        return result

    return AsyncMock(side_effect=_result_for)


def _sample_row(
    *,
    permkey: str,
    parent_permkey: str = "BH-PK",
    depth_top_m: float = 1.0,
    depth_base_m: float = 1.5,
) -> SampleWfsRow:
    return SampleWfsRow(
        permkey=permkey,
        parent_borehole_permkey=parent_permkey,
        monster_xml_url=f"https://www.dov.vlaanderen.be/data/monster/{permkey}",
        depth_top_m=depth_top_m,
        depth_base_m=depth_base_m,
        sample_number="N001",
        sample_type="ongeroerd",
        composition="Enkelvoudig monster",
        instrument="steekbus",
        sampling_date=date(2024, 1, 1),
        observation_count=0,
    )


def _scalar_row(
    *,
    permkey: str,
    parent_sample_permkey: str,
    parameter: str,
    parametergroep: str = "Bodem_chemisch",
) -> ScalarObservationWfsRow:
    return ScalarObservationWfsRow(
        permkey=permkey,
        parent_sample_permkey=parent_sample_permkey,
        parametergroep=parametergroep,
        parameter=parameter,
        resultaat="3.5",
        eenheid="%",
        methode="Calcimetrie",
        fenomeentijd=date(2024, 1, 1),
        detectieconditie=None,
    )


# ---------------------------------------------------------------------------
# dov_dedup helpers
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_existing_dov_permkeys_returns_set() -> None:
    """existing_dov_permkeys returns the set of permkeys already stored."""
    from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
    from groundmodel.infrastructure.db.repositories.dov_dedup import existing_dov_permkeys

    session = MagicMock()
    result = MagicMock()
    result.scalars.return_value = iter(["P1", "P2", None, "P3"])
    session.execute = AsyncMock(return_value=result)

    out = await existing_dov_permkeys(session, SampleOrm, "borehole_id", [uuid4()])
    # NULL permkeys (legacy rows) are filtered out.
    assert out == {"P1", "P2", "P3"}


@pytest.mark.asyncio
async def test_existing_dov_permkeys_empty_parent_set_skips_query() -> None:
    """No parents → no SELECT issued, returns empty set."""
    from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
    from groundmodel.infrastructure.db.repositories.dov_dedup import existing_dov_permkeys

    session = MagicMock()
    session.execute = AsyncMock()

    out = await existing_dov_permkeys(session, SampleOrm, "borehole_id", [])
    assert out == set()
    session.execute.assert_not_called()


@pytest.mark.asyncio
async def test_existing_dov_permkey_to_id_returns_mapping() -> None:
    """existing_dov_permkey_to_id returns {permkey: row_id} for existing rows."""
    from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
    from groundmodel.infrastructure.db.repositories.dov_dedup import (
        existing_dov_permkey_to_id,
    )

    session = MagicMock()
    id_a, id_b = uuid4(), uuid4()
    result = MagicMock()
    result.all.return_value = [(id_a, "P1"), (id_b, "P2")]
    session.execute = AsyncMock(return_value=result)

    out = await existing_dov_permkey_to_id(session, SampleOrm, "borehole_id", [uuid4()])
    assert out == {"P1": id_a, "P2": id_b}


# ---------------------------------------------------------------------------
# ImportSamplesDov refresh-on-duplicate paths
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _patch_scalar_observation_client():
    """Stub the scalar-observation client so these tests stay focused on dedup."""
    with patch(
        "groundmodel.application.import_samples_dov.DovScalarObservationClient.fetch_bbox",
        new=AsyncMock(return_value=[]),
    ):
        yield


@pytest.mark.asyncio
async def test_existing_sample_skipped_new_sample_persisted() -> None:
    """A bbox containing one existing + one new sample → only the new one persists.

    ``session.execute`` is staged with:
      1. existing samples for the borehole → {"P-EXIST": existing_id}
      2. existing scalar permkeys (caco3, organic, water, scalar) → empty
    """
    bh_id = uuid4()
    existing_sample_id = uuid4()

    session = MagicMock()
    add_calls: list = []
    session.add = MagicMock(side_effect=lambda orm: add_calls.append(orm))

    # Stage results: first call = sample existing-map ({permkey: id}); the
    # rest (atterberg/caco3/organic/water/scalar/grain-size) all return
    # empty sets.
    session.execute = _execute_results(
        {"P-EXIST": existing_sample_id},  # samples existing
        [],  # grain-size existing (called later)
        [],  # atterberg
        [],  # caco3
        [],  # organic
        [],  # water
        [],  # scalar
    )

    use_case = ImportSamplesDov(session)

    sample_rows = [
        _sample_row(permkey="P-EXIST", parent_permkey="BH-PK"),
        _sample_row(permkey="P-NEW", parent_permkey="BH-PK"),
    ]

    with (
        patch(
            "groundmodel.application.import_samples_dov.DovSampleClient.fetch_bbox",
            new=AsyncMock(return_value=sample_rows),
        ),
        patch(
            "groundmodel.application.import_samples_dov.DovGrainSizeClient.fetch_bbox_processed",
            new=AsyncMock(return_value=[]),
        ),
    ):
        result = await use_case.execute(
            west=0,
            south=0,
            east=1,
            north=1,
            permkey_to_borehole_id={"BH-PK": bh_id},
            sample_cache=MagicMock(),
            grain_size_cache=MagicMock(),
            http=MagicMock(),
        )

    # Existing sample skipped; new sample persisted.
    assert result.samples_attached == 1
    assert result.samples_skipped_already_present == 1
    sample_orms = [o for o in add_calls if type(o).__name__ == "SampleOrm"]
    assert len(sample_orms) == 1
    assert sample_orms[0].dov_permkey == "P-NEW"


@pytest.mark.asyncio
async def test_existing_scalar_lab_test_skipped() -> None:
    """A scalar lab test whose permkey is already stored → skipped, counter bumped."""
    from groundmodel.infrastructure.parsers.lab.dov.dov_constants import (
        DOV_PARAMETER_GRAIN_DENSITY,
    )

    bh_id = uuid4()

    # Setup: one existing sample with one already-present scalar lab test.
    existing_sample_id = uuid4()

    session = MagicMock()
    add_calls: list = []
    session.add = MagicMock(side_effect=lambda orm: add_calls.append(orm))

    session.execute = _execute_results(
        {"P-EXIST": existing_sample_id},  # sample existing-map
        [],  # grain-size existing
        [],  # atterberg
        [],  # caco3
        [],  # organic
        [],  # water
        ["O-EXIST"],  # scalar — this permkey is already stored
    )

    use_case = ImportSamplesDov(session)

    # WFS returns 2 scalar tests on the existing sample: one already
    # stored (skip), one new (persist).
    other_rows = [
        _scalar_row(
            permkey="O-EXIST",
            parent_sample_permkey="P-EXIST",
            parameter=DOV_PARAMETER_GRAIN_DENSITY,
            parametergroep="Volumemassa-watergehalte ",
        ),
        _scalar_row(
            permkey="O-NEW",
            parent_sample_permkey="P-EXIST",
            parameter=DOV_PARAMETER_GRAIN_DENSITY,
            parametergroep="Volumemassa-watergehalte ",
        ),
    ]

    async def _scalar_side(*_args, **_kw):
        # 5 scalar streams: atterberg, caco3, organic, water, other
        # All empty except the catch-all (other).
        if not hasattr(_scalar_side, "calls"):
            _scalar_side.calls = 0
        _scalar_side.calls += 1
        return other_rows if _scalar_side.calls == 5 else []

    with (
        patch(
            "groundmodel.application.import_samples_dov.DovSampleClient.fetch_bbox",
            new=AsyncMock(return_value=[]),
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
        result = await use_case.execute(
            west=0,
            south=0,
            east=1,
            north=1,
            permkey_to_borehole_id={"BH-PK": bh_id},
            sample_cache=MagicMock(),
            grain_size_cache=MagicMock(),
            http=MagicMock(),
        )

    # Only the new scalar test landed; the existing one was skipped.
    assert result.scalar_lab_tests_attached == 1
    assert result.scalar_lab_tests_skipped_already_present == 1
    scalar_orms = [o for o in add_calls if type(o).__name__ == "ScalarLabTestOrm"]
    assert len(scalar_orms) == 1
    assert scalar_orms[0].dov_permkey == "O-NEW"
