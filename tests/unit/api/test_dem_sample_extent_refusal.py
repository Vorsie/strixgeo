"""``GET /dem/sample`` answers 422 (not 502) for an extent that cannot exist.

The dogfeed 2026-08-02 flood came through this endpoint's provider stack: a
section whose endpoints were (0,0)→(1000,0) in EPSG:31370 — coordinates that
are not Belgian Lambert 72 at all — produced an endless run of 404ing WCS
requests that the client could only read as "the DEM service is down".

The rule: an impossible extent is the caller's bug, answered locally, with the
numbers in the message — and without touching the network.

Unit-tier: ``/dem/sample`` takes no DB session, and the refusal happens before
any HTTP client work, so ``TestClient`` runs the whole path offline.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from groundmodel.api.main import app


@pytest.fixture(scope="module")
def client() -> TestClient:
    """Loopback base_url so TrustedHostMiddleware accepts the Host."""
    return TestClient(app, base_url="http://127.0.0.1")


def test_origin_anchored_section_line_is_refused_with_the_extent_named(
    client: TestClient,
) -> None:
    """(0,0)→(1000,0) in Lambert 72 → 422 quoting the extent and the CRS domain."""
    response = client.get(
        "/dem/sample",
        params={
            "start_x": 0.0,
            "start_y": 0.0,
            "end_x": 1000.0,
            "end_y": 0.0,
            "epsg": 31370,
            "n_samples": 200,
        },
    )

    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    # The numbers have to be IN the message — that is what makes the next
    # occurrence diagnosable from one line.
    assert "1002" in detail
    assert "outside" in detail.lower()


def test_a_zero_length_line_still_answers_400(client: TestClient) -> None:
    """Control: the pre-existing zero-length guard is untouched by the new refusal."""
    response = client.get(
        "/dem/sample",
        params={
            "start_x": 88_000.0,
            "start_y": 164_000.0,
            "end_x": 88_000.0,
            "end_y": 164_000.0,
            "epsg": 31370,
        },
    )

    assert response.status_code == 400
