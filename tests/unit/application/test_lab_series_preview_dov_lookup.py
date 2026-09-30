"""The lab import preview fetches a missing borehole from DOV (owner 2026-09-30).

"I need to manually import the boreholes? Can't we just auto load from DOV when
trying to load a lab tests and throw exception if it can't be found?" So when
the preview finds NO project borehole whose name ends with ``<job>-<borehole>``,
it asks DOV for that borehole and imports it into the project, then proposes
it ("Fetched GEO-25/022-B17 from DOV"). When DOV has no such borehole, or DOV
cannot be reached, the preview says so, names the borehole, proposes nothing,
and never answers a 500. The DOV side is a fake; the repository is a fake.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import httpx
import pytest

from groundmodel.application.import_borehole_dov_by_name_result import (
    ImportBoreholeDovByNameResult,
)
from groundmodel.application.import_lab_series_file import ImportLabSeriesFile

_LAB = Path(__file__).resolve().parents[2] / "fixtures" / "lab"
_TX = _LAB / "triaxial" / "tx_cd.txt"  # job GEO-25/022, borehole B17
_NEW_MODULE = _LAB / "oedometer_new" / "uit_nieuwemodule.csv"  # names no borehole
_PROJECT = uuid4()


def _use_case(
    boreholes: list[tuple[str, str]], fetcher: AsyncMock
) -> tuple[ImportLabSeriesFile, MagicMock]:
    """The use case over a fake repository; ``fetcher`` stands in for DOV."""
    uc = ImportLabSeriesFile(MagicMock(), dov_borehole_fetcher=fetcher)
    repo = MagicMock()
    state = {"boreholes": list(boreholes)}
    repo.list_borehole_names = AsyncMock(side_effect=lambda _p: list(state["boreholes"]))
    repo.get_borehole = AsyncMock(return_value=object())
    repo.list_samples = AsyncMock(return_value=[])
    repo.find_by_identity = AsyncMock(return_value=None)
    uc._repo = repo  # type: ignore[assignment]
    return uc, repo


def _fetched(borehole_id: UUID) -> AsyncMock:
    """A DOV fake that finds and imports the borehole."""
    return AsyncMock(
        return_value=ImportBoreholeDovByNameResult(
            found=True, dov_name="GEO-25/022-B17", borehole_id=borehole_id
        )
    )


@pytest.mark.asyncio
async def test_no_project_borehole_fetches_it_from_dov_and_proposes_it() -> None:
    """No match → DOV is asked for GEO-25/022-B17, imports it, the preview proposes it."""
    new_id = uuid4()
    fetcher = _fetched(new_id)
    uc, _ = _use_case([], fetcher)
    preview = await uc.preview(_TX, _PROJECT)
    fetcher.assert_awaited_once_with("GEO-25/022-B17", _PROJECT)
    assert preview.dov_lookup == {
        "status": "fetched",
        "borehole_name": "GEO-25/022-B17",
        "borehole_id": str(new_id),
    }
    assert preview.proposed_borehole_id == str(new_id)
    assert preview.borehole_match == "unique"
    assert preview.borehole_candidates == [{"id": str(new_id), "name": "GEO-25/022-B17"}]


@pytest.mark.asyncio
async def test_dov_without_the_borehole_names_it_and_proposes_nothing() -> None:
    """Not on DOV (the GEO-25/022 boreholes are not published yet) → a clear refusal."""
    fetcher = AsyncMock(
        return_value=ImportBoreholeDovByNameResult(found=False, dov_name="GEO-25/022-B17")
    )
    uc, _ = _use_case([], fetcher)
    preview = await uc.preview(_TX, _PROJECT)
    assert preview.dov_lookup == {
        "status": "not_found",
        "borehole_name": "GEO-25/022-B17",
        "borehole_id": None,
    }
    assert preview.proposed_borehole_id is None
    assert preview.borehole_match == "none"


@pytest.mark.parametrize(
    "error",
    [
        httpx.ConnectTimeout("timed out"),
        httpx.ConnectError("no network"),
        TimeoutError(),
    ],
)
@pytest.mark.asyncio
async def test_dov_not_reachable_is_said_as_such_never_a_500(error: Exception) -> None:
    """Timeout / no network → status ``unreachable``, the preview still answers."""
    uc, _ = _use_case([], AsyncMock(side_effect=error))
    preview = await uc.preview(_TX, _PROJECT)
    assert preview.dov_lookup is not None
    assert preview.dov_lookup["status"] == "unreachable"
    assert preview.dov_lookup["borehole_name"] == "GEO-25/022-B17"
    assert preview.proposed_borehole_id is None


@pytest.mark.asyncio
async def test_dov_answering_an_error_status_is_unreachable_too() -> None:
    """A DOV 503 is DOV not reachable for the user, not a server error of ours."""
    request = httpx.Request("GET", "https://www.dov.vlaanderen.be/geoserver/wfs")
    error = httpx.HTTPStatusError(
        "503", request=request, response=httpx.Response(503, request=request)
    )
    uc, _ = _use_case([], AsyncMock(side_effect=error))
    preview = await uc.preview(_TX, _PROJECT)
    assert preview.dov_lookup is not None and preview.dov_lookup["status"] == "unreachable"


@pytest.mark.asyncio
async def test_a_project_borehole_that_matches_means_dov_is_not_asked() -> None:
    """The name-ends-with match wins; DOV stays untouched."""
    fetcher = AsyncMock()
    bh = str(uuid4())
    uc, _ = _use_case([(bh, "1445-GEO-25/022-B17")], fetcher)
    preview = await uc.preview(_TX, _PROJECT)
    fetcher.assert_not_awaited()
    assert preview.dov_lookup is None
    assert preview.proposed_borehole_id == bh


@pytest.mark.asyncio
async def test_a_borehole_the_user_picked_means_dov_is_not_asked() -> None:
    """The user chose a borehole in the picker: no lookup."""
    fetcher = AsyncMock()
    uc, _ = _use_case([], fetcher)
    picked = uuid4()
    preview = await uc.preview(_TX, _PROJECT, borehole_id=picked)
    fetcher.assert_not_awaited()
    assert preview.proposed_borehole_id == str(picked)


@pytest.mark.asyncio
async def test_an_export_that_names_no_borehole_does_not_ask_dov() -> None:
    """The newer oedometer module names no borehole: nothing to look up, the user picks."""
    fetcher = AsyncMock()
    uc, _ = _use_case([], fetcher)
    preview = await uc.preview(_NEW_MODULE, _PROJECT)
    fetcher.assert_not_awaited()
    assert preview.dov_lookup is None
