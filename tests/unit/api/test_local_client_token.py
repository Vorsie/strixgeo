"""Rules for the per-launch token that guards ``Origin: null`` requests.

``"null"`` has to stay in the CORS allowlist — the packaged renderer runs
from ``file://`` and that is the origin fetch reports for it.  But
``Origin: null`` is not exclusive to the app: a sandboxed iframe
(``<iframe sandbox="allow-scripts" srcdoc=...>``), a ``data:`` document and a
redirect-laundered request all send it too.  With the API unauthenticated,
any web page the engineer happens to have open could read
``GET /projects/{id}/bundle`` — the complete site investigation — or issue
``DELETE /geology/models/{id}``.

The fix is to stop treating the origin as identity: the Electron main process
mints a random token per launch, hands it to its uvicorn child through the
environment, and injects it as a request header on the renderer's calls.  A
hostile page cannot read that token, so the ``"null"`` allowance becomes
harmless.

Enforcement is deliberately conditional on the token being configured, so a
dev / integration / e2e backend started by hand behaves exactly as before.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from groundmodel.api.local_client_token_constants import (
    LOCAL_CLIENT_TOKEN_ENV_VAR,
    LOCAL_CLIENT_TOKEN_HEADER,
)
from groundmodel.api.main import app

_TOKEN = "test-launch-token-9f3a"


@pytest.fixture(scope="module")
def client() -> TestClient:
    """One TestClient for the module.

    ``base_url`` is pinned to ``http://127.0.0.1`` so TrustedHostMiddleware
    (which rejects TestClient's default ``Host: testserver``) lets the
    requests through to the layer under test.
    """
    return TestClient(app, base_url="http://127.0.0.1")


@pytest.fixture
def launched_by_the_app(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """A backend started by the Electron main process — token configured."""
    monkeypatch.setenv(LOCAL_CLIENT_TOKEN_ENV_VAR, _TOKEN)
    yield


@pytest.fixture
def started_by_hand(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """A backend started outside the app (dev shell, e2e harness, scripts)."""
    monkeypatch.delenv(LOCAL_CLIENT_TOKEN_ENV_VAR, raising=False)
    yield


def test_null_origin_without_the_token_is_refused(
    client: TestClient, launched_by_the_app: None
) -> None:
    """A page that merely claims to be the app reads nothing."""
    response = client.get("/openapi.json", headers={"Origin": "null"})
    assert response.status_code == 403


def test_null_origin_with_the_token_is_served(
    client: TestClient, launched_by_the_app: None
) -> None:
    """The real renderer carries the token main minted for this launch."""
    response = client.get(
        "/openapi.json",
        headers={"Origin": "null", LOCAL_CLIENT_TOKEN_HEADER: _TOKEN},
    )
    assert response.status_code == 200


def test_null_origin_with_a_wrong_token_is_refused(
    client: TestClient, launched_by_the_app: None
) -> None:
    """Guessing does not work, and neither does a token from a previous launch."""
    response = client.get(
        "/openapi.json",
        headers={"Origin": "null", LOCAL_CLIENT_TOKEN_HEADER: "some-other-token"},
    )
    assert response.status_code == 403


def test_a_destructive_route_is_refused_too(client: TestClient, launched_by_the_app: None) -> None:
    """The guard covers writes, not just reads — DELETE was the worst case."""
    response = client.delete(
        "/geology/models/00000000-0000-0000-0000-000000000000",
        headers={"Origin": "null"},
    )
    assert response.status_code == 403


def test_the_dev_renderer_origin_with_the_token_is_served(
    client: TestClient, launched_by_the_app: None
) -> None:
    """``npm run dev`` serves the renderer over http://localhost:<port>.

    In dev the Electron main process still spawns the uvicorn child with the
    launch token and still injects the header on every renderer request (only
    ``ENVIRONMENT=production`` is packaged-gated — see
    ``desktop/src/main/index.ts``), so the dev renderer carries the token and
    is served.
    """
    response = client.get(
        "/openapi.json",
        headers={"Origin": "http://localhost:5173", LOCAL_CLIENT_TOKEN_HEADER: _TOKEN},
    )
    assert response.status_code == 200


def test_a_localhost_origin_without_the_token_is_refused(
    client: TestClient, launched_by_the_app: None
) -> None:
    """Every present Origin must prove the token — a bare localhost is not exempt.

    The old rule trusted any localhost origin unconditionally, which let a page
    served from another localhost port (a second dev server, a malicious local
    app) reach the API without the token. The token is the identity signal now,
    not the origin.
    """
    response = client.get("/openapi.json", headers={"Origin": "http://localhost:5173"})
    assert response.status_code == 403


def test_a_remote_origin_without_the_token_is_refused(
    client: TestClient, launched_by_the_app: None
) -> None:
    """A page on the wider web sends its own Origin; without the token it reads nothing."""
    response = client.get("/openapi.json", headers={"Origin": "https://evil.example"})
    assert response.status_code == 403


def test_a_remote_origin_multipart_import_is_refused_and_writes_nothing(
    client: TestClient, launched_by_the_app: None
) -> None:
    """The CSRF this guard closes: a remote page's plain multipart form.

    A ``<form enctype="multipart/form-data">`` POST to ``/cpt/import`` from a
    page on the web carries that page's Origin and no launch token. The token
    middleware must refuse it with 403 BEFORE the import route runs, so nothing
    is parsed and nothing is written.
    """
    response = client.post(
        "/cpt/import",
        files={"file": ("evil.gef", b"#GEFID= 1,1,0\n#EOH=\n")},
        headers={"Origin": "https://evil.example"},
    )
    assert response.status_code == 403


def test_a_request_without_an_origin_is_untouched(
    client: TestClient, launched_by_the_app: None
) -> None:
    """curl, the integration suite and main's own readiness probe send none.

    Browsers always attach an Origin to the fetch/XHR calls that can read a
    response cross-origin, so the browser-borne attack this guards against
    cannot arrive without one.
    """
    response = client.get("/openapi.json")
    assert response.status_code == 200


def test_the_cors_preflight_still_passes_without_the_token(
    client: TestClient, launched_by_the_app: None
) -> None:
    """A blocked preflight would stop the real request from ever being sent."""
    response = client.options(
        "/openapi.json",
        headers={
            "Origin": "null",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "null"


def test_a_hand_started_backend_keeps_serving_null_origin(
    client: TestClient, started_by_hand: None
) -> None:
    """No token configured — dev, the e2e harness and scripts are unaffected."""
    response = client.get("/openapi.json", headers={"Origin": "null"})
    assert response.status_code == 200
