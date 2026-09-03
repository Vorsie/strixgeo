"""UE — a 500 stays readable in the renderer, without loosening the CORS pin.

Starlette's ``ServerErrorMiddleware`` sits outside ``CORSMiddleware``, so an
exception that escapes a route used to answer 500 with no
``Access-Control-Allow-Origin`` header. The browser then refuses to surface it:
the owner's 2026-08-15 dogfeed reported a body-partition race on
``POST .../contact-correlations`` as *"No 'Access-Control-Allow-Origin' header
is present"* — a CORS message for something that was not a CORS problem.

UE-1/UE-2 pin that an allowed origin now gets the header back on a 500.
UE-3/UE-4 pin the other half, which is security-relevant: the error path must
NOT reflect an origin the real CORS policy rejects (debt #35's whole point is
that another browser tab must not read this loopback API).
"""

from __future__ import annotations

import json

import pytest
from starlette.requests import Request

from groundmodel.api.unhandled_error_handler import make_unhandled_error_handler

_ALLOWED_ORIGINS = ["null"]
_ALLOWED_ORIGIN_REGEX = r"^http://localhost(?::\d+)?$"


def _request(origin: str | None) -> Request:
    """Build a minimal ASGI request carrying (or omitting) an ``Origin`` header."""
    headers: list[tuple[bytes, bytes]] = []
    if origin is not None:
        headers.append((b"origin", origin.encode()))
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/projects/x/geology/models/y/contact-correlations",
            "headers": headers,
            "query_string": b"",
        }
    )


async def _answer(origin: str | None) -> tuple[int, str | None]:
    """Run the handler over a raised exception and return (status, allow-origin)."""
    handler = make_unhandled_error_handler(
        allowed_origins=_ALLOWED_ORIGINS,
        allowed_origin_regex=_ALLOWED_ORIGIN_REGEX,
    )
    try:
        raise RuntimeError("deadlock detected")
    except RuntimeError as exc:
        response = await handler(_request(origin), exc)
    return response.status_code, response.headers.get("access-control-allow-origin")


@pytest.mark.asyncio
async def test_ue1_the_packaged_file_origin_can_read_the_500() -> None:
    """UE-1 — a ``file://`` renderer (Origin: null) gets the error, not a CORS wall."""
    status, allow_origin = await _answer("null")
    assert status == 500, f"UE-1 FAIL: the error must stay a 500, got {status}"
    assert allow_origin == "null", (
        "UE-1 FAIL: the packaged renderer could not read its own 500 — "
        f"Access-Control-Allow-Origin was {allow_origin!r}"
    )


@pytest.mark.asyncio
async def test_ue2_the_dev_renderer_origin_can_read_the_500() -> None:
    """UE-2 — the vite dev origin on any port gets the error too."""
    status, allow_origin = await _answer("http://localhost:5174")
    assert status == 500
    assert allow_origin == "http://localhost:5174", (
        f"UE-2 FAIL: dev renderer got Access-Control-Allow-Origin {allow_origin!r}"
    )


@pytest.mark.asyncio
async def test_ue3_a_foreign_origin_is_never_reflected_on_the_error_path() -> None:
    """UE-3 — the 500 must not become a hole in the origin pin (debt #35)."""
    _, allow_origin = await _answer("https://evil.example")
    assert allow_origin is None, (
        "UE-3 FAIL: the error path reflected a foreign origin "
        f"({allow_origin!r}) — another browser tab could read our errors"
    )


@pytest.mark.asyncio
async def test_ue4_a_lookalike_origin_is_not_matched_by_prefix() -> None:
    """UE-4 — ``localhost.evil.example`` is not ``localhost``."""
    _, allow_origin = await _answer("http://localhost.evil.example")
    assert allow_origin is None, f"UE-4 FAIL: a lookalike origin was reflected ({allow_origin!r})"


# ---------------------------------------------------------------------------
# M3 — lock/statement-timeout errors map to a clean 409, not a raw 500
# ---------------------------------------------------------------------------
from uuid import uuid4  # noqa: E402

from groundmodel.shared.exceptions import BodyPartitionContentionError  # noqa: E402


class _FakeAsyncpgLockError(Exception):
    """asyncpg-shaped error carrying the lock-timeout SQLSTATE (55P03)."""

    sqlstate = "55P03"


class _FakeDBAPIError(Exception):
    """SQLAlchemy-shaped wrapper whose ``.orig`` is the asyncpg error."""

    def __init__(self) -> None:
        super().__init__("canceling statement due to lock timeout")
        self.orig = _FakeAsyncpgLockError()


async def _handle(exc: Exception, origin: str | None) -> tuple[int, dict | str, str | None]:
    """Run the handler over *exc* and return (status, detail, allow-origin)."""
    handler = make_unhandled_error_handler(
        allowed_origins=_ALLOWED_ORIGINS,
        allowed_origin_regex=_ALLOWED_ORIGIN_REGEX,
    )
    import json

    response = await handler(_request(origin), exc)
    body = json.loads(bytes(response.body))
    return (
        response.status_code,
        body["detail"],
        response.headers.get("access-control-allow-origin"),
    )


@pytest.mark.asyncio
async def test_ue5_lock_timeout_error_maps_to_409() -> None:
    """A 55P03 lock-timeout surfaced through SQLAlchemy answers 409, not 500.

    Rule (M3): with lock_timeout set on the session, a lock wait aborts with
    asyncpg's LockNotAvailableError instead of hanging — the handler turns that
    into a clean 409 with a machine-readable code.
    """
    status, detail, _ = await _handle(_FakeDBAPIError(), "null")
    assert status == 409
    assert detail["code"] == "lock_timeout"


@pytest.mark.asyncio
async def test_ue6_body_partition_contention_maps_to_409_naming_operation() -> None:
    """A body-partition contention answers 409 and names the waiting operation."""
    model_id = uuid4()
    exc = BodyPartitionContentionError("bodies/recompute", model_id)
    status, detail, _ = await _handle(exc, "null")
    assert status == 409
    assert detail["code"] == "body_partition_locked"
    assert "bodies/recompute" in detail["message"]


@pytest.mark.asyncio
async def test_ue7_the_409_still_carries_cors_for_an_allowed_origin() -> None:
    """The 409 error path keeps the CORS header so the renderer can read it."""
    _, _, allow_origin = await _handle(_FakeDBAPIError(), "null")
    assert allow_origin == "null"


@pytest.mark.asyncio
async def test_ue8_unrelated_error_still_500() -> None:
    """A non-lock error is unchanged — still a 500 with the internal_error code."""
    status, detail, _ = await _handle(RuntimeError("boom"), "null")
    assert status == 500
    assert detail["code"] == "internal_error"


@pytest.mark.asyncio
async def test_ue9_the_500_message_does_not_falsely_promise_the_action_was_not_applied() -> None:
    """UE-9 (L12) — the handler runs AFTER a route may already have committed.

    A raise from the response serialiser, or any error after ``session.commit``,
    still reaches this handler; telling the user "the action was not applied" is
    then simply false. The message must instead say it may or may not have been
    applied and tell them to reload the project to see the true state.
    """
    handler = make_unhandled_error_handler(
        allowed_origins=_ALLOWED_ORIGINS,
        allowed_origin_regex=_ALLOWED_ORIGIN_REGEX,
    )
    try:
        raise RuntimeError("commit succeeded, then the response serializer raised")
    except RuntimeError as exc:
        response = await handler(_request("null"), exc)
    message = json.loads(bytes(response.body))["detail"]["message"].lower()
    assert "reload" in message, f"UE-9 FAIL: message does not tell the user to reload: {message!r}"
    assert "may or may not have been applied" in message, (
        f"UE-9 FAIL: message does not admit the uncertain outcome: {message!r}"
    )
    assert "was not applied" not in message, (
        f"UE-9 FAIL: the false absolute promise is still present: {message!r}"
    )


@pytest.mark.asyncio
async def test_ue10_a_localhost_origin_is_not_reflected_when_no_regex_is_configured() -> None:
    """UE-10 — in production the dev-server regex is ``None``; localhost is not echoed.

    The production app builds ``CORSMiddleware`` with no localhost regex; the
    500 handler is passed the same ``None`` and must not reflect a localhost
    origin it would otherwise have matched in development.
    """
    handler = make_unhandled_error_handler(
        allowed_origins=_ALLOWED_ORIGINS,
        allowed_origin_regex=None,
    )
    try:
        raise RuntimeError("boom")
    except RuntimeError as exc:
        response = await handler(_request("http://localhost:5173"), exc)
    assert response.headers.get("access-control-allow-origin") is None
    # ``null`` (the packaged renderer) is still reflected via the exact allowlist.
    try:
        raise RuntimeError("boom")
    except RuntimeError as exc:
        response = await handler(_request("null"), exc)
    assert response.headers.get("access-control-allow-origin") == "null"
