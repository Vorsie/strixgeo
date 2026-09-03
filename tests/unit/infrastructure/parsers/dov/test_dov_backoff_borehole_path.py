"""The DOV borehole import threads ONE shared rate-limit state through every
sub-client, so a 429 seen by any of them halves the download parallelism for
the rest of the import.

The CPT path already does this (``dov_http_retry.DovRateLimitState`` wired end
to end in ``cpt/dov/dov_client.py``). The borehole path — the boring client
plus the interpretation / sample / grain-size / scalar sub-clients — got the
retry but not the halving. These pins prove each distinct client seam now
accepts a shared ``DovRateLimitState`` and:

* WFS-only clients (sample, scalar) thread it into the WFS request layer, so a
  429 during discovery halves the shared state.
* download clients (boring, interpretation, grain-size) additionally hand the
  halved parallelism AND the shared state to ``parallel_download_and_process``,
  so a 429 seen during discovery makes the following download batch run at half
  concurrency.

All drive an ``httpx.MockTransport`` — no network, no database.
"""

from __future__ import annotations

import httpx
import pytest

from groundmodel.infrastructure.parsers.borehole.dov import dov_client as borehole_client_mod
from groundmodel.infrastructure.parsers.borehole.dov import (
    dov_interpretation_client as interp_client_mod,
)
from groundmodel.infrastructure.parsers.borehole.dov.dov_client import DovBoreholeClient
from groundmodel.infrastructure.parsers.borehole.dov.dov_interpretation_client import (
    DovInterpretationClient,
)
from groundmodel.infrastructure.parsers.borehole.dov.dov_sample_client import DovSampleClient
from groundmodel.infrastructure.parsers.dov.dov_common import DOV_DOWNLOAD_PARALLELISM
from groundmodel.infrastructure.parsers.dov.dov_http_retry import DovRateLimitState
from groundmodel.infrastructure.parsers.lab.dov import dov_grain_size_client as gs_client_mod
from groundmodel.infrastructure.parsers.lab.dov.dov_grain_size_client import DovGrainSizeClient
from groundmodel.infrastructure.parsers.lab.dov.dov_scalar_observation_client import (
    DovScalarObservationClient,
)

# A Belgium-plausible WGS84 bbox — the coordinates only need to project cleanly.
_BBOX = (3.0, 51.0, 3.1, 51.1)


def _wfs_handler_429_then_ok():
    """Handler whose FIRST WFS count request 429s, then everything succeeds.

    Count requests carry ``resultType=hits``; feature requests carry
    ``outputFormat=application/json``. The first count 429s (Retry-After 0 so the
    retry is instant), every later count returns ``numberMatched="1"`` and every
    feature request returns an empty feature collection — enough for the client
    to reach its download phase without any XML actually being fetched.
    """
    state = {"count_calls": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.params.get("resultType") == "hits":
            state["count_calls"] += 1
            if state["count_calls"] == 1:
                return httpx.Response(429, headers={"Retry-After": "0"})
            return httpx.Response(200, text='<wfs:FeatureCollection numberMatched="1" />')
        return httpx.Response(200, json={"type": "FeatureCollection", "features": []})

    return handler


def _mock_http() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(_wfs_handler_429_then_ok()))


# ---------------------------------------------------------------------------
# WFS-only sub-clients (sample, scalar) — a 429 in discovery halves the state
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sample_client_shares_backoff_and_a_429_halves_it() -> None:
    """DovSampleClient accepts the shared state and its WFS 429 halves it."""
    state = DovRateLimitState()
    async with _mock_http() as http:
        await DovSampleClient(http, backoff=state).fetch_bbox(*_BBOX)
    assert state.parallelism == DOV_DOWNLOAD_PARALLELISM // 2


@pytest.mark.asyncio
async def test_scalar_client_shares_backoff_and_a_429_halves_it() -> None:
    """DovScalarObservationClient accepts the shared state and its WFS 429 halves it."""
    state = DovRateLimitState()
    async with _mock_http() as http:
        await DovScalarObservationClient(http, backoff=state).fetch_bbox(*_BBOX, "SOME-PARAM")
    assert state.parallelism == DOV_DOWNLOAD_PARALLELISM // 2


# ---------------------------------------------------------------------------
# Download sub-clients (boring, interpretation, grain-size) — a 429 in discovery
# makes the following download batch run at half parallelism
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_borehole_download_runs_at_half_parallelism_after_a_429(monkeypatch) -> None:
    """A 429 during boring WFS discovery halves the shared state, and the download
    phase is handed that halved parallelism plus the same state instance."""
    captured: dict[str, object] = {}

    async def fake_pdp(**kwargs):
        captured.update(kwargs)
        return []

    monkeypatch.setattr(borehole_client_mod, "parallel_download_and_process", fake_pdp)

    state = DovRateLimitState()
    async with _mock_http() as http:
        await DovBoreholeClient(http, backoff=state).fetch_bbox_processed(
            *_BBOX, lambda _b, _name: None
        )

    assert state.parallelism == DOV_DOWNLOAD_PARALLELISM // 2
    assert captured["parallelism"] == DOV_DOWNLOAD_PARALLELISM // 2
    assert captured["backoff"] is state


@pytest.mark.asyncio
async def test_interpretation_download_runs_at_half_parallelism_after_a_429(monkeypatch) -> None:
    """A 429 during interpretation WFS discovery halves the shared state, and the
    download phase is handed that halved parallelism plus the same state."""
    captured: dict[str, object] = {}

    async def fake_pdp(**kwargs):
        captured.update(kwargs)
        return []

    monkeypatch.setattr(interp_client_mod, "parallel_download_and_process", fake_pdp)

    state = DovRateLimitState()
    async with _mock_http() as http:
        await DovInterpretationClient(http, backoff=state).fetch_bbox_processed(
            *_BBOX, lambda _r, _b: None
        )

    assert state.parallelism == DOV_DOWNLOAD_PARALLELISM // 2
    assert captured["parallelism"] == DOV_DOWNLOAD_PARALLELISM // 2
    assert captured["backoff"] is state


@pytest.mark.asyncio
async def test_grain_size_download_runs_at_half_parallelism_after_a_429(monkeypatch) -> None:
    """A 429 during grain-size WFS discovery halves the shared state, and the
    download phase is handed that halved parallelism plus the same state."""
    captured: dict[str, object] = {}

    async def fake_pdp(**kwargs):
        captured.update(kwargs)
        return []

    monkeypatch.setattr(gs_client_mod, "parallel_download_and_process", fake_pdp)

    state = DovRateLimitState()
    async with _mock_http() as http:
        await DovGrainSizeClient(http, backoff=state).fetch_bbox_processed(
            *_BBOX, lambda _r, _b: None
        )

    assert state.parallelism == DOV_DOWNLOAD_PARALLELISM // 2
    assert captured["parallelism"] == DOV_DOWNLOAD_PARALLELISM // 2
    assert captured["backoff"] is state
