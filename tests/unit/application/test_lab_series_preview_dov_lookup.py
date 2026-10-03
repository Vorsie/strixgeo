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
    boreholes: list[tuple[str, ...]], fetcher: AsyncMock
) -> tuple[ImportLabSeriesFile, MagicMock]:
    """The use case over a fake repository; ``fetcher`` stands in for DOV.

    ``boreholes`` holds ``(id, name)`` or ``(id, name, test_id)``.
    """
    uc = ImportLabSeriesFile(MagicMock(), dov_borehole_fetcher=fetcher)
    repo = MagicMock()
    names = [(b[0], b[1]) for b in boreholes]
    test_ids = [(b[0], b[2] if len(b) > 2 else b[1]) for b in boreholes]
    repo.list_borehole_names = AsyncMock(return_value=names)
    repo.list_borehole_test_ids = AsyncMock(return_value=test_ids)
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


# --- Owner dogfeed 2026-10-03: 200568B7-LstSMControleListing.txt answered 500 ---

_OEDO_B7A = _LAB / "oedometer" / "200568B7-LstSMControleListing.txt"  # GEO-19/122, B7A


@pytest.mark.asyncio
async def test_the_project_borehole_1411_geo_19_122_b7a_is_proposed_without_asking_dov() -> None:
    """The listing names job GEO-19/122 + borehole B7A; the project holds DOV's
    ``1411-GEO-19/122-B7A`` → that borehole is proposed and DOV is not asked."""
    fetcher = AsyncMock()
    b7a = str(uuid4())
    uc, _ = _use_case(
        [(str(uuid4()), "1411-GEO-19/122-B7B"), (b7a, "1411-GEO-19/122-B7A")], fetcher
    )
    preview = await uc.preview(_OEDO_B7A, _PROJECT)
    fetcher.assert_not_awaited()
    assert preview.borehole_match == "unique"
    assert preview.proposed_borehole_id == b7a
    assert preview.borehole_candidates == [{"id": b7a, "name": "1411-GEO-19/122-B7A"}]


@pytest.mark.asyncio
async def test_a_renamed_dov_borehole_still_matches_on_its_dov_test_id() -> None:
    """The user renamed the borehole; DOV's ``test_id`` still ends with the
    lab's ``<job>-<borehole>`` → it is the match, DOV is not asked."""
    fetcher = AsyncMock()
    b7a = str(uuid4())
    uc, _ = _use_case([(b7a, "B7A (renamed)", "1411-GEO-19/122-B7A")], fetcher)
    preview = await uc.preview(_OEDO_B7A, _PROJECT)
    fetcher.assert_not_awaited()
    assert preview.proposed_borehole_id == b7a


@pytest.mark.asyncio
async def test_dov_answering_the_borehole_is_already_in_the_project_proposes_it_unfetched() -> None:
    """A second preview raced the first one's DOV fetch: the by-name import
    finds the row already there → the preview proposes it like a local match,
    and does not say "fetched from DOV"."""
    existing = uuid4()
    fetcher = AsyncMock(
        return_value=ImportBoreholeDovByNameResult(
            found=True,
            dov_name="1411-GEO-19/122-B7A",
            borehole_id=existing,
            already_in_project=True,
        )
    )
    uc, _ = _use_case([], fetcher)
    preview = await uc.preview(_OEDO_B7A, _PROJECT)
    assert preview.dov_lookup is None
    assert preview.borehole_match == "unique"
    assert preview.proposed_borehole_id == str(existing)
    assert preview.borehole_candidates == [{"id": str(existing), "name": "1411-GEO-19/122-B7A"}]


@pytest.mark.asyncio
async def test_a_borehole_write_conflict_during_the_dov_fetch_is_a_named_conflict() -> None:
    """Any unique-key clash while the DOV borehole is written is refused by
    name (the router answers 409 ``lab_borehole_conflict``), never a 500."""
    from sqlalchemy.exc import IntegrityError

    from groundmodel.shared.exceptions import LabBoreholeConflictError

    clash = IntegrityError("INSERT", {}, Exception("uq_borehole_app_project_source_test"))
    uc, _ = _use_case([], AsyncMock(side_effect=clash))
    uc._session.rollback = AsyncMock()  # type: ignore[attr-defined]
    with pytest.raises(LabBoreholeConflictError) as info:
        await uc.preview(_OEDO_B7A, _PROJECT)
    assert info.value.borehole_name == "GEO-19/122-B7A"
    assert "GEO-19/122-B7A" in str(info.value)
    uc._session.rollback.assert_awaited_once()  # type: ignore[attr-defined]
