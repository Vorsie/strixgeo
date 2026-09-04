"""Server entrypoint — starts uvicorn on an event loop whose listener survives.

Why this module exists instead of calling ``uvicorn.exe`` directly
------------------------------------------------------------------
Observed 2026-08-02 during a live dogfeed session (owner's terminal)::

    ERROR    asyncio  Accept failed on a socket
    socket: <asyncio.TransportSocket fd=..., laddr=('127.0.0.1', 8765)>
    Traceback (most recent call last):
      File "asyncio\\windows_events.py", line ..., in finish_accept
    OSError: [WinError 64] The specified network name is no longer available

After that line the backend process kept running — logs, DB pool, everything —
while every connection to :8765 was refused. CPython's proactor loop explains
it exactly (``asyncio/proactor_events.py``,
``BaseProactorEventLoop._start_serving.loop``)::

    except OSError as exc:
        if sock.fileno() != -1:
            self._loop.call_exception_handler({... 'Accept failed on a socket' ...})
            sock.close()      # <-- and the accept is never re-armed

One transient accept error retires the listening socket permanently. The
selector loop does not have this failure mode:
``BaseSelectorEventLoop._accept_connection`` re-raises anything that is not an
fd-exhaustion errno ("The event loop will catch, log and ignore it") and leaves
the reader registered, so the next connection is accepted normally.

So on Windows the backend runs on a ``SelectorEventLoop``. That is safe for
this app: nothing here uses asyncio subprocesses (the DOV parse pool is a
``concurrent.futures.ProcessPoolExecutor``, driven through threads, which the
selector loop supports), and the desktop backend serves one local client, far
below the selector loop's 512-handle ceiling.

How the loop is actually pinned — and why the obvious way does NOT work
-----------------------------------------------------------------------
``asyncio.set_event_loop_policy(WindowsSelectorEventLoopPolicy())`` is INERT
here. Since uvicorn 0.36 the loop comes from ``Config.get_loop_factory()``
(``uvicorn/config.py``), which ``Server.run`` hands to ``asyncio.Runner`` as an
explicit ``loop_factory`` (``uvicorn/server.py:75`` → ``_compat.asyncio_run``);
a Runner with an explicit factory never consults the policy. Verified against
the installed uvicorn 0.46: with the policy set, ``Config(...)
.get_loop_factory()`` still returned ``asyncio.windows_events.ProactorEventLoop``
(``uvicorn/loops/asyncio.py::asyncio_loop_factory`` returns Proactor on win32
unless ``use_subprocess``).

The hook uvicorn does read is the ``loop`` setting: any value outside
``uvicorn.config.LOOP_FACTORIES`` is treated as an import string for a custom
zero-argument loop factory. :data:`SELECTOR_LOOP_FACTORY` points at
:func:`selector_event_loop` below, and :func:`build_config` sets it on Windows.
``tests/unit/api/test_serve_event_loop.py`` asserts the constructed LOOP, not a
platform predicate, so an inert fix cannot pass again.

The loud half: whatever loop the process ends up on (someone may still start
``uvicorn.exe`` by hand), an "Accept failed on a socket" context is logged at
CRITICAL with what it means, instead of asyncio's default ERROR line that reads
like a per-connection hiccup.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from groundmodel.shared.logging.logger_factory import LoggerFactory
from groundmodel.shared.timing import ms_since, process_uptime_ms

if TYPE_CHECKING:  # pragma: no cover - typing only
    import uvicorn

logger = LoggerFactory.get_logger(__name__)


def engine_uptime_ms() -> int:
    """Return milliseconds since the engine process started (startup timeline only).

    A thin, well-named alias over :func:`groundmodel.shared.timing.process_uptime_ms`
    so ``serve.main`` and ``api.main``'s lifespan report every startup phase
    against ONE clock. The anchor deliberately lives in ``shared.timing`` (a
    single ``sys.modules`` identity), not here: ``python -m groundmodel.api.serve``
    loads THIS module twice (as ``__main__`` and as ``groundmodel.api.serve``),
    so an anchor stored here would give the lifespan a later reference than
    ``serve.main`` and understate the boot total.

    Returns
    -------
    int
        Elapsed milliseconds since the process's first ``shared.timing`` import.
    """
    return process_uptime_ms()


# Defaults mirror what the Electron main process has always passed on the
# uvicorn command line, so running this module with no arguments produces the
# same server the desktop app expects.
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765

# The ASGI app this entrypoint serves.
APP_IMPORT_STRING = "groundmodel.api.main:app"

# Import string for the selector-loop factory below, handed to uvicorn as its
# ``loop`` setting on Windows.
SELECTOR_LOOP_FACTORY = "groundmodel.api.serve:selector_event_loop"

# asyncio's own wording for the failure this module exists to survive. Matched
# verbatim because it is the only marker in the exception context.
_ACCEPT_FAILED_MESSAGE = "Accept failed on a socket"


def selector_event_loop() -> asyncio.AbstractEventLoop:
    """Create the selector event loop uvicorn serves on (Windows).

    Referenced by import string through :data:`SELECTOR_LOOP_FACTORY`, because
    that is the only loop hook uvicorn reads — see the module docstring.

    Returns
    -------
    asyncio.AbstractEventLoop
        A fresh ``SelectorEventLoop`` with the accept-failure diagnostics
        already installed, so the CRITICAL line is armed from the first tick
        rather than only once the ASGI lifespan has run.
    """
    loop = asyncio.SelectorEventLoop()
    install_accept_failure_diagnostics(loop)
    return loop


def windows_selector_loop_needed(platform: str) -> bool:
    """Return True when this platform needs the selector-loop swap.

    Parameters
    ----------
    platform : str
        A ``sys.platform`` value.

    Returns
    -------
    bool
        True on Windows only — the proactor accept-failure path (see the module
        docstring) is Windows-specific; POSIX loops keep accepting.
    """
    return platform == "win32"


def build_config(
    host: str,
    port: int,
    *,
    access_log: bool,
    platform: str = sys.platform,
) -> uvicorn.Config:
    """Build the uvicorn config this entrypoint serves, with the loop pinned.

    Parameters
    ----------
    host : str
        Interface to bind.
    port : int
        TCP port to bind.
    access_log : bool
        Enable uvicorn's per-request access log.
    platform : str, optional
        A ``sys.platform`` value; injectable so the loop choice is testable off
        Windows. Defaults to the running platform.

    Returns
    -------
    uvicorn.Config
        A config whose ``get_loop_factory()`` returns a selector-loop factory on
        Windows, and uvicorn's own ``auto`` choice everywhere else.
    """
    import uvicorn

    # ``loop`` accepts an import string for a custom factory (Config.get_loop_factory
    # falls through to ``import_from_string(self.loop)`` for anything not in
    # uvicorn.config.LOOP_FACTORIES). This is the ONLY hook uvicorn reads — see the
    # module docstring on why the event-loop policy is not one.
    loop: str = SELECTOR_LOOP_FACTORY if windows_selector_loop_needed(platform) else "auto"
    return uvicorn.Config(
        APP_IMPORT_STRING,
        host=host,
        port=port,
        access_log=access_log,
        loop=loop,
    )


def install_accept_failure_diagnostics(loop: asyncio.AbstractEventLoop) -> None:
    """Make a listener-killing accept failure impossible to miss in the log.

    Wraps whatever exception handler the loop already has: an accept failure is
    re-logged at CRITICAL with its consequence spelled out, then the previous
    handler (or asyncio's default) still runs, so no other diagnostic is lost.

    Parameters
    ----------
    loop : asyncio.AbstractEventLoop
        The loop to instrument.
    """
    previous: Callable[[asyncio.AbstractEventLoop, dict[str, Any]], object] | None = (
        loop.get_exception_handler()
    )

    def handler(active_loop: asyncio.AbstractEventLoop, context: dict[str, Any]) -> None:
        if str(context.get("message", "")).startswith(_ACCEPT_FAILED_MESSAGE):
            exc = context.get("exception")
            logger.critical(
                "Accept failed on the API listening socket "
                f"({type(exc).__name__}: {exc}) — on a proactor event loop asyncio "
                "CLOSES the listener here and never re-arms it, so this process will "
                "keep running while refusing every connection. Restart the backend. "
                "If this appears on a selector loop, serving continues and this line "
                "is informational."
            )
        if previous is not None:
            previous(active_loop, context)
        else:
            active_loop.default_exception_handler(context)

    loop.set_exception_handler(handler)


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse the host/port arguments the desktop launcher passes.

    Parameters
    ----------
    argv : list[str] | None, optional
        Argument vector; defaults to ``sys.argv[1:]``.

    Returns
    -------
    argparse.Namespace
        Parsed ``host`` / ``port`` / ``access_log``.
    """
    parser = argparse.ArgumentParser(description="Run the Strix backend API.")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument(
        "--access-log",
        action="store_true",
        help="Enable uvicorn's per-request access log (off by default).",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    """Run the API server with the accept-safe event loop.

    Parameters
    ----------
    argv : list[str] | None, optional
        Argument vector; defaults to ``sys.argv[1:]``.
    """
    import uvicorn

    args = _parse_args(argv)
    logger.info(
        f"[engine-start 1/3] entrypoint reached (+{engine_uptime_ms()}ms since interpreter import)"
    )

    t_config = time.perf_counter()
    config = build_config(args.host, args.port, access_log=args.access_log)
    logger.info(f"[engine-start 2/3] uvicorn config built [{ms_since(t_config)}ms]")

    # Pre-import the ASGI app so the heavy engine + router import cost (numba,
    # llvmlite, polars, scipy, shapely, pyproj, geolib, ezdxf — all pulled in at
    # router registration) is measured as its OWN phase instead of vanishing
    # inside ``uvicorn.Server.run()``. The import is idempotent: uvicorn resolves
    # the same module from ``sys.modules`` a moment later at ~zero cost. On the
    # packaged interpreter this phase is the dominant share of the boot delay
    # (cold compiled extensions, read + AV-scanned on first touch).
    t_import = time.perf_counter()
    import groundmodel.api.main  # noqa: F401

    logger.info(
        f"[engine-start 3/3] API app + engine imported [{ms_since(t_import)}ms] "
        f"(+{engine_uptime_ms()}ms since interpreter import)"
    )

    logger.info(
        f"Starting API on {args.host}:{args.port} "
        f"(access_log={args.access_log}, loop={config.loop})"
    )
    uvicorn.Server(config).run()


if __name__ == "__main__":
    main()
