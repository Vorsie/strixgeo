"""Owner dogfeed 2026-10-03: a lab preview answered 500 on a borehole clash.

``POST /lab-series/preview`` for ``200568B7-LstSMControleListing.txt`` fetched
``GEO-19/122-B7A`` from DOV while another preview had just stored it; the
insert hit ``uq_borehole_app_project_source_test`` and the generic handler
answered "The server failed to complete this request". A borehole clash on the
preview path is a 409 with ``code = "lab_borehole_conflict"`` and a message that
names the borehole; the session is rolled back. The use case is replaced by a
fake, so TestClient runs without a database.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from groundmodel.api.main import app
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.exceptions import LabBoreholeConflictError

_PROJECT = "00000000-0000-0000-0000-000000000000"
_LISTING = (
    Path(__file__).resolve().parents[2]
    / "fixtures"
    / "lab"
    / "oedometer"
    / "200568B7-LstSMControleListing.txt"
)
_PREVIEW = "groundmodel.api.routers.lab_series.ImportLabSeriesFile.preview"


@pytest.fixture
def session() -> MagicMock:
    """A fake request session that records the rollback."""
    fake = MagicMock()
    fake.rollback = AsyncMock()
    return fake


@pytest.fixture
def client(session: MagicMock) -> Iterator[TestClient]:
    """Loopback client with the session dependency replaced by the fake."""

    async def _fake_session() -> AsyncIterator[MagicMock]:
        yield session

    app.dependency_overrides[get_session] = _fake_session
    try:
        yield TestClient(app, base_url="http://127.0.0.1", raise_server_exceptions=False)
    finally:
        app.dependency_overrides.pop(get_session, None)


def _post(client: TestClient) -> object:
    """Preview the dogfeed listing."""
    return client.post(
        "/lab-series/preview",
        files={"file": (_LISTING.name, _LISTING.read_bytes(), "text/plain")},
        data={"project_id": _PROJECT},
    )


def test_a_named_borehole_conflict_is_a_409_naming_the_borehole(
    client: TestClient, session: MagicMock
) -> None:
    """The use case names the clashing borehole → 409 ``lab_borehole_conflict``."""
    with patch(_PREVIEW, new=AsyncMock(side_effect=LabBoreholeConflictError("GEO-19/122-B7A"))):
        response = _post(client)
    assert response.status_code == 409  # type: ignore[attr-defined]
    detail = response.json()["detail"]  # type: ignore[attr-defined]
    assert detail["code"] == "lab_borehole_conflict"
    assert detail["borehole_name"] == "GEO-19/122-B7A"
    assert "GEO-19/122-B7A" in detail["message"]
    session.rollback.assert_awaited()


def test_a_raw_integrity_error_on_the_preview_path_is_a_409_not_a_500(
    client: TestClient, session: MagicMock
) -> None:
    """Any unique-key clash the use case did not name is still a clean 409."""
    clash = IntegrityError(
        "INSERT INTO borehole", {}, Exception("uq_borehole_app_project_source_test")
    )
    with patch(_PREVIEW, new=AsyncMock(side_effect=clash)):
        response = _post(client)
    assert response.status_code == 409  # type: ignore[attr-defined]
    detail = response.json()["detail"]  # type: ignore[attr-defined]
    assert detail["code"] == "lab_borehole_conflict"
    assert _LISTING.name in detail["message"]
    session.rollback.assert_awaited()
