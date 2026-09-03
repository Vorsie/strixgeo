"""Unit tests for the DOV 429/503 retry helper + rate-limit state (M2c).

Rule (M2c): a 429/503 is no longer a hard failure — it is honoured with
``Retry-After`` and a bounded exponential retry (3 attempts); once a 429 is
seen the download parallelism is halved for the rest of the import and the
event is logged at WARNING.
"""

from __future__ import annotations

import httpx
import pytest

from groundmodel.infrastructure.parsers.dov.dov_common import (
    DOV_DOWNLOAD_PARALLELISM,
    DOV_MAX_HTTP_ATTEMPTS,
)
from groundmodel.infrastructure.parsers.dov.dov_http_retry import (
    DovRateLimitState,
    dov_get_with_retry,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


def _logger() -> GroundModelLogger:
    return GroundModelLogger("tests.dov_http_retry")


class _RecordingSleep:
    """Async no-op sleep that records the delays it was asked to wait."""

    def __init__(self) -> None:
        self.delays: list[float] = []

    async def __call__(self, delay: float) -> None:
        self.delays.append(delay)


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


# ---------------------------------------------------------------------------
# DovRateLimitState — halve once
# ---------------------------------------------------------------------------


def test_rate_limit_state_halves_parallelism_once() -> None:
    """note_throttle halves parallelism the FIRST time and never again."""
    state = DovRateLimitState()
    assert state.parallelism == DOV_DOWNLOAD_PARALLELISM
    state.note_throttle(_logger())
    assert state.parallelism == DOV_DOWNLOAD_PARALLELISM // 2
    # A second throttle does NOT halve again — it is a one-time reduction.
    state.note_throttle(_logger())
    assert state.parallelism == DOV_DOWNLOAD_PARALLELISM // 2


def test_rate_limit_state_never_drops_below_one() -> None:
    """Parallelism floors at 1 even from a tiny starting value."""
    state = DovRateLimitState(parallelism=1)
    state.note_throttle(_logger())
    assert state.parallelism == 1


# ---------------------------------------------------------------------------
# dov_get_with_retry
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_success_returns_immediately_without_sleeping() -> None:
    """A 2xx returns on the first attempt — no retry, no sleep."""
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, text="ok")

    sleep = _RecordingSleep()
    async with _client(handler) as http:
        resp = await dov_get_with_retry(
            http, "https://dov.example/x", logger=_logger(), label="t", sleep=sleep
        )
    assert resp.status_code == 200
    assert calls["n"] == 1
    assert sleep.delays == []


@pytest.mark.asyncio
async def test_429_then_200_retries_honouring_retry_after() -> None:
    """A 429 with Retry-After is retried after that many seconds, then succeeds."""
    seq = [httpx.Response(429, headers={"Retry-After": "7"}), httpx.Response(200, text="ok")]

    def handler(request: httpx.Request) -> httpx.Response:
        return seq.pop(0)

    sleep = _RecordingSleep()
    async with _client(handler) as http:
        resp = await dov_get_with_retry(
            http, "https://dov.example/x", logger=_logger(), label="t", sleep=sleep
        )
    assert resp.status_code == 200
    # Honoured the Retry-After value exactly once.
    assert sleep.delays == [7.0]


@pytest.mark.asyncio
async def test_503_exhausts_attempts_then_returns_last_response() -> None:
    """Persistent 503 gives up after DOV_MAX_HTTP_ATTEMPTS and returns the 503."""
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(503)

    sleep = _RecordingSleep()
    async with _client(handler) as http:
        resp = await dov_get_with_retry(
            http, "https://dov.example/x", logger=_logger(), label="t", sleep=sleep
        )
    assert resp.status_code == 503
    # Exactly DOV_MAX_HTTP_ATTEMPTS network attempts were made.
    assert calls["n"] == DOV_MAX_HTTP_ATTEMPTS
    # And it slept between attempts (one fewer sleep than attempts).
    assert len(sleep.delays) == DOV_MAX_HTTP_ATTEMPTS - 1


@pytest.mark.asyncio
async def test_429_halves_parallelism_via_backoff_state() -> None:
    """A 429 halves the shared parallelism state exactly once."""
    seq = [httpx.Response(429), httpx.Response(429), httpx.Response(200)]

    def handler(request: httpx.Request) -> httpx.Response:
        return seq.pop(0)

    sleep = _RecordingSleep()
    state = DovRateLimitState()
    async with _client(handler) as http:
        resp = await dov_get_with_retry(
            http,
            "https://dov.example/x",
            logger=_logger(),
            label="t",
            backoff=state,
            sleep=sleep,
        )
    assert resp.status_code == 200
    # Two 429s were seen but parallelism is halved only once.
    assert state.parallelism == DOV_DOWNLOAD_PARALLELISM // 2


@pytest.mark.asyncio
async def test_no_retry_after_uses_bounded_exponential_backoff() -> None:
    """Without Retry-After the delays grow exponentially from the base."""
    seq = [httpx.Response(503), httpx.Response(503), httpx.Response(200)]

    def handler(request: httpx.Request) -> httpx.Response:
        return seq.pop(0)

    sleep = _RecordingSleep()
    async with _client(handler) as http:
        await dov_get_with_retry(
            http, "https://dov.example/x", logger=_logger(), label="t", sleep=sleep
        )
    # Two retries, strictly increasing (exponential) delays.
    assert len(sleep.delays) == 2
    assert sleep.delays[1] > sleep.delays[0]
