"""Route-handler unit tests for ``POST /projects/{id}/restore`` error branches.

Debt #116 audit item C12: the restore route has three error branches —
bundle ``version not in SUPPORTED_BUNDLE_VERSIONS`` → 400,
``BundleIntegrityError`` → 422, and ``ValueError / KeyError / TypeError``
from the restore → 400 — covered only end-to-end by the Playwright
``flow_bundle_roundtrip``, never at the route-handler level.

These tests drive the handler through a mounted FastAPI app with the
dependency-injected session mocked and ``restore_project_bundle`` patched,
so no DB or network I/O is required (matches the unit-test contract).
Every branch is reachable at unit level: the ``format_version`` guard runs
before any DB work, and the integrity / bad-shape branches are triggered by
making the patched ``restore_project_bundle`` raise.

These are characterisation GUARDS, not red-first pins — the branches already
exist in the shipped handler; the tests lock the exact status + detail shape
each one produces so a future refactor cannot silently change them.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from groundmodel.api.routers import project as project_module
from groundmodel.infrastructure.db.repositories.project_bundle import BundleIntegrityError
from groundmodel.infrastructure.db.session import get_session

PROJECT_ID = uuid4()


def _build_app(mock_session: AsyncMock) -> FastAPI:
    """Mount the project router with ``get_session`` overridden to a mock.

    The router already carries its ``/projects`` prefix, so the mounted shape
    matches ``main.py``.
    """
    app = FastAPI()
    app.include_router(project_module.router)
    app.dependency_overrides[get_session] = lambda: mock_session
    return app


def _minimal_bundle(format_version: int) -> dict[str, object]:
    """Smallest body that passes ``ProjectBundleRequest`` validation.

    ``project`` is the only required non-defaulted field besides
    ``format_version``; every child collection defaults to an empty list.
    """
    return {"format_version": format_version, "project": {}}


# ---------------------------------------------------------------------------
# C12-a — unsupported format_version → 400 (before any DB work)
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _no_partition_locks():
    """Neutralise the BP-5 up-front lock pass — these tests mock the session.

    ``restore_project`` now takes every body-partition lock of the project
    before its first write (``lock_project_body_partitions``, an advisory-lock
    SELECT per model). With an ``AsyncMock`` session that pass has nothing to
    query; it is not what these branch guards exercise, so it is patched to a
    no-op here.
    """
    with patch.object(
        project_module, "lock_project_body_partitions", new=AsyncMock(return_value=[])
    ):
        yield


@pytest.mark.asyncio
async def test_unsupported_format_version_returns_400() -> None:
    """Bundle ``version not in SUPPORTED_BUNDLE_VERSIONS`` → 400.

    format_version=2 passes the Pydantic ``ge=1`` constraint but is not in
    the supported set {3, 4}; the handler rejects it with the documented
    "not supported / re-save from a current build" message before ever
    calling ``restore_project_bundle``.
    """
    mock_session = AsyncMock()
    app = _build_app(mock_session)

    # Patch the restore so a leak past the guard would be visible (it must
    # NOT be awaited on the version-reject path).
    with patch.object(project_module, "restore_project_bundle", new=AsyncMock()) as mock_restore:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post(
                f"/projects/{PROJECT_ID}/restore",
                json=_minimal_bundle(format_version=2),
            )

    assert resp.status_code == 400, resp.text
    detail = resp.json()["detail"]
    assert "not supported" in detail
    # The rejected version and the accepted set are both named in the message.
    assert "format_version=2" in detail
    mock_restore.assert_not_awaited()


# ---------------------------------------------------------------------------
# C12-b — BundleIntegrityError from the restore → 422
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bundle_integrity_error_returns_422() -> None:
    """``BundleIntegrityError`` from the restore → 422 carrying the error text.

    The bundle parsed cleanly but is self-inconsistent (e.g. contacts /
    layers reference formations not in the bundle); the replace-restore guard
    refuses to wipe the DB in this state, so the actionable message reaches
    the caller as a 422 rather than a 500 or a silent wipe.
    """
    mock_session = AsyncMock()
    app = _build_app(mock_session)

    message = "layer 7 references formation not in bundle"
    with patch.object(
        project_module,
        "restore_project_bundle",
        new=AsyncMock(side_effect=BundleIntegrityError(message)),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post(
                f"/projects/{PROJECT_ID}/restore",
                json=_minimal_bundle(format_version=4),
            )

    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"] == message


# ---------------------------------------------------------------------------
# C12-c — ValueError / KeyError / TypeError from the restore → 400
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("exc", "text"),
    [
        (ValueError("bad numeric field"), "bad numeric field"),
        (KeyError("missing_key"), "'missing_key'"),
        (TypeError("expected dict, got list"), "expected dict, got list"),
    ],
)
@pytest.mark.asyncio
async def test_invalid_bundle_shape_returns_400(exc: Exception, text: str) -> None:
    """``ValueError`` / ``KeyError`` / ``TypeError`` from the restore → 400.

    Bad bundle shape is surfaced as a 400 ("Invalid bundle payload: ...")
    instead of being allowed to bubble up as an unhandled 500. Each of the
    three exception types the handler names is exercised in turn.
    """
    mock_session = AsyncMock()
    app = _build_app(mock_session)

    with patch.object(
        project_module,
        "restore_project_bundle",
        new=AsyncMock(side_effect=exc),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post(
                f"/projects/{PROJECT_ID}/restore",
                json=_minimal_bundle(format_version=4),
            )

    assert resp.status_code == 400, resp.text
    detail = resp.json()["detail"]
    assert detail.startswith("Invalid bundle payload:")
    # The original exception's text rides along so the failure is diagnosable.
    assert text in detail


# ---------------------------------------------------------------------------
# Control — the ``BundleIntegrityError``-is-a-ValueError ordering holds.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_integrity_error_wins_over_the_valueerror_branch() -> None:
    """A ``BundleIntegrityError`` (a ValueError subclass) is answered 422, not 400.

    ``BundleIntegrityError`` subclasses ``ValueError``; the handler lists its
    ``except`` for it FIRST, so the 422 branch must win over the generic
    ValueError→400 branch. This control guards that ordering against a
    reorder that would silently downgrade a 422 to a 400.
    """
    mock_session = AsyncMock()
    app = _build_app(mock_session)

    # Sanity: the subclass relationship the ordering depends on.
    assert issubclass(BundleIntegrityError, ValueError)

    with patch.object(
        project_module,
        "restore_project_bundle",
        new=AsyncMock(side_effect=BundleIntegrityError("inconsistent")),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post(
                f"/projects/{PROJECT_ID}/restore",
                json=_minimal_bundle(format_version=4),
            )

    assert resp.status_code == 422, resp.text
