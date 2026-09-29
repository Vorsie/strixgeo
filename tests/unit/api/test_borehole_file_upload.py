"""POST /borehole/import — the upload gates that answer before any DB work.

The consent contract (409 / 200 refreshed / 422) needs a database and lives in
``tests/integration/api/test_borehole_import_file.py``; here only the gates
the handler applies to the upload itself: suffix, byte cap, unreadable XML.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from groundmodel.api.main import app
from groundmodel.api.routers.borehole import MAX_BOREHOLE_XML_UPLOAD_BYTES

_PROJECT = {"project_id": "00000000-0000-0000-0000-000000000000"}


@pytest.fixture(scope="module")
def client() -> TestClient:
    """Loopback base_url so TrustedHostMiddleware accepts the Host."""
    return TestClient(app, base_url="http://127.0.0.1")


def test_a_non_xml_suffix_is_refused_400(client: TestClient) -> None:
    """Only .xml is a DOV borehole file; a .gef here is a 400 naming the suffix."""
    response = client.post(
        "/borehole/import",
        files={"file": ("B1.gef", b"#GEF", "text/plain")},
        data=_PROJECT,
    )
    assert response.status_code == 400
    assert ".xml" in response.text


def test_an_upload_over_the_cap_is_refused_413(client: TestClient) -> None:
    """A file larger than the per-upload cap never reaches the parser."""
    oversized = b"<a>" + b"x" * (MAX_BOREHOLE_XML_UPLOAD_BYTES + 1)
    response = client.post(
        "/borehole/import",
        files={"file": ("big.xml", oversized, "text/xml")},
        data=_PROJECT,
    )
    assert response.status_code == 413


def test_unreadable_xml_is_a_400_parse_error(client: TestClient) -> None:
    """A .xml that is not XML answers 400 with the parser's message."""
    response = client.post(
        "/borehole/import",
        files={"file": ("broken.xml", b"not xml", "text/xml")},
        data=_PROJECT,
    )
    assert response.status_code == 400
    assert "broken.xml" in response.text
