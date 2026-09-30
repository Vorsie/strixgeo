"""DovBoreholeClient.find_by_name — look ONE borehole up in DOV by its name.

Owner 2026-09-30: "Can't we just auto load from DOV when trying to load a lab
tests and throw exception if it can't be found?" The lab names job
``GEO-25/022`` and borehole ``B17``; DOV names the borehole ``GEO-25/022-B17``,
sometimes with a prefix (``1411-GEO-24/159-B2``) — the same "name ends with"
rule the lab matching uses. The lookup asks the Boringen WFS layer for the
``boornummer`` and answers the one row, or ``None``. ``httpx.MockTransport``,
no network.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from groundmodel.infrastructure.parsers.borehole.dov.dov_client import DovBoreholeClient


def _feature(boornummer: str, permkey: str) -> dict[str, Any]:
    """One Boringen WFS feature with the properties the row builder reads."""
    return {
        "type": "Feature",
        "properties": {
            "boornummer": boornummer,
            "fiche": f"https://www.dov.vlaanderen.be/data/boring/{permkey}",
            "X_mL72": 152000.0,
            "Y_mL72": 212000.0,
            "Z_mTAW": 6.1,
        },
    }


def _client(features: list[dict[str, Any]], seen: list[httpx.Request]) -> httpx.AsyncClient:
    """An HTTP client whose WFS answers ``features`` and records every request."""

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"type": "FeatureCollection", "features": features})

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_a_borehole_dov_has_is_found_by_its_name() -> None:
    """The WFS is asked for the name and the matching row comes back."""
    seen: list[httpx.Request] = []
    async with _client([_feature("GEO-25/022-B17", "2025-012345")], seen) as http:
        row = await DovBoreholeClient(http).find_by_name("GEO-25/022-B17")
    assert row is not None
    assert row.test_id == "GEO-25/022-B17"
    assert row.permkey == "2025-012345"
    cql = seen[0].url.params["CQL_FILTER"]
    assert "boornummer" in cql and "GEO-25/022-B17" in cql


@pytest.mark.asyncio
async def test_a_prefixed_dov_name_still_matches() -> None:
    """``1411-GEO-24/159-B2`` is the lab's ``GEO-24/159`` + ``B2``: name ends with."""
    seen: list[httpx.Request] = []
    async with _client([_feature("1411-GEO-24/159-B2", "2024-000002")], seen) as http:
        row = await DovBoreholeClient(http).find_by_name("GEO-24/159-B2")
    assert row is not None and row.test_id == "1411-GEO-24/159-B2"


@pytest.mark.asyncio
async def test_a_borehole_dov_does_not_have_answers_none() -> None:
    """Not published on DOV (yet) → ``None``, never an exception."""
    async with _client([], []) as http:
        assert await DovBoreholeClient(http).find_by_name("GEO-25/022-B17") is None


@pytest.mark.asyncio
async def test_a_wildcard_neighbour_that_does_not_end_with_the_name_is_not_taken() -> None:
    """``GEO-25/022-B170`` is not ``GEO-25/022-B17`` (the WFS LIKE is only a sieve)."""
    async with _client([_feature("GEO-25/022-B170", "2025-000170")], []) as http:
        assert await DovBoreholeClient(http).find_by_name("GEO-25/022-B17") is None


@pytest.mark.asyncio
async def test_the_exact_name_wins_over_a_prefixed_twin() -> None:
    """Two rows end with the name: the one that IS the name is the borehole."""
    features = [
        _feature("99-GEO-25/022-B17", "2025-000001"),
        _feature("GEO-25/022-B17", "2025-000002"),
    ]
    async with _client(features, []) as http:
        row = await DovBoreholeClient(http).find_by_name("GEO-25/022-B17")
    assert row is not None and row.permkey == "2025-000002"


@pytest.mark.asyncio
async def test_a_quote_in_the_name_cannot_break_out_of_the_filter() -> None:
    """A single quote is doubled inside the CQL string literal."""
    seen: list[httpx.Request] = []
    async with _client([], seen) as http:
        await DovBoreholeClient(http).find_by_name("B'1")
    assert "B''1" in seen[0].url.params["CQL_FILTER"]


@pytest.mark.asyncio
async def test_the_found_row_is_downloaded_and_processed_per_permkey() -> None:
    """``fetch_rows_processed`` — the bbox import's per-permkey half — hands back
    one ``(row, process result)`` pair per downloaded borehole."""
    xml = b"<boring/>"

    def handler(request: httpx.Request) -> httpx.Response:
        if "GetFeature" in str(request.url):
            return httpx.Response(
                200,
                json={
                    "type": "FeatureCollection",
                    "features": [_feature("GEO-25/022-B17", "2025-1")],
                },
            )
        return httpx.Response(200, content=xml)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = DovBoreholeClient(http)
        row = await client.find_by_name("GEO-25/022-B17")
        assert row is not None
        pairs = await client.fetch_rows_processed([row], lambda raw, test_id: (raw, test_id))
    assert pairs == [(row, (xml, "GEO-25/022-B17"))]
