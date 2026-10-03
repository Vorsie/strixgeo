"""ImportBoreholeDov.execute_by_name — fetch ONE borehole from DOV into a project.

Owner 2026-09-30: when a lab test names a borehole the project does not hold,
"auto load from DOV ... and throw exception if it can't be found". The by-name
import reuses the bbox import's building blocks: the per-permkey download +
parse (``fetch_rows_processed``), the same persist phase, the same
interpretation + sample phases (over a small box around the one borehole), one
commit. Network and database are mocked.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from groundmodel.application.import_borehole_dov import ImportBoreholeDov
from groundmodel.application.import_interpretations_dov_result import (
    ImportInterpretationsDovResult,
)
from groundmodel.application.import_samples_dov_result import ImportSamplesDovResult
from groundmodel.domain.models.borehole.borehole import Borehole
from groundmodel.infrastructure.parsers.borehole.dov.borehole_parse_result import (
    BoreholeParseResult,
)
from groundmodel.infrastructure.parsers.borehole.dov.borehole_wfs_row import BoreholeWfsRow

_MOD = "groundmodel.application.import_borehole_dov"
_NAME = "GEO-25/022-B17"


def _row() -> BoreholeWfsRow:
    """The DOV WFS row of the one borehole (Lambert 72, in Flanders)."""
    return BoreholeWfsRow(
        permkey="2025-012345",
        test_id=_NAME,
        fiche_url="https://www.dov.vlaanderen.be/data/boring/2025-012345",
        xml_url="https://www.dov.vlaanderen.be/xdov/proxy/export/boring/2025-012345",
        x=152000.0,
        y=212000.0,
        z=6.1,
        drill_method=None,
        municipality=None,
        executor=None,
        purpose=None,
        total_depth_m=20.0,
        has_coded_lithology=False,
        has_geotechnical_coding=False,
        has_lithological_description=True,
        has_informal_stratigraphy=False,
        has_formal_stratigraphy=False,
        has_quaternary_stratigraphy=False,
        has_hydrogeological_stratigraphy=False,
        has_informal_hydrogeological_stratigraphy=False,
    )


def _parsed() -> BoreholeParseResult:
    """A clean parse of the boring XML."""
    return BoreholeParseResult(
        borehole=Borehole(
            name=_NAME,
            location_x=152000.0,
            location_y=212000.0,
            elevation_m=6.1,
            epsg=31370,
            z_epsg=5710,
            total_depth_m=20.0,
        ),
        drill_segments=[],
        field_log=[],
        issues=[],
    )


@pytest.fixture
def use_case() -> ImportBoreholeDov:
    """The use case over a mocked session + repository."""
    session = MagicMock()
    session.commit = AsyncMock()
    uc = ImportBoreholeDov(session)
    uc._repo.find_existing_test_ids = AsyncMock(return_value={})  # type: ignore[method-assign]
    uc._repo.save = AsyncMock()  # type: ignore[method-assign]
    return uc


@pytest.mark.asyncio
async def test_a_borehole_dov_has_is_imported_into_the_project(
    use_case: ImportBoreholeDov,
) -> None:
    """Found → downloaded, parsed, persisted with its children, one commit."""
    project = uuid4()
    interp = AsyncMock(return_value=ImportInterpretationsDovResult())
    samples = AsyncMock(return_value=ImportSamplesDovResult())
    with (
        patch(f"{_MOD}.DovBoreholeClient.find_by_name", new=AsyncMock(return_value=_row())),
        patch(
            f"{_MOD}.DovBoreholeClient.fetch_rows_processed",
            new=AsyncMock(return_value=[(_row(), _parsed())]),
        ),
        patch(f"{_MOD}.ImportInterpretationsDov.execute", new=interp),
        patch(f"{_MOD}.ImportSamplesDov.execute", new=samples),
    ):
        result = await use_case.execute_by_name(_NAME, app_project_id=project)

    assert result.found is True
    assert result.dov_name == _NAME
    assert result.borehole_id is not None
    assert result.batch is not None and result.batch.imported == 1
    saved = use_case._repo.save.await_args.args[0]  # type: ignore[attr-defined]
    assert saved.test_id == _NAME and saved.app_project_id == project
    use_case._session.commit.assert_awaited_once()  # type: ignore[attr-defined]
    # The interpretation + sample phases run over a SMALL box around the borehole
    # (WGS84 west, south, east, north), so its streams come along.
    west, south, east, north = interp.await_args.args[:4]
    assert west < east and south < north
    assert east - west < 0.01 and north - south < 0.01


@pytest.mark.asyncio
async def test_a_borehole_dov_does_not_have_writes_nothing(use_case: ImportBoreholeDov) -> None:
    """Not on DOV → ``found`` False, nothing downloaded, nothing committed."""
    fetch = AsyncMock()
    with (
        patch(f"{_MOD}.DovBoreholeClient.find_by_name", new=AsyncMock(return_value=None)),
        patch(f"{_MOD}.DovBoreholeClient.fetch_rows_processed", new=fetch),
    ):
        result = await use_case.execute_by_name(_NAME, app_project_id=uuid4())

    assert result.found is False
    assert result.borehole_id is None
    fetch.assert_not_awaited()
    use_case._session.commit.assert_not_called()  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_a_borehole_whose_xml_fails_to_download_is_not_found(
    use_case: ImportBoreholeDov,
) -> None:
    """The WFS knows it but the XML download / parse fails → no borehole id."""
    with (
        patch(f"{_MOD}.DovBoreholeClient.find_by_name", new=AsyncMock(return_value=_row())),
        patch(f"{_MOD}.DovBoreholeClient.fetch_rows_processed", new=AsyncMock(return_value=[])),
    ):
        result = await use_case.execute_by_name(_NAME, app_project_id=uuid4())

    assert result.found is True
    assert result.borehole_id is None


# --- Owner dogfeed 2026-10-03: a second lab preview inserted a duplicate -> 500 ---


@pytest.mark.asyncio
async def test_a_borehole_already_in_the_project_is_returned_not_downloaded_again(
    use_case: ImportBoreholeDov,
) -> None:
    """The project already holds (project, 'DOV', test_id) → that borehole is
    returned; no XML download, no new BoreholeOrm, nothing committed."""
    existing = uuid4()
    use_case._repo.find_existing_test_ids = AsyncMock(  # type: ignore[method-assign]
        return_value={_NAME: existing}
    )
    download = AsyncMock(return_value=[(_row(), _parsed())])
    with (
        patch(f"{_MOD}.DovBoreholeClient.find_by_name", new=AsyncMock(return_value=_row())),
        patch(f"{_MOD}.DovBoreholeClient.fetch_rows_processed", new=download),
    ):
        result = await use_case.execute_by_name(_NAME, app_project_id=uuid4())

    assert result.found is True
    assert result.borehole_id == existing
    assert result.already_in_project is True
    download.assert_not_awaited()
    use_case._repo.save.assert_not_awaited()  # type: ignore[attr-defined]
    use_case._session.commit.assert_not_called()  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_a_concurrent_insert_of_the_same_borehole_returns_that_borehole(
    use_case: ImportBoreholeDov,
) -> None:
    """Two previews race: both saw no row, the other one committed first, so
    this one's flush hits ``uq_borehole_app_project_source_test``. The write is
    rolled back and the borehole the other request stored is returned."""
    from sqlalchemy.exc import IntegrityError

    winner = uuid4()
    use_case._repo.find_existing_test_ids = AsyncMock(  # type: ignore[method-assign]
        side_effect=[{}, {}, {_NAME: winner}]
    )
    use_case._session.rollback = AsyncMock()  # type: ignore[attr-defined]
    clash = IntegrityError("INSERT", {}, Exception("uq_borehole_app_project_source_test"))
    with (
        patch(f"{_MOD}.DovBoreholeClient.find_by_name", new=AsyncMock(return_value=_row())),
        patch(
            f"{_MOD}.DovBoreholeClient.fetch_rows_processed",
            new=AsyncMock(return_value=[(_row(), _parsed())]),
        ),
        patch(f"{_MOD}.ImportInterpretationsDov.execute", new=AsyncMock(side_effect=clash)),
    ):
        result = await use_case.execute_by_name(_NAME, app_project_id=uuid4())

    use_case._session.rollback.assert_awaited_once()  # type: ignore[attr-defined]
    assert result.found is True
    assert result.borehole_id == winner
    assert result.already_in_project is True


@pytest.mark.asyncio
async def test_a_conflict_that_is_not_the_same_borehole_is_raised(
    use_case: ImportBoreholeDov,
) -> None:
    """The clash is rolled back, but when no such borehole is there afterwards
    the error is not hidden: the caller sees the IntegrityError."""
    from sqlalchemy.exc import IntegrityError

    use_case._repo.find_existing_test_ids = AsyncMock(return_value={})  # type: ignore[method-assign]
    use_case._session.rollback = AsyncMock()  # type: ignore[attr-defined]
    clash = IntegrityError("INSERT", {}, Exception("some_other_constraint"))
    with (
        patch(f"{_MOD}.DovBoreholeClient.find_by_name", new=AsyncMock(return_value=_row())),
        patch(
            f"{_MOD}.DovBoreholeClient.fetch_rows_processed",
            new=AsyncMock(return_value=[(_row(), _parsed())]),
        ),
        patch(f"{_MOD}.ImportInterpretationsDov.execute", new=AsyncMock(side_effect=clash)),
        pytest.raises(IntegrityError),
    ):
        await use_case.execute_by_name(_NAME, app_project_id=uuid4())
    use_case._session.rollback.assert_awaited_once()  # type: ignore[attr-defined]
