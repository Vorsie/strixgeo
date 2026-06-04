"""Unit tests for the shared DOV WFS fetch wrapper (``fetch_wfs_or_raise``).

The helper centralises the try/except that wraps every DOV bbox fetch
(debt #198). We verify the three behaviours every caller relies on:

- success → the coroutine's value is returned unchanged
- non-2xx (``httpx.HTTPStatusError``) → logged at ERROR, then re-raised
- network failure (``httpx.RequestError``) → logged at ERROR, then re-raised

The log label must appear in the emitted line so a multi-phase import stays
diagnosable from the log alone.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import httpx
import pytest

from groundmodel.application.dov_wfs_fetch import fetch_wfs_or_raise


async def _ok(value: object) -> object:
    """Return *value* from an awaitable, standing in for a successful fetch."""
    return value


async def _raise(exc: Exception) -> object:
    """Raise *exc* from an awaitable, standing in for a failed fetch."""
    raise exc


@pytest.mark.asyncio
async def test_returns_value_on_success() -> None:
    """A coroutine that resolves cleanly has its value returned untouched."""
    logger = MagicMock()
    sentinel = ["parsed", "rows"]

    result = await fetch_wfs_or_raise(_ok(sentinel), label="CPT", logger=logger)

    assert result is sentinel
    logger.error.assert_not_called()


@pytest.mark.asyncio
async def test_http_status_error_is_logged_with_label_and_reraised() -> None:
    """A non-2xx response logs the status + label, then propagates the error."""
    logger = MagicMock()
    request = httpx.Request("GET", "https://dov.example/wfs")
    response = httpx.Response(503, text="upstream unavailable", request=request)
    exc = httpx.HTTPStatusError("boom", request=request, response=response)

    with pytest.raises(httpx.HTTPStatusError):
        await fetch_wfs_or_raise(_raise(exc), label="sample", logger=logger)

    logger.error.assert_called_once()
    logged = logger.error.call_args.args[0]
    assert "sample" in logged
    assert "503" in logged


@pytest.mark.asyncio
async def test_request_error_is_logged_with_label_and_reraised() -> None:
    """A network-level failure logs the label + error type, then propagates."""
    logger = MagicMock()
    exc = httpx.ConnectError("connection refused")

    with pytest.raises(httpx.RequestError):
        await fetch_wfs_or_raise(_raise(exc), label="grain-size", logger=logger)

    logger.error.assert_called_once()
    logged = logger.error.call_args.args[0]
    assert "grain-size" in logged
    assert "ConnectError" in logged
