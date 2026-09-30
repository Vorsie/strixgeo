"""Owner ruling 2026-09-30: an unknown lab file format is refused, by name.

"just make a generic importer and if file format is not found throw error and
tell to contact strixgeo devteam to have the format added". The preview and the
import answer 400 with ``code = "lab_file_format_not_recognised"`` and the
message telling the user to contact the StrixGeo dev team. Unit-tier: the file
is refused by content before any database call, so TestClient runs without one.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from groundmodel.api.main import app

_PROJECT = "00000000-0000-0000-0000-000000000000"
_MESSAGE = "This file format is not recognised. Contact the StrixGeo dev team to have it added."
# A lab RESULTS table (processed output): a supported extension, an unknown content.
_UNKNOWN = b"Trap;Druk;Dhi\r\n;0;0,0\r\n"


@pytest.fixture(scope="module")
def client() -> TestClient:
    """Loopback base_url so TrustedHostMiddleware accepts the Host."""
    return TestClient(app, base_url="http://127.0.0.1")


def test_preview_of_an_unknown_format_says_contact_the_dev_team(client: TestClient) -> None:
    """Unknown content → 400, the code and the contact-the-dev-team message."""
    response = client.post(
        "/lab-series/preview",
        files={"file": ("results.txt", _UNKNOWN, "text/plain")},
        data={"project_id": _PROJECT},
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "lab_file_format_not_recognised"
    assert detail["message"] == _MESSAGE


def test_import_of_an_unknown_format_says_contact_the_dev_team(client: TestClient) -> None:
    """The import refuses the same file the same way, and writes nothing."""
    response = client.post(
        "/lab-series/import",
        files={"file": ("results.csv", _UNKNOWN, "text/plain")},
        data={"project_id": _PROJECT, "borehole_id": _PROJECT, "create_sample": "true"},
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "lab_file_format_not_recognised"
    assert detail["message"] == _MESSAGE
