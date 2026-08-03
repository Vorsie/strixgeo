"""The backend must not keep running with a dead listener.

Observed 2026-08-02 (owner's terminal, live dogfeed): asyncio logged
``Accept failed on a socket`` with ``OSError [WinError 64] The specified
network name is no longer available`` from
``asyncio/windows_events.py`` → ``finish_accept``. Afterwards the uvicorn
process was still alive and healthy-looking while every connection to :8765
was refused.

CPython 3.11 source, ``asyncio/proactor_events.py``
``BaseProactorEventLoop._start_serving.loop``:

    except OSError as exc:
        if sock.fileno() != -1:
            self._loop.call_exception_handler({... 'Accept failed on a socket' ...})
            sock.close()          # <- and NO re-arm

The proactor loop CLOSES the listening socket and never accepts again. The
selector loop's ``BaseSelectorEventLoop._accept_connection`` re-raises the same
class of OSError ("The event loop will catch, log and ignore it") and leaves
the reader registered, so serving continues.

Two rules:

* on Windows the backend runs on a selector event loop, so a transient accept
  error cannot retire the listener;
* whatever loop it ends up on, an accept failure is CRITICAL and says what it
  means — a silent listener is the worst possible failure mode.
"""

from __future__ import annotations

import asyncio
import logging

from groundmodel.api.serve import (
    build_config,
    install_accept_failure_diagnostics,
    windows_selector_loop_needed,
)


def test_windows_needs_the_selector_loop_and_posix_does_not() -> None:
    """The loop swap is Windows-only — POSIX's default loop never had the bug."""
    assert windows_selector_loop_needed("win32") is True
    assert windows_selector_loop_needed("linux") is False
    assert windows_selector_loop_needed("darwin") is False


def test_the_config_the_entrypoint_builds_actually_yields_a_selector_loop() -> None:
    """On Windows the loop uvicorn WILL construct is a selector loop, not a proactor one.

    This asserts the loop, not a predicate: uvicorn ≥ 0.36 picks its loop through
    ``Config.get_loop_factory()`` and never consults the event-loop policy, so a
    ``set_event_loop_policy`` call is inert and a predicate test cannot see that.
    """
    factory = build_config("127.0.0.1", 8799, access_log=False, platform="win32").get_loop_factory()
    assert factory is not None
    loop = factory()
    try:
        assert isinstance(loop, asyncio.SelectorEventLoop), (
            f"uvicorn would run on {type(loop).__name__}; a proactor loop retires "
            "its listener on the first accept error"
        )
    finally:
        loop.close()


def test_posix_keeps_uvicorns_own_loop_choice() -> None:
    """Off Windows we take no position — uvicorn's ``auto`` may pick uvloop."""
    config = build_config("127.0.0.1", 8799, access_log=False, platform="linux")
    assert config.loop == "auto"


def test_an_accept_failure_is_logged_as_critical_and_says_the_listener_is_dead(
    caplog: logging.LogCaptureFixture,
) -> None:
    """The 'Accept failed on a socket' context is upgraded to a self-diagnosing CRITICAL."""
    loop = asyncio.new_event_loop()
    try:
        install_accept_failure_diagnostics(loop)
        with caplog.at_level(logging.CRITICAL):
            loop.call_exception_handler(
                {
                    "message": "Accept failed on a socket",
                    "exception": OSError(64, "The specified network name is no longer available"),
                }
            )
    finally:
        loop.close()

    critical = [r for r in caplog.records if r.levelno >= logging.CRITICAL]
    assert critical, "an accept failure must not be logged below CRITICAL"
    text = critical[0].getMessage().lower()
    # The message has to name the consequence, not just echo asyncio's phrase:
    # the reader of this line must know connections are being refused.
    assert "accept" in text
    assert "restart" in text or "refus" in text


def test_an_unrelated_loop_error_still_reaches_the_default_handler() -> None:
    """The custom handler chains: it must not swallow every other loop error."""
    loop = asyncio.new_event_loop()
    seen: list[dict[str, object]] = []
    try:
        loop.set_exception_handler(lambda _loop, ctx: seen.append(ctx))
        install_accept_failure_diagnostics(loop)
        loop.call_exception_handler({"message": "Task exception was never retrieved"})
    finally:
        loop.close()

    assert len(seen) == 1
    assert seen[0]["message"] == "Task exception was never retrieved"
