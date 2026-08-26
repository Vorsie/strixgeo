"""The D-Series export endpoints refuse a malformed request before touching the DB.

Two contract rules live here, both checkable offline:

* the drawn partition is REQUIRED. These exports carry closed geometry,
  and the fill is the renderer's — defaulting it would mean shipping a
  backend-derived approximation that disagrees with the section on
  screen, which is worse than refusing;
* the D-Sheet sample fraction is bounded to the section. A position off
  the end of the line samples nothing real, and the bound belongs at the
  boundary so the message names the parameter.

Unit-tier: FastAPI validates the body and the query before the handler
runs, so no session is opened and the whole path is offline.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from groundmodel.api.main import app
from groundmodel.api.schemas.project.section_geometry_export_request import (
    SectionGeometryExportRequest,
)

_PROJECT_ID = "11111111-1111-1111-1111-111111111111"
_SECTION_ID = "22222222-2222-2222-2222-222222222222"
_MODEL_ID = "99999999-9999-9999-9999-999999999999"

_PARTITION = {
    "start_x": 0.0,
    "start_y": 0.0,
    "end_x": 100.0,
    "end_y": 0.0,
    "columns": [
        {"investigation_id": "c0", "along_m": 10.0, "world_x": 10.0, "world_y": 0.0},
        {"investigation_id": "c1", "along_m": 90.0, "world_x": 90.0, "world_y": 0.0},
    ],
    "regions": [
        {
            "formation_id": "33333333-3333-3333-3333-333333333333",
            "body_id": None,
            "polygon": [[0.0, 5.0], [1.0, 5.0], [1.0, 0.0], [0.0, 0.0]],
            "gap_index": 0,
        }
    ],
}


@pytest.fixture(scope="module")
def client() -> TestClient:
    """Loopback base_url so TrustedHostMiddleware accepts the Host."""
    return TestClient(app, base_url="http://127.0.0.1")


@pytest.mark.parametrize("target", ["dstability", "dsheetpiling"])
def test_sge1_the_drawn_partition_is_required(client: TestClient, target: str) -> None:
    """No fill, no export — never a backend-derived stand-in."""
    response = client.post(
        f"/projects/{_PROJECT_ID}/sections/{_SECTION_ID}/export/{target}",
        params={"model_id": _MODEL_ID},
        json={},
    )

    assert response.status_code == 422, response.text
    assert "partition" in response.text


def test_sge2_a_sample_fraction_off_the_section_is_refused(client: TestClient) -> None:
    """1.4 is past the section's end endpoint; the bound names the parameter."""
    response = client.post(
        f"/projects/{_PROJECT_ID}/sections/{_SECTION_ID}/export/dsheetpiling",
        params={"model_id": _MODEL_ID, "fraction": 1.4},
        json={"partition": _PARTITION},
    )

    assert response.status_code == 422, response.text
    assert "fraction" in response.text


def test_sge3_the_request_schema_round_trips_to_the_domain_value_object() -> None:
    """The API layer hands the use case value objects, never Pydantic models."""
    request = SectionGeometryExportRequest.model_validate({"partition": _PARTITION})
    partition = request.partition.to_domain()

    assert tuple(column.along_m for column in partition.columns) == (10.0, 90.0)
    assert partition.regions[0].gap_index == 0
    assert partition.regions[0].polygon[0] == (0.0, 5.0)
