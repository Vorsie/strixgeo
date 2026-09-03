"""Unit tests for the shared DOV WFS request parameter builder.

Focuses on the corner-normalisation contract added to fix DOV's
``illegal bbox`` 400 response when projected Lambert-72 coordinates
flip Y direction for near-degenerate WGS84 rectangles.
"""

from __future__ import annotations

import httpx
import pytest

from groundmodel.infrastructure.parsers.dov.dov_http_retry import DovRateLimitState
from groundmodel.infrastructure.parsers.dov.dov_wfs_request import (
    _build_params,
    wfs_count,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


def _logger() -> GroundModelLogger:
    return GroundModelLogger("tests.dov_wfs_request")


def test_bbox_query_param_normalised_when_y_corners_inverted():
    """A south corner that projected to a higher Y must end up as min, not max."""
    # Mimic the real DOV failure: minY (from south) > maxY (from north) by 2.9 cm.
    params = _build_params(
        layer="dov-pub:Boringen",
        x1=100674.99,  # west
        y1=178648.19,  # south projected to higher Y
        x2=100678.01,  # east
        y2=178648.16,  # north projected to lower Y
        cql_filter=None,
    )
    bbox = params["BBOX"]
    parts = bbox.split(",")
    min_x, min_y, max_x, max_y = (float(p) for p in parts[:4])
    assert min_x <= max_x
    assert min_y <= max_y
    # And the value parts cover the original extent.
    assert {min_y, max_y} == {178648.19, 178648.16}


def test_bbox_query_param_unchanged_when_already_normalised():
    """Normal NE-positive bbox passes through with the same corner ordering."""
    params = _build_params(
        layer="dov-pub:Boringen",
        x1=100000.0,
        y1=170000.0,
        x2=110000.0,
        y2=180000.0,
        cql_filter=None,
    )
    assert params["BBOX"].startswith("100000.0,170000.0,110000.0,180000.0,")


def test_cql_bbox_predicate_normalised_when_corners_inverted():
    """Same normalisation applies to the CQL ``BBOX(geom, ...)`` predicate path."""
    params = _build_params(
        layer="monster:observaties",
        x1=100678.01,  # x1 > x2 — west corner accidentally bigger
        y1=178648.19,
        x2=100674.99,
        y2=178648.16,
        cql_filter="parameter='X'",
    )
    cql = params["CQL_FILTER"]
    # The CQL string carries `BBOX(geom,minX,minY,maxX,maxY,'EPSG:31370')` —
    # check the four numeric corners are in min-then-max order.
    inner = cql[cql.index("BBOX(geom,") + len("BBOX(geom,") : cql.index(",'EPSG:")]
    min_x, min_y, max_x, max_y = (float(p) for p in inner.split(","))
    assert min_x <= max_x
    assert min_y <= max_y


def test_bbox_omits_query_param_when_cql_filter_present():
    """Mutual exclusion: CQL filter path must not emit a standalone BBOX= param."""
    params = _build_params(
        layer="monster:observaties",
        x1=100000.0,
        y1=170000.0,
        x2=110000.0,
        y2=180000.0,
        cql_filter="parameter='X'",
    )
    assert "BBOX" not in params
    assert "CQL_FILTER" in params


# ---------------------------------------------------------------------------
# 429/503 retry wiring (M2c) — wfs_count rides out a throttle instead of raising
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_wfs_count_retries_through_a_429():
    """A 429 (Retry-After: 0) is retried, then the count is returned — not raised.

    Before M2c a 429 was a hard failure (raise_for_status). Now the WFS request
    layer routes through the retry helper, so a transient rate-limit is survived.
    """
    seq = [
        httpx.Response(429, headers={"Retry-After": "0"}),
        httpx.Response(200, text='<wfs:FeatureCollection numberMatched="42" />'),
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        return seq.pop(0)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        count = await wfs_count(
            http, _logger(), layer="dov-pub:Sonderingen", x1=0, y1=0, x2=1, y2=1
        )
    assert count == 42


@pytest.mark.asyncio
async def test_wfs_count_429_halves_backoff_parallelism():
    """A 429 seen during discovery halves the shared import parallelism state."""
    from groundmodel.infrastructure.parsers.dov.dov_common import DOV_DOWNLOAD_PARALLELISM

    seq = [
        httpx.Response(429, headers={"Retry-After": "0"}),
        httpx.Response(200, text='<wfs:FeatureCollection numberMatched="1" />'),
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        return seq.pop(0)

    state = DovRateLimitState()
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        await wfs_count(
            http, _logger(), layer="dov-pub:Sonderingen", x1=0, y1=0, x2=1, y2=1, backoff=state
        )
    assert state.parallelism == DOV_DOWNLOAD_PARALLELISM // 2
