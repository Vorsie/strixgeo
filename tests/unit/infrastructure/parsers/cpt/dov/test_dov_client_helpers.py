"""Unit tests for pure helpers in ``dov_client``.

``_classify_download_failure`` maps a per-CPT download/parse exception to a
human-readable failure class for the operator log. The three categories map to
three different operator fixes (retry the endpoint / reduce parallelism /
investigate the XML), so the classification must not silently collapse them.
"""

from __future__ import annotations

from concurrent.futures.process import BrokenProcessPool

import httpx
import pytest

from groundmodel.infrastructure.parsers.cpt.dov.dov_client import (
    _classify_download_failure,
)


@pytest.mark.parametrize(
    "exc, expected",
    [
        # httpx.RequestError family → network.
        (httpx.ConnectError("connection refused"), "network/HTTP download failed"),
        (httpx.RequestError("generic transport error"), "network/HTTP download failed"),
        # HTTPStatusError (non-2xx) → also network/HTTP.
        (
            httpx.HTTPStatusError(
                "500",
                request=httpx.Request("GET", "https://dov/x"),
                response=httpx.Response(500, request=httpx.Request("GET", "https://dov/x")),
            ),
            "network/HTTP download failed",
        ),
        # A crashed parse-pool worker → pool category.
        (BrokenProcessPool("a worker died"), "parse-pool worker crashed"),
        # Anything else (a malformed XML raising in the parser) → parse category.
        (ValueError("unexpected tag"), "XML parse/processing failed"),
        (KeyError("qc"), "XML parse/processing failed"),
    ],
)
def test_classify_download_failure(exc: BaseException, expected: str) -> None:
    """Each failure class maps to its distinct operator-facing label."""
    assert _classify_download_failure(exc) == expected
