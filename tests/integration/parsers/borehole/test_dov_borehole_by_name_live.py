"""LIVE: the by-name borehole lookup against the real DOV WFS (skipped offline).

Owner 2026-09-30: a lab test naming a borehole the project does not hold is
fetched from DOV by name. The unit tests pin the client with a fake transport;
this one asks the real ``dov-pub:Boringen`` layer once, so a renamed attribute
or a changed CQL rule shows up here and not in the owner's import dialog. It is
SKIPPED when DOV cannot be reached (no network, proxy, outage).

Verified live 2026-09-30: the lab's ``GEO-19/122`` + ``B7A`` is DOV's
``1411-GEO-19/122-B7A`` (a prefixed name), permkey ``2020-170263``.
"""

from __future__ import annotations

import httpx
import pytest

from groundmodel.infrastructure.parsers.borehole.dov.dov_client import DovBoreholeClient
from groundmodel.infrastructure.parsers.dov.dov_common import DOV_WFS_URL


def _dov_reachable() -> bool:
    """One quick GetCapabilities; any failure means offline for this test."""
    try:
        response = httpx.get(
            DOV_WFS_URL, params={"service": "WFS", "request": "GetCapabilities"}, timeout=5.0
        )
    except httpx.HTTPError:
        return False
    return response.is_success


pytestmark = [
    pytest.mark.slow,
    pytest.mark.skipif(not _dov_reachable(), reason="DOV WFS not reachable (offline)"),
]


@pytest.mark.asyncio
async def test_a_prefixed_dov_borehole_is_found_by_the_lab_name() -> None:
    """``GEO-19/122-B7A`` finds DOV's ``1411-GEO-19/122-B7A``."""
    async with httpx.AsyncClient(timeout=30.0) as http:
        row = await DovBoreholeClient(http).find_by_name("GEO-19/122-B7A")
    assert row is not None
    assert row.test_id == "1411-GEO-19/122-B7A"
    assert row.permkey == "2020-170263"


@pytest.mark.asyncio
async def test_a_name_dov_does_not_know_answers_none() -> None:
    """A made-up job answers ``None``, not an error."""
    async with httpx.AsyncClient(timeout=30.0) as http:
        assert await DovBoreholeClient(http).find_by_name("GEO-99/999-B999") is None
