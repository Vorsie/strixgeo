"""Owner 2026-10-04: a lab test can be deleted from the borehole's Lab tests list.

``DELETE /lab-series/{test_id}?project_id=`` removes the test (specimens,
stages, channels and lab results go with it through ON DELETE CASCADE) and
answers 204. A test that is not in the project — unknown, or on another
project's borehole — answers 404 and nothing is deleted (the project-scope
guard every by-id route carries). The repository is replaced by a fake, so
TestClient runs without a database; the real cascade is pinned in
``tests/integration/api/test_lab_series_import.py``.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from groundmodel.api.main import app
from groundmodel.infrastructure.db.session import get_session

_PROJECT = "00000000-0000-0000-0000-000000000001"
_TEST = "00000000-0000-0000-0000-0000000000aa"
_REPO = "groundmodel.api.routers.lab_series.LabSeriesRepository"


@pytest.fixture
def session() -> MagicMock:
    """A fake request session that records the commit."""
    fake = MagicMock()
    fake.commit = AsyncMock()
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


def _fake_repo(found: object) -> MagicMock:
    """A repository whose scoped lookup answers ``found``."""
    repo = MagicMock()
    repo.get_test = AsyncMock(return_value=found)
    repo.delete_test = AsyncMock()
    return repo


def test_deleting_a_lab_test_of_the_project_removes_it_and_answers_204(
    client: TestClient, session: MagicMock
) -> None:
    """The test is in the project → it is deleted, the delete is committed, 204."""
    repo = _fake_repo(MagicMock(id=_TEST))
    with patch(_REPO, return_value=repo):
        response = client.delete(f"/lab-series/{_TEST}", params={"project_id": _PROJECT})
    assert response.status_code == 204, response.text
    repo.get_test.assert_awaited()
    assert str(repo.get_test.await_args.args[1]) == _PROJECT
    repo.delete_test.assert_awaited_once()
    session.commit.assert_awaited()


def test_a_lab_test_not_in_the_project_answers_404_and_deletes_nothing(
    client: TestClient, session: MagicMock
) -> None:
    """Unknown id, or a test on another project's borehole → 404, nothing deleted."""
    repo = _fake_repo(None)
    with patch(_REPO, return_value=repo):
        response = client.delete(f"/lab-series/{_TEST}", params={"project_id": _PROJECT})
    assert response.status_code == 404, response.text
    repo.delete_test.assert_not_awaited()
    session.commit.assert_not_awaited()


def test_the_delete_needs_the_project_scope(client: TestClient) -> None:
    """No ``project_id`` → 422: the delete is never unscoped."""
    response = client.delete(f"/lab-series/{_TEST}")
    assert response.status_code == 422, response.text
