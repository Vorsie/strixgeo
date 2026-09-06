"""Unit tests for the DOV fixture transport (``dov_fixture_transport.py``).

Tests cover three behaviours:
1. ``STRIXGEO_DOV_FIXTURE_MODE=1`` causes ``make_dov_async_client`` to return a
   client backed by ``MockTransport``, not the production network.
2. A request to a known DOV URL (WFS + per-permkey XML) returns the correct
   fixture file contents.
3. A request whose route has no matching fixture (and no fallback) returns
   HTTP 404 so the failure is loud rather than silent.
4. ``STRIXGEO_DOV_FIXTURE_MODE`` unset → the client is a plain ``AsyncClient``
   with no mock transport.
"""

from __future__ import annotations

import json
import textwrap
from pathlib import Path

import httpx
import pytest

from groundmodel.infrastructure.parsers.dov.dov_fixture_transport import (
    DOV_FIXTURE_MODE_ENV,
    DOV_FIXTURE_ROOT_ENV,
    _build_fixture_transport,
    _fixture_mode_allowed,
    is_fixture_mode,
)
from groundmodel.infrastructure.parsers.dov.dov_http import (
    _HostAllowlistTransport,
    make_dov_async_client,
)
from groundmodel.infrastructure.parsers.dov.virtuele_boring_constants import (
    DOV_VIRTUELE_BORING_BASE_URL,
    DOV_VIRTUELE_BORING_LAGENMODEL_PATH,
)
from groundmodel.shared.config import settings

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_fixture_tree(tmp_path: Path) -> Path:
    """Build a minimal fixture directory tree under *tmp_path*.

    Returns the root directory.
    """
    root = tmp_path / "dov"
    (root / "wfs").mkdir(parents=True)
    (root / "cpt").mkdir()
    (root / "borehole").mkdir()
    (root / "interpretatie").mkdir()
    (root / "observatie").mkdir()

    # WFS count fixture — Sonderingen layer.
    (root / "wfs" / "sonderingen_count.xml").write_text(
        '<?xml version="1.0"?>'
        '<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0"'
        ' numberMatched="2" numberReturned="0"/>',
        encoding="utf-8",
    )
    # WFS features fixture — Sonderingen layer.
    features = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "fiche": "https://www.dov.vlaanderen.be/data/sondering/2024-UNIT-001",
                    "sondeernummer": "UNIT-CPT-001",
                    "X_mL72": 149000.0,
                    "Y_mL72": 192000.0,
                },
            }
        ],
    }
    (root / "wfs" / "sonderingen_features.json").write_text(json.dumps(features), encoding="utf-8")
    # Empty fallback fixtures — used for layers without explicit fixtures.
    (root / "wfs" / "empty_count.xml").write_text(
        '<?xml version="1.0"?>'
        '<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0"'
        ' numberMatched="0" numberReturned="0"/>',
        encoding="utf-8",
    )
    (root / "wfs" / "empty_features.json").write_text(
        '{"type":"FeatureCollection","features":[]}', encoding="utf-8"
    )
    # Per-permkey CPT XML.
    cpt_xml = textwrap.dedent("""\
        <?xml version="1.0"?>
        <dov-schema xmlns="http://kern.schemas.dov.vlaanderen.be">
          <sondering><sondeernummer>UNIT-CPT-001</sondeernummer></sondering>
        </dov-schema>
    """)
    (root / "cpt" / "2024-UNIT-001").write_text(cpt_xml, encoding="utf-8")

    return root


# ---------------------------------------------------------------------------
# is_fixture_mode
# ---------------------------------------------------------------------------


def test_is_fixture_mode_when_env_is_one(monkeypatch: pytest.MonkeyPatch) -> None:
    """STRIXGEO_DOV_FIXTURE_MODE=1 → is_fixture_mode() returns True."""
    monkeypatch.setenv(DOV_FIXTURE_MODE_ENV, "1")
    assert is_fixture_mode() is True


def test_is_fixture_mode_false_when_env_absent(monkeypatch: pytest.MonkeyPatch) -> None:
    """Absent env var → is_fixture_mode() returns False."""
    monkeypatch.delenv(DOV_FIXTURE_MODE_ENV, raising=False)
    assert is_fixture_mode() is False


def test_is_fixture_mode_false_when_env_is_zero(monkeypatch: pytest.MonkeyPatch) -> None:
    """STRIXGEO_DOV_FIXTURE_MODE=0 (any value != '1') → is_fixture_mode() returns False."""
    monkeypatch.setenv(DOV_FIXTURE_MODE_ENV, "0")
    assert is_fixture_mode() is False


def test_is_fixture_mode_denied_in_a_packaged_production_backend(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A packaged (production) backend must NOT honour STRIXGEO_DOV_FIXTURE_MODE=1.

    The test seam is a development/e2e-only convenience. An end user who sets
    the env var in their shell must not be able to redirect the shipped app's
    DOV imports to on-disk synthetic fixtures. The packaged launcher runs the
    backend with ``ENVIRONMENT=production`` (the same flag that turns the docs
    UI off), so fixture mode is refused whenever the environment is not
    development, even with the env var explicitly set to ``"1"``.
    """
    monkeypatch.setenv(DOV_FIXTURE_MODE_ENV, "1")
    monkeypatch.setattr(settings, "environment", "production")
    assert is_fixture_mode() is False


def test_is_fixture_mode_honoured_in_development_when_env_is_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Development (the e2e harness's default) still honours the fixture env var.

    The e2e runner sets ``STRIXGEO_DOV_FIXTURE_MODE=1`` and does not set
    ``ENVIRONMENT``, so the backend runs as ``development`` and the offline
    DOV cassettes must keep working.
    """
    monkeypatch.setenv(DOV_FIXTURE_MODE_ENV, "1")
    monkeypatch.setattr(settings, "environment", "development")
    assert is_fixture_mode() is True


def test_fixture_mode_allowed_only_in_development() -> None:
    """The pure decision: ``"1"`` is honoured in development and refused elsewhere.

    Exhaustive over the two axes (env value present/absent x environment
    dev/non-dev) so the production-refusal invariant does not depend on env or
    settings mutation.
    """
    # Requested AND development -> allowed.
    assert _fixture_mode_allowed("1", "development") is True
    # Requested but a packaged/production backend -> refused.
    assert _fixture_mode_allowed("1", "production") is False
    # Requested but any other non-dev environment -> refused.
    assert _fixture_mode_allowed("1", "staging") is False
    # Not requested, whatever the environment -> off.
    assert _fixture_mode_allowed(None, "development") is False
    assert _fixture_mode_allowed("0", "development") is False
    assert _fixture_mode_allowed(None, "production") is False


# ---------------------------------------------------------------------------
# make_dov_async_client — transport selection
# ---------------------------------------------------------------------------


def test_fixture_mode_client_uses_mock_transport(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """STRIXGEO_DOV_FIXTURE_MODE=1 → client transport is MockTransport, not real network."""
    root = _make_fixture_tree(tmp_path)
    monkeypatch.setenv(DOV_FIXTURE_MODE_ENV, "1")
    monkeypatch.setenv(DOV_FIXTURE_ROOT_ENV, str(root))

    client = make_dov_async_client()
    # httpx.AsyncClient wraps the transport in a private attribute.
    # We assert it is NOT an AsyncHTTPTransport (the production transport).
    assert not isinstance(client._transport, httpx.AsyncHTTPTransport), (
        "Fixture mode must use MockTransport, not the real network transport"
    )
    # No close() needed — the client holds no open connections until it has
    # been used; aclose() is async and would require an event loop here.


def test_production_mode_client_uses_real_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Absent STRIXGEO_DOV_FIXTURE_MODE → client uses the production network transport."""
    monkeypatch.delenv(DOV_FIXTURE_MODE_ENV, raising=False)

    client = make_dov_async_client()
    # Production path wraps httpx's real transport in the SSRF host-allowlist
    # guard — so it must be that wrapper AROUND an AsyncHTTPTransport, never a
    # MockTransport.
    assert isinstance(client._transport, _HostAllowlistTransport), (
        "Production mode must use the host-allowlist guard transport"
    )
    assert isinstance(client._transport._inner, httpx.AsyncHTTPTransport), (
        "The guard must wrap the real HTTP transport, not MockTransport"
    )
    # No close() needed — no open connections before first use.


# ---------------------------------------------------------------------------
# Fixture transport — route handling
# ---------------------------------------------------------------------------


def test_wfs_count_request_returns_fixture(tmp_path: Path) -> None:
    """GET /geoserver/ows?typeNames=dov-pub:Sonderingen&resultType=hits → sonderingen_count.xml."""
    root = _make_fixture_tree(tmp_path)
    transport = _build_fixture_transport(root)

    url = (
        "https://www.dov.vlaanderen.be/geoserver/ows"
        "?service=WFS&version=2.0.0&request=GetFeature"
        "&typeNames=dov-pub%3ASonderingen&resultType=hits"
        "&BBOX=148000%2C191000%2C150000%2C193000%2CEPSG%3A31370"
    )
    request = httpx.Request("GET", url)
    response = transport.handle_request(request)

    assert response.status_code == 200
    assert b'numberMatched="2"' in response.content


def test_wfs_features_request_returns_fixture(tmp_path: Path) -> None:
    """GET /geoserver/ows?...outputFormat=application/json → sonderingen_features.json."""
    root = _make_fixture_tree(tmp_path)
    transport = _build_fixture_transport(root)

    url = (
        "https://www.dov.vlaanderen.be/geoserver/ows"
        "?service=WFS&version=2.0.0&request=GetFeature"
        "&typeNames=dov-pub%3ASonderingen"
        "&outputFormat=application%2Fjson&count=500"
        "&BBOX=148000%2C191000%2C150000%2C193000%2CEPSG%3A31370"
    )
    request = httpx.Request("GET", url)
    response = transport.handle_request(request)

    assert response.status_code == 200
    data = json.loads(response.content)
    assert data["type"] == "FeatureCollection"
    assert len(data["features"]) == 1
    assert data["features"][0]["properties"]["sondeernummer"] == "UNIT-CPT-001"


def test_cpt_xml_request_returns_fixture(tmp_path: Path) -> None:
    """GET /xdov/proxy/export/sondering/2024-UNIT-001 → cpt/2024-UNIT-001 file."""
    root = _make_fixture_tree(tmp_path)
    transport = _build_fixture_transport(root)

    url = "https://www.dov.vlaanderen.be/xdov/proxy/export/sondering/2024-UNIT-001"
    request = httpx.Request("GET", url)
    response = transport.handle_request(request)

    assert response.status_code == 200
    assert b"UNIT-CPT-001" in response.content


def test_unknown_interpretation_layer_falls_back_to_empty(tmp_path: Path) -> None:
    """Interpretation layer without explicit fixture falls back to empty_count.xml."""
    root = _make_fixture_tree(tmp_path)
    transport = _build_fixture_transport(root)

    # ``interpretaties:formele_stratigrafie`` has no fixture in the tree.
    url = (
        "https://www.dov.vlaanderen.be/geoserver/ows"
        "?service=WFS&version=2.0.0&request=GetFeature"
        "&typeNames=interpretaties%3Aformele_stratigrafie&resultType=hits"
        "&BBOX=148000%2C191000%2C150000%2C193000%2CEPSG%3A31370"
    )
    request = httpx.Request("GET", url)
    response = transport.handle_request(request)

    assert response.status_code == 200
    assert b'numberMatched="0"' in response.content


def test_missing_fixture_returns_404(tmp_path: Path) -> None:
    """A per-permkey request for a non-existent fixture returns 404 — fails loudly."""
    root = _make_fixture_tree(tmp_path)
    # Remove the empty fallback so there is no fallback either.
    (root / "wfs" / "empty_count.xml").unlink()
    (root / "wfs" / "empty_features.json").unlink()
    transport = _build_fixture_transport(root)

    # CPT permkey with no fixture file.
    url = "https://www.dov.vlaanderen.be/xdov/proxy/export/sondering/NONEXISTENT-KEY"
    request = httpx.Request("GET", url)
    response = transport.handle_request(request)

    assert response.status_code == 404
    assert b"no fixture" in response.content.lower()


def test_unmatched_route_returns_404(tmp_path: Path) -> None:
    """A completely unknown URL path returns 404."""
    root = _make_fixture_tree(tmp_path)
    transport = _build_fixture_transport(root)

    url = "https://www.dov.vlaanderen.be/unknown/path"
    request = httpx.Request("GET", url)
    response = transport.handle_request(request)

    assert response.status_code == 404


def test_virtuele_boring_catalog_returns_fixture(tmp_path: Path) -> None:
    """GET the Virtuele Boring lagenmodel catalogue → virtuele_boring/lagenmodel.json.

    The offline harness must answer the DOV model-picker catalogue call with a
    small deterministic list, not 502 on the unreachable live DOV host (walker
    findings 1-9, 2026-09-06). The route matches the exact catalogue URL the
    client builds from ``virtuele_boring_constants``. It lives on a different
    host (``services.dov.vlaanderen.be``) than the WFS routes, so it needs its
    own branch in the transport handler.
    """
    root = _make_fixture_tree(tmp_path)
    (root / "virtuele_boring").mkdir()
    (root / "virtuele_boring" / "lagenmodel.json").write_text(
        json.dumps(
            [
                {
                    "code": "g3dv3_F",
                    "beschrijving": "G3D v3.1 per formatie",
                    "resoluties": [50, 100],
                },
                {"code": "hcovv2_H", "beschrijving": "HCOV v2 hoofdeenheden", "resoluties": [100]},
            ]
        ),
        encoding="utf-8",
    )
    transport = _build_fixture_transport(root)

    url = f"{DOV_VIRTUELE_BORING_BASE_URL}{DOV_VIRTUELE_BORING_LAGENMODEL_PATH}"
    response = transport.handle_request(httpx.Request("GET", url))

    assert response.status_code == 200
    catalog = json.loads(response.content)
    assert [entry["code"] for entry in catalog] == ["g3dv3_F", "hcovv2_H"]
