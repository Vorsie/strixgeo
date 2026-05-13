"""Regression test for the GEF upload byte cap (debt #39).

The handler now stream-copies into a tempfile with a running byte
counter and raises 413 when the upload exceeds the cap. Tests below
exercise both paths via ``TestClient``.

Unit-tier — TestClient runs ASGI in-process so the 413 path returns
before any DB or parser code executes. The under-cap path will hit
the parser and likely 400 (the body isn't valid GEF) but anything
non-413 satisfies the "middleware let it through" assertion.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from groundmodel.api.main import app
from groundmodel.api.routers.cpt import _MAX_GEF_UPLOAD_BYTES


@pytest.fixture(scope="module")
def client() -> TestClient:
    """Loopback base_url so TrustedHostMiddleware accepts the Host."""
    return TestClient(app, base_url="http://127.0.0.1")


def test_gef_upload_413_when_payload_exceeds_cap(client: TestClient) -> None:
    """An upload larger than the cap returns 413 from the handler.

    The body-size middleware (256 MiB) would also reject anything
    above ITS cap, but the handler cap is tighter (200 MiB for
    GEF specifically). Test sends slightly above the handler cap.
    """
    oversized = b"#GEF " + b"x" * (_MAX_GEF_UPLOAD_BYTES + 1)
    response = client.post(
        "/cpt/import",
        files={"file": ("oversized.gef", oversized, "text/plain")},
        data={"project_id": "00000000-0000-0000-0000-000000000000"},
    )
    assert response.status_code == 413
    assert "cap" in response.text.lower() or "too large" in response.text.lower()


def test_gef_upload_under_cap_passes_handler_gate(client: TestClient) -> None:
    """A 1 KB body sails through the size check, then hits parser.

    The handler will 400/422 because the body isn't valid GEF, but
    NOT 413 — that's what the test pins.
    """
    response = client.post(
        "/cpt/import",
        files={"file": ("tiny.gef", b"#GEF not really valid", "text/plain")},
        data={"project_id": "00000000-0000-0000-0000-000000000000"},
    )
    assert response.status_code != 413
