"""Owner 2026-10-04 (option a): the sample slide-in lists each raw test with its date.

``GET /lab-series?project_id=&borehole_id=`` carries the lab's test start date
on every summary row (``test_start_date``, ISO date, null when the file had
none) so the sample panel can list "kind, file name, date, stages" without a
per-test request. Additive: an older client ignores the field. The repository
is replaced by a fake, so TestClient runs without a database.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from groundmodel.api.main import app
from groundmodel.infrastructure.db.session import get_session

_PROJECT = "00000000-0000-0000-0000-000000000001"
_BOREHOLE = "00000000-0000-0000-0000-0000000000b1"
_REPO = "groundmodel.api.routers.lab_series.LabSeriesRepository"


@pytest.fixture
def client() -> Iterator[TestClient]:
    """Loopback client with the session dependency replaced by a fake."""

    async def _fake_session() -> AsyncIterator[MagicMock]:
        yield MagicMock()

    app.dependency_overrides[get_session] = _fake_session
    try:
        yield TestClient(app, base_url="http://127.0.0.1", raise_server_exceptions=False)
    finally:
        app.dependency_overrides.pop(get_session, None)


def _row(start: date | None) -> tuple[SimpleNamespace, SimpleNamespace]:
    """One (test, sample) pair as the repository answers it."""
    test = SimpleNamespace(
        id=UUID("00000000-0000-0000-0000-0000000000aa"),
        kind="oedometer",
        test_type_token=None,
        lab_sample_number="20/0568",
        source_file_name="oed.txt",
        n_specimens=1,
        specimens=[SimpleNamespace(stages=[1, 2], n_points=10)],
        import_issues=[],
        test_start_date=start,
    )
    sample = SimpleNamespace(
        id=UUID("00000000-0000-0000-0000-0000000000c1"),
        depth_top_m=1.0,
        depth_base_m=1.5,
        sample_number="S2",
    )
    return test, sample


@pytest.mark.parametrize(("start", "expected"), [(date(2020, 3, 9), "2020-03-09"), (None, None)])
def test_each_summary_row_carries_the_test_start_date(
    client: TestClient, start: date | None, expected: str | None
) -> None:
    """The row says when the lab started the test; no date in the file → null."""
    repo = MagicMock()
    repo.list_summaries_for_borehole = AsyncMock(return_value=[_row(start)])
    with patch(_REPO, return_value=repo):
        response = client.get(
            "/lab-series", params={"project_id": _PROJECT, "borehole_id": _BOREHOLE}
        )
    assert response.status_code == 200, response.text
    assert response.json()[0]["test_start_date"] == expected
