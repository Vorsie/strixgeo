"""A DEM tile request that cannot be a real place never reaches the network.

Dogfeed 2026-08-02 (terminal evidence): the backend re-issued the same WCS
``GetCoverage`` for ``X(-2.000,1002.000) Y(-2.000,2.000)`` — a 1000 m × 4 m
strip anchored at the origin, i.e. an extent that is not Belgian Lambert 72 at
all — dozens of times in one session, 404ing every time, with no backoff.

Two rules, in the rule's own words:

* an extent outside the project CRS's own domain is refused locally, naming
  the extent, WITHOUT asking upstream;
* an extent that upstream PERMANENTLY failed for is not asked again for some
  minutes — but a failure that will fix itself (a dropped connection, a
  timeout, a 5xx) is retried immediately, because suppressing those locks a
  tile out of a network that is already healthy again.
"""

from __future__ import annotations

import pathlib
import tempfile

import httpx
import pytest

from groundmodel.infrastructure.dem.dem_negative_cache import DEM_NEGATIVE_CACHE, make_tile_key
from groundmodel.infrastructure.dem.dem_tile_cache import DemTileCache
from groundmodel.infrastructure.dem.dhmvii_dem_provider import DhmviiDemProvider
from groundmodel.shared.exceptions import DemExtentRefusedError, DemUpstreamRecentlyFailedError

# A real Flanders extent (Lambert 72) — the control case that must be allowed
# through to the transport.
_IN_DOMAIN = (88_000.0, 164_000.0, 88_600.0, 164_600.0)


def _provider(transport: httpx.MockTransport) -> DhmviiDemProvider:
    """Build a DHMVII provider with an empty tile cache and a mocked transport.

    Parameters
    ----------
    transport : httpx.MockTransport
        Transport standing in for the Geopunt WCS.

    Returns
    -------
    DhmviiDemProvider
        Provider wired to a throwaway cache directory.
    """
    provider = DhmviiDemProvider(DemTileCache(pathlib.Path(tempfile.mkdtemp()), "dhmvii"))
    provider._client = httpx.AsyncClient(transport=transport)
    return provider


def _exploding_transport() -> tuple[httpx.MockTransport, list[httpx.Request]]:
    """Return a transport that records every request it is handed.

    Returns
    -------
    tuple[httpx.MockTransport, list[httpx.Request]]
        The transport plus the list its handler appends to.
    """
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(404, text="not found")

    return httpx.MockTransport(handler), seen


@pytest.fixture(autouse=True)
def _clear_negative_cache() -> None:
    """Keep the process-wide negative cache from leaking between tests."""
    DEM_NEGATIVE_CACHE.clear()


@pytest.mark.asyncio
async def test_origin_anchored_line_is_refused_without_a_network_call() -> None:
    """The observed (0,0)→(1000,0) section strip is refused locally, naming the extent."""
    transport, seen = _exploding_transport()
    provider = _provider(transport)

    with pytest.raises(DemExtentRefusedError) as err:
        await provider.sample_along_line(
            start_x=0.0, start_y=0.0, end_x=1000.0, end_y=0.0, n_samples=200
        )

    assert seen == [], "a refused extent must not reach the WCS"
    # The message has to name the numbers so the next occurrence is diagnosable
    # from one log line.
    assert "1002" in str(err.value) or "1000" in str(err.value)
    assert err.value.extent[0] == pytest.approx(-2.0)


@pytest.mark.asyncio
async def test_a_span_larger_than_the_cap_is_refused() -> None:
    """A 40 km-wide hull is a caller bug, not a tile — refuse before asking."""
    transport, seen = _exploding_transport()
    provider = _provider(transport)

    with pytest.raises(DemExtentRefusedError):
        await provider.fetch_grid(20_000.0, 160_000.0, 60_000.0, 164_000.0)

    assert seen == []


@pytest.mark.asyncio
async def test_a_real_flanders_extent_still_reaches_the_wcs() -> None:
    """Control: an in-domain extent is NOT refused — it goes to the network."""
    transport, seen = _exploding_transport()
    provider = _provider(transport)

    # The stub answers 404, so the call fails — but it fails AT the transport,
    # which is exactly what this test pins.
    with pytest.raises(httpx.HTTPStatusError):
        await provider.fetch_grid(*_IN_DOMAIN)

    assert len(seen) == 1


@pytest.mark.asyncio
async def test_the_same_failing_tile_is_not_refetched_within_the_ttl() -> None:
    """A second request for a tile that just 404'd raises without a network call."""
    transport, seen = _exploding_transport()
    provider = _provider(transport)

    with pytest.raises(httpx.HTTPStatusError):
        await provider.fetch_grid(*_IN_DOMAIN)
    assert len(seen) == 1

    with pytest.raises(DemUpstreamRecentlyFailedError) as err:
        await provider.fetch_grid(*_IN_DOMAIN)

    assert len(seen) == 1, "the second attempt must be answered from the negative cache"
    assert err.value.retry_after_seconds > 0


@pytest.mark.asyncio
async def test_a_dropped_connection_is_retried_at_once() -> None:
    """A transport-level failure self-heals — it must NOT be suppressed for minutes."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        raise httpx.ConnectError("connection refused", request=request)

    provider = _provider(httpx.MockTransport(handler))

    with pytest.raises(httpx.ConnectError):
        await provider.fetch_grid(*_IN_DOMAIN)
    with pytest.raises(httpx.ConnectError):
        await provider.fetch_grid(*_IN_DOMAIN)

    assert len(seen) == 2, "a dropped connection must be retried, not negative-cached"


@pytest.mark.asyncio
async def test_a_server_error_is_retried_at_once() -> None:
    """A 503 means 'upstream is busy', not 'this tile does not exist'."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(503, text="service unavailable")

    provider = _provider(httpx.MockTransport(handler))

    with pytest.raises(httpx.HTTPStatusError):
        await provider.fetch_grid(*_IN_DOMAIN)
    with pytest.raises(httpx.HTTPStatusError):
        await provider.fetch_grid(*_IN_DOMAIN)

    assert len(seen) == 2, "a 5xx must be retried, not negative-cached"


@pytest.mark.asyncio
async def test_an_undecodable_body_is_negative_cached() -> None:
    """A 200 carrying an OWS ExceptionReport is permanent — asking again cannot help."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, content=b"<ows:ExceptionReport/>")

    provider = _provider(httpx.MockTransport(handler))

    with pytest.raises(ValueError):
        await provider.fetch_grid(*_IN_DOMAIN)
    with pytest.raises(DemUpstreamRecentlyFailedError):
        await provider.fetch_grid(*_IN_DOMAIN)

    assert len(seen) == 1


@pytest.mark.asyncio
async def test_the_tile_is_retried_once_the_window_has_elapsed() -> None:
    """After the TTL the key is tried again — a transient outage self-heals."""
    transport, seen = _exploding_transport()
    provider = _provider(transport)

    with pytest.raises(httpx.HTTPStatusError):
        await provider.fetch_grid(*_IN_DOMAIN)

    # Travel past the window by re-recording the failure far enough in the past.
    key = make_tile_key(
        provider.provider_id,
        _IN_DOMAIN[0] - 2.0,
        _IN_DOMAIN[1] - 2.0,
        _IN_DOMAIN[2] + 2.0,
        _IN_DOMAIN[3] + 2.0,
        provider.DEFAULT_RESOLUTION_M,
    )
    DEM_NEGATIVE_CACHE.record_failure(key, now=-10_000.0)

    with pytest.raises(httpx.HTTPStatusError):
        await provider.fetch_grid(*_IN_DOMAIN)

    assert len(seen) == 2
