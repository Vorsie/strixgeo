"""Unit tests for the DOV Virtuele Boring client + payload parser.

Covers two surfaces:

* ``_parse_doorprik_payload`` — the merger of the API's ``data`` +
  ``layers`` arrays. Pure transform, no I/O.
* :class:`VirtueleBoringClient` — exercised against an in-memory
  ``httpx.MockTransport`` so request shape + error handling are
  verified without hitting the real DOV server.
"""

from __future__ import annotations

import json

import httpx
import pytest

from groundmodel.infrastructure.parsers.dov.virtuele_boring_client import (
    VirtueleBoringClient,
    VirtueleBoringFetchError,
    _parse_doorprik_payload,
)

# ---------------------------------------------------------------------------
# Payload parser
# ---------------------------------------------------------------------------


def test_parse_doorprik_payload_merges_data_and_catalog():
    """Each data row pulls catalog metadata (name, color, NCS link) by code."""
    payload = {
        "data": [
            {"name": "g3dv3_F_1", "top": 8.42, "base": -1.39, "thickness": 9.81},
            {"name": "g3dv3_F_22", "top": -14.36, "base": -84.43, "thickness": 70.07},
        ],
        "layers": [
            {
                "code": "g3dv3_F_1",
                "name": "Antropogeen",
                "beschrijving": "Antropogeen",
                "dovlayercolor": "#EA152E",
                "links": [],
            },
            {
                "code": "g3dv3_F_22",
                "name": "Formatie van Boom",
                "beschrijving": "Fm Boom",
                "dovlayercolor": "#999999",
                "links": [
                    {
                        "text": "Fm Boom",
                        "link": "https://ncs.naturalsciences.be/lithostratigraphy/Boom-Formation",
                    }
                ],
            },
        ],
    }

    layers = _parse_doorprik_payload(payload)

    assert len(layers) == 2
    assert layers[0].code == "g3dv3_F_1"
    assert layers[0].name == "Antropogeen"
    assert layers[0].top_m_taw == pytest.approx(8.42)
    assert layers[0].color_hex == "#EA152E"
    assert layers[0].ncs_link is None

    assert layers[1].name == "Formatie van Boom"
    assert layers[1].beschrijving == "Fm Boom"
    assert layers[1].ncs_link == "https://ncs.naturalsciences.be/lithostratigraphy/Boom-Formation"


def test_parse_doorprik_payload_handles_data_row_without_catalog_entry():
    """An orphan data row still emits a layer — with blank metadata."""
    payload = {
        "data": [{"name": "g3dv3_F_99", "top": 1.0, "base": 0.0, "thickness": 1.0}],
        "layers": [],
    }
    layers = _parse_doorprik_payload(payload)
    assert len(layers) == 1
    assert layers[0].name == ""
    assert layers[0].color_hex is None


def test_parse_doorprik_payload_tolerates_missing_arrays():
    """Empty / None ``data`` + ``layers`` produces an empty list, not a crash."""
    assert _parse_doorprik_payload({}) == []
    assert _parse_doorprik_payload({"data": None, "layers": None}) == []


def test_parse_doorprik_payload_drops_layers_without_string_code():
    """A catalog entry without a string code can't be joined; orphan rows fall back to blank."""
    payload = {
        "data": [{"name": "g3dv3_F_1", "top": 1.0, "base": 0.0, "thickness": 1.0}],
        "layers": [{"code": None, "name": "should be ignored", "dovlayercolor": "#000"}],
    }
    layers = _parse_doorprik_payload(payload)
    # The data row remains; it just doesn't pick up the orphan catalog entry.
    assert len(layers) == 1
    assert layers[0].name == ""
    assert layers[0].color_hex is None


def test_parse_doorprik_payload_handles_null_color_field():
    """``dovlayercolor: null`` is treated as missing, not the literal 'None'."""
    payload = {
        "data": [{"name": "x", "top": 1.0, "base": 0.0, "thickness": 1.0}],
        "layers": [
            {"code": "x", "name": "X", "beschrijving": "X", "dovlayercolor": None, "links": []}
        ],
    }
    layers = _parse_doorprik_payload(payload)
    assert layers[0].color_hex is None


# ---------------------------------------------------------------------------
# Client — exercised via httpx.MockTransport
# ---------------------------------------------------------------------------


def _client_with_handler(handler):
    """Build a VirtueleBoringClient whose HTTP transport is mocked."""
    transport = httpx.MockTransport(handler)
    http = httpx.AsyncClient(transport=transport)
    return VirtueleBoringClient(http), http


@pytest.mark.asyncio
async def test_fetch_doorprik_happy_path():
    """200 response → parsed layers, request goes to the expected URL with x/y params."""
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["params"] = dict(request.url.params)
        body = {
            "data": [{"name": "g3dv3_F_1", "top": 8.42, "base": -1.39, "thickness": 9.81}],
            "layers": [
                {
                    "code": "g3dv3_F_1",
                    "name": "Antropogeen",
                    "beschrijving": "Antropogeen",
                    "dovlayercolor": "#EA152E",
                    "links": [],
                }
            ],
        }
        return httpx.Response(
            200, content=json.dumps(body), headers={"Content-Type": "application/json"}
        )

    client, http = _client_with_handler(handler)
    try:
        result = await client.fetch_doorprik(152000.0, 212000.0, model="g3dv3_F")
    finally:
        await http.aclose()

    assert "/base/virtueleprofielen/doorprik/g3dv3_F" in captured["url"]
    assert captured["params"]["x"] == "152000.0"
    assert captured["params"]["y"] == "212000.0"
    assert result.model_code == "g3dv3_F"
    assert result.x_lambert72 == pytest.approx(152000.0)
    assert len(result.layers) == 1
    assert result.layers[0].name == "Antropogeen"


@pytest.mark.asyncio
async def test_fetch_doorprik_raises_on_non_200():
    """A 500 response surfaces as VirtueleBoringFetchError with status + body."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, content=b"upstream blew up")

    client, http = _client_with_handler(handler)
    try:
        with pytest.raises(VirtueleBoringFetchError) as exc_info:
            await client.fetch_doorprik(0.0, 0.0)
    finally:
        await http.aclose()

    assert exc_info.value.status_code == 500
    assert "upstream blew up" in exc_info.value.body


@pytest.mark.asyncio
async def test_fetch_lagenmodel_catalog_passthrough():
    """Catalog endpoint returns the raw list of {code, beschrijving, resoluties}."""

    def handler(request: httpx.Request) -> httpx.Response:
        body = [
            {"code": "g3dv3_F", "beschrijving": "G3D v3 formatie", "resoluties": [100, 200]},
            {"code": "hcovv2_H", "beschrijving": "HCOV v2 hoofdeenheden", "resoluties": [100, 200]},
        ]
        return httpx.Response(200, content=json.dumps(body))

    client, http = _client_with_handler(handler)
    try:
        catalog = await client.fetch_lagenmodel_catalog()
    finally:
        await http.aclose()

    assert len(catalog) == 2
    assert catalog[0]["code"] == "g3dv3_F"
    assert catalog[1]["beschrijving"] == "HCOV v2 hoofdeenheden"


@pytest.mark.asyncio
async def test_fetch_lagenmodel_catalog_tolerates_non_list_response():
    """A 200 response with non-list body returns an empty list rather than crashing."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b'{"error": "wrong shape"}')

    client, http = _client_with_handler(handler)
    try:
        catalog = await client.fetch_lagenmodel_catalog()
    finally:
        await http.aclose()

    assert catalog == []
