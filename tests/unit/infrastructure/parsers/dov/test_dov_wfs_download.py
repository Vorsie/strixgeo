"""Unit tests for ``parallel_download_and_process``.

The helper is shared by three DOV download clients (boring,
interpretation, grain-size). The tests stub the ``httpx.AsyncClient`` +
``DovXmlCache`` boundaries so the helper's logic — cache hits, write-
through, error funnelling, progress accounting — can be verified
without hitting the network or the filesystem.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx
import pytest

from groundmodel.infrastructure.parsers.dov.dov_wfs_download import (
    parallel_download_and_process,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# ---------------------------------------------------------------------------
# Test doubles
# ---------------------------------------------------------------------------


@dataclass
class _Row:
    permkey: str
    xml_url: str
    test_id: str


class _FakeCache:
    """Minimal DovXmlCache-shaped stub kept under the test's eye.

    Real ``DovXmlCache`` writes through to disk; this stub keeps the
    map in memory so cache hits / misses are deterministic and the test
    can inspect post-conditions (e.g. "the bytes were written through
    on miss").
    """

    def __init__(self, seeded: dict[str, bytes] | None = None) -> None:
        self._store: dict[str, bytes] = dict(seeded or {})
        self.puts: list[tuple[str, bytes]] = []

    def get(self, permkey: str) -> bytes | None:
        return self._store.get(permkey)

    def put(self, permkey: str, payload: bytes) -> None:
        self._store[permkey] = payload
        self.puts.append((permkey, payload))


class _FakeResponse:
    def __init__(self, status: int, body: bytes) -> None:
        self.status_code = status
        self.content = body
        self.text = body.decode("latin-1", errors="replace")

    @property
    def is_success(self) -> bool:
        return 200 <= self.status_code < 300

    def raise_for_status(self) -> None:
        if not self.is_success:
            raise httpx.HTTPStatusError(
                f"HTTP {self.status_code}",
                request=httpx.Request("GET", "https://example.invalid"),
                response=httpx.Response(self.status_code),
            )


class _FakeHttp:
    """``httpx.AsyncClient``-shaped stub with scripted per-URL responses.

    ``responses`` maps URL → response builder. A builder may be a static
    ``_FakeResponse`` OR a callable raising an exception (to simulate
    network errors).
    """

    def __init__(self, responses: dict[str, Any]) -> None:
        self._responses = responses
        self.calls: list[str] = []

    async def get(self, url: str) -> _FakeResponse:
        self.calls.append(url)
        item = self._responses.get(url)
        if item is None:
            raise httpx.HTTPError(f"no scripted response for {url}")
        if callable(item):
            item()  # raises by contract
            raise AssertionError("scripted callable must raise")
        return item


def _logger() -> GroundModelLogger:
    return GroundModelLogger("tests.dov_wfs_download")


# ---------------------------------------------------------------------------
# Cases
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_empty_rows_returns_empty_without_logging() -> None:
    http = _FakeHttp({})
    out = await parallel_download_and_process(
        http=http,  # type: ignore[arg-type]
        cache=None,
        rows=[],
        xml_url_of=lambda r: r.xml_url,
        permkey_of=lambda r: r.permkey,
        process=lambda r, b: b,
        label="DOV test",
        logger=_logger(),
    )
    assert out == []
    assert http.calls == []


@pytest.mark.asyncio
async def test_cache_hit_skips_network_and_marks_progress() -> None:
    rows = [_Row(permkey="p1", xml_url="u1", test_id="t1")]
    cache = _FakeCache(seeded={"p1": b"<xml/>"})
    http = _FakeHttp({})

    out = await parallel_download_and_process(
        http=http,  # type: ignore[arg-type]
        cache=cache,  # type: ignore[arg-type]
        rows=rows,
        xml_url_of=lambda r: r.xml_url,
        permkey_of=lambda r: r.permkey,
        process=lambda r, b: (r.test_id, len(b)),
        label="DOV test",
        logger=_logger(),
    )

    assert out == [(rows[0], ("t1", 6))]
    assert http.calls == []
    assert cache.puts == []  # no write-through on hit


@pytest.mark.asyncio
async def test_cache_miss_fetches_and_writes_through() -> None:
    rows = [_Row(permkey="p1", xml_url="u1", test_id="t1")]
    cache = _FakeCache()
    http = _FakeHttp({"u1": _FakeResponse(200, b"<xml/>")})

    out = await parallel_download_and_process(
        http=http,  # type: ignore[arg-type]
        cache=cache,  # type: ignore[arg-type]
        rows=rows,
        xml_url_of=lambda r: r.xml_url,
        permkey_of=lambda r: r.permkey,
        process=lambda r, b: len(b),
        label="DOV test",
        logger=_logger(),
    )

    assert out == [(rows[0], 6)]
    assert http.calls == ["u1"]
    assert cache.puts == [("p1", b"<xml/>")]


@pytest.mark.asyncio
async def test_no_cache_still_works() -> None:
    rows = [_Row(permkey="p1", xml_url="u1", test_id="t1")]
    http = _FakeHttp({"u1": _FakeResponse(200, b"<xml/>")})

    out = await parallel_download_and_process(
        http=http,  # type: ignore[arg-type]
        cache=None,
        rows=rows,
        xml_url_of=lambda r: r.xml_url,
        permkey_of=lambda r: r.permkey,
        process=lambda r, b: b,
        label="DOV test",
        logger=_logger(),
    )

    assert out == [(rows[0], b"<xml/>")]
    assert http.calls == ["u1"]


@pytest.mark.asyncio
async def test_http_error_is_caught_per_row_others_survive() -> None:
    rows = [
        _Row(permkey="p1", xml_url="u1", test_id="ok"),
        _Row(permkey="p2", xml_url="u2", test_id="bad"),
        _Row(permkey="p3", xml_url="u3", test_id="ok2"),
    ]
    http = _FakeHttp(
        {
            "u1": _FakeResponse(200, b"A"),
            "u2": _FakeResponse(500, b"boom"),
            "u3": _FakeResponse(200, b"C"),
        }
    )

    out = await parallel_download_and_process(
        http=http,  # type: ignore[arg-type]
        cache=None,
        rows=rows,
        xml_url_of=lambda r: r.xml_url,
        permkey_of=lambda r: r.permkey,
        process=lambda r, b: b,
        label="DOV test",
        logger=_logger(),
    )

    # The middle row failed; only the bookends survive, in source order.
    assert out == [(rows[0], b"A"), (rows[2], b"C")]


@pytest.mark.asyncio
async def test_process_exception_is_caught_per_row() -> None:
    rows = [
        _Row(permkey="p1", xml_url="u1", test_id="ok"),
        _Row(permkey="p2", xml_url="u2", test_id="bad"),
    ]
    http = _FakeHttp(
        {
            "u1": _FakeResponse(200, b"good"),
            "u2": _FakeResponse(200, b"good"),
        }
    )

    def proc(row: _Row, xml: bytes) -> bytes:
        if row.test_id == "bad":
            raise ValueError("parse blew up")
        return xml

    out = await parallel_download_and_process(
        http=http,  # type: ignore[arg-type]
        cache=None,
        rows=rows,
        xml_url_of=lambda r: r.xml_url,
        permkey_of=lambda r: r.permkey,
        process=proc,
        label="DOV test",
        logger=_logger(),
    )

    assert out == [(rows[0], b"good")]


@pytest.mark.asyncio
async def test_network_error_logged_with_error_id_of_blurb(
    caplog: pytest.LogCaptureFixture,
) -> None:
    rows = [_Row(permkey="p1", xml_url="u1", test_id="t1")]

    def boom() -> None:
        raise httpx.ConnectError("connection refused")

    http = _FakeHttp({"u1": boom})

    with caplog.at_level("ERROR"):
        out = await parallel_download_and_process(
            http=http,  # type: ignore[arg-type]
            cache=None,
            rows=rows,
            xml_url_of=lambda r: r.xml_url,
            permkey_of=lambda r: r.permkey,
            process=lambda r, b: b,
            label="DOV test",
            logger=_logger(),
            error_id_of=lambda r: f"row-{r.test_id}",
        )

    assert out == []
    # The supplied error_id_of blurb lands in the log.
    assert any("row-t1" in rec.message for rec in caplog.records)


@pytest.mark.asyncio
async def test_default_error_id_falls_back_to_permkey(
    caplog: pytest.LogCaptureFixture,
) -> None:
    rows = [_Row(permkey="permkey-A", xml_url="u1", test_id="ignored")]
    http = _FakeHttp({"u1": _FakeResponse(404, b"missing")})

    with caplog.at_level("ERROR"):
        out = await parallel_download_and_process(
            http=http,  # type: ignore[arg-type]
            cache=None,
            rows=rows,
            xml_url_of=lambda r: r.xml_url,
            permkey_of=lambda r: r.permkey,
            process=lambda r, b: b,
            label="DOV test",
            logger=_logger(),
        )

    assert out == []
    assert any("permkey-A" in rec.message for rec in caplog.records)


@pytest.mark.asyncio
async def test_mixed_cache_hit_and_miss_progress_split() -> None:
    rows = [
        _Row(permkey="p1", xml_url="u1", test_id="t1"),
        _Row(permkey="p2", xml_url="u2", test_id="t2"),
        _Row(permkey="p3", xml_url="u3", test_id="t3"),
    ]
    cache = _FakeCache(seeded={"p1": b"cached-1", "p3": b"cached-3"})
    http = _FakeHttp({"u2": _FakeResponse(200, b"net-2")})

    out = await parallel_download_and_process(
        http=http,  # type: ignore[arg-type]
        cache=cache,  # type: ignore[arg-type]
        rows=rows,
        xml_url_of=lambda r: r.xml_url,
        permkey_of=lambda r: r.permkey,
        process=lambda r, b: b,
        label="DOV test",
        logger=_logger(),
    )

    assert out == [
        (rows[0], b"cached-1"),
        (rows[1], b"net-2"),
        (rows[2], b"cached-3"),
    ]
    # Only the miss hit the network and only the miss was written through.
    assert http.calls == ["u2"]
    assert cache.puts == [("p2", b"net-2")]
