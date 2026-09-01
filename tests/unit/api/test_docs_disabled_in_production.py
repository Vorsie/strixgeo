"""Interactive API docs (/docs, /redoc) are OFF in packaged/production builds.

The desktop client polls ``/openapi.json`` to know the backend is up (see the
``waitForApi`` loop referenced from ``api/main.py``), so that endpoint MUST stay
reachable in every environment. But the interactive Swagger UI (``/docs``) and
ReDoc (``/redoc``) are unnecessary surface in a shipped installer and are
disabled whenever the backend runs outside local development.

The signal is ``settings.environment``: ``"development"`` keeps the dev
ergonomics (docs on); any other value — ``"production"`` (which the Electron
main process injects as ``ENVIRONMENT=production`` for a packaged build),
``"staging"``, a packaged coworker binary — turns the interactive docs off.

Owner exposure-cuts ruling (2026-09-01).

These run as fast unit tests: ``TestClient`` is used WITHOUT the context
manager, so the app's lifespan (and its DB probe) never fires — routing to the
docs/openapi endpoints needs no database.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from groundmodel.api.main import create_app


def _client_for(environment: str) -> TestClient:
    """Build a TestClient over an app constructed for ``environment``.

    ``base_url`` is pinned to loopback so ``TrustedHostMiddleware`` accepts the
    Host header — the same idiom as ``test_cors_security``.
    """
    return TestClient(create_app(environment=environment), base_url="http://127.0.0.1")


def test_docs_and_redoc_disabled_in_production() -> None:
    """A production build serves neither the Swagger UI nor ReDoc."""
    app = create_app(environment="production")
    assert app.docs_url is None
    assert app.redoc_url is None

    client = _client_for("production")
    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404


def test_openapi_json_still_served_in_production() -> None:
    """The client's ``waitForApi`` poll of /openapi.json must answer in production."""
    client = _client_for("production")
    assert client.get("/openapi.json").status_code == 200


def test_docs_served_in_development() -> None:
    """Local development keeps the interactive docs for convenience."""
    app = create_app(environment="development")
    assert app.docs_url == "/docs"
    assert app.redoc_url == "/redoc"

    client = _client_for("development")
    assert client.get("/docs").status_code == 200


def test_openapi_json_served_in_development() -> None:
    """/openapi.json is reachable in development too (both branches serve it)."""
    client = _client_for("development")
    assert client.get("/openapi.json").status_code == 200
