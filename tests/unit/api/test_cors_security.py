"""Regression tests for the CORS + TrustedHost middleware pinning (debt #35).

The original ``allow_origins=["*"]`` configuration let any browser tab the
user opens while Strix runs cross-origin-fetch the API. Tests below pin the
critical invariants:

* The wildcard is gone — an arbitrary origin gets no
  ``Access-Control-Allow-Origin`` response header.
* The whitelisted dev origin (``http://localhost:<port>``) DOES get the
  CORS headers echoed back.
* The whitelisted production origin (``"null"`` — what fetch sends from a
  ``file://`` BrowserWindow) DOES too.
* TrustedHostMiddleware rejects an unknown ``Host`` header with 400 —
  closes the DNS-rebinding bypass.

These run as fast unit tests (TestClient is synchronous, no DB touched —
the lifespan probe times out cheaply when Postgres is absent).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from groundmodel.api.main import app, create_app


@pytest.fixture(scope="module")
def client() -> TestClient:
    """One TestClient for the whole module.

    ``TestClient`` runs ASGI in-process so CORS + TrustedHost middleware
    behaviour is observable through response headers / status. The
    lifespan DB probe runs once on first request and fails fast when
    Postgres isn't reachable; we don't care about its outcome here.

    ``base_url`` is pinned to ``http://127.0.0.1`` so the Host header
    matches the production allowlist — without this TestClient defaults
    to ``Host: testserver`` and TrustedHostMiddleware rejects every
    request with 400.
    """
    return TestClient(app, base_url="http://127.0.0.1")


def test_wildcard_origin_no_longer_echoed(client: TestClient) -> None:
    """An untrusted origin must NOT receive an ACAO header.

    Without this guard, ``evil.com`` open in any browser tab while Strix
    runs would be allowed to read API responses.
    """
    response = client.get(
        "/openapi.json",
        headers={"Origin": "http://evil.example.com"},
    )
    # OpenAPI itself works (200) — the CORS layer just doesn't echo the
    # origin back, which means the browser will block the response from
    # reaching JS code that issued the fetch.
    assert response.status_code == 200
    assert "access-control-allow-origin" not in {k.lower() for k in response.headers}


def test_dev_origin_localhost_5173_is_allowed(client: TestClient) -> None:
    """The electron-vite dev server origin must be allowed."""
    response = client.get(
        "/openapi.json",
        headers={"Origin": "http://localhost:5173"},
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_dev_origin_localhost_alternate_port_is_allowed(client: TestClient) -> None:
    """Vite picks a different port when 5173 is taken — regex covers any port."""
    response = client.get(
        "/openapi.json",
        headers={"Origin": "http://localhost:5174"},
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5174"


def test_prod_origin_null_is_allowed(client: TestClient) -> None:
    """Production Electron BrowserWindow ``loadFile`` reports ``Origin: null``.

    The literal string ``"null"`` is the standard CORS allowlist token
    for the file:// origin.
    """
    response = client.get(
        "/openapi.json",
        headers={"Origin": "null"},
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "null"


def test_https_origin_NOT_allowed(client: TestClient) -> None:
    """Any external https origin must be rejected.

    Catches a regression where someone broadens the regex too far (e.g.
    ``localhost.*``) or pins an external domain by mistake.
    """
    response = client.get(
        "/openapi.json",
        headers={"Origin": "https://localhost"},  # not http://
    )
    assert response.status_code == 200
    assert "access-control-allow-origin" not in {k.lower() for k in response.headers}


def test_trusted_host_rejects_unknown_host_header(client: TestClient) -> None:
    """DNS-rebinding defence: an attacker-controlled DNS name resolving to
    127.0.0.1 should be rejected even though TCP-level binding is loopback-
    only.

    TrustedHostMiddleware returns 400 + "Invalid host header" when the
    Host header isn't in the allowlist.
    """
    response = client.get(
        "/openapi.json",
        headers={"Host": "rebind.attacker.example"},
    )
    assert response.status_code == 400


def test_trusted_host_accepts_loopback_names(client: TestClient) -> None:
    """The two documented loopback names stay accepted."""
    for host in ("127.0.0.1", "localhost"):
        response = client.get("/openapi.json", headers={"Host": host})
        assert response.status_code == 200, f"Host={host!r} should be accepted"


@pytest.fixture(scope="module")
def production_client() -> TestClient:
    """A TestClient over an app built with ``environment='production'``.

    A packaged build runs the backend with ``ENVIRONMENT=production``; the
    localhost CORS allowance is a development-only ergonomic (the Vite dev
    server), so it must be GONE in production. No launch token is configured
    here, so the token middleware stays disabled and the CORS layer is what we
    observe.
    """
    return TestClient(create_app("production"), base_url="http://127.0.0.1")


def test_localhost_origin_is_not_allowed_in_production(production_client: TestClient) -> None:
    """The dev-server origin must NOT receive an ACAO header in a packaged build.

    The dev renderer only exists in development; in production the sole browser
    origin is the packaged renderer's ``null``. A packaged build that still
    echoed ``http://localhost:<port>`` would let a local web server read the
    loopback API.
    """
    response = production_client.get(
        "/openapi.json",
        headers={"Origin": "http://localhost:5173"},
    )
    assert response.status_code == 200
    assert "access-control-allow-origin" not in {k.lower() for k in response.headers}


def test_null_origin_still_allowed_in_production(production_client: TestClient) -> None:
    """The packaged renderer (``file://`` → Origin: null) must still be served.

    ``null`` stays in the allowlist in every environment — it is the packaged
    renderer's own origin; the launch token is what makes that allowance safe.
    """
    response = production_client.get(
        "/openapi.json",
        headers={"Origin": "null"},
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "null"
