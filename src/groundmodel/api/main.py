"""FastAPI application entry point."""

import asyncio
import multiprocessing
import os
import time
from collections.abc import AsyncIterator
from concurrent.futures import ProcessPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from sqlalchemy import select, text
from starlette.responses import PlainTextResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from groundmodel.api.boot_migration import run_boot_migration
from groundmodel.api.heavy_library_warmup import start_background_warmup
from groundmodel.api.local_client_token_middleware import LocalClientTokenMiddleware
from groundmodel.api.routers import (
    bed_override,
    borehole,
    borehole_pdf,
    borehole_tracks,
    codelists,
    cpt,
    cpt_pdf,
    cross_section,
    dem,
    geology,
    investigation_review,
    lab_series,
    project,
    stratigraphy_lumping,
    virtuele_boring,
)
from groundmodel.api.serve import engine_uptime_ms, install_accept_failure_diagnostics
from groundmodel.api.unhandled_error_handler import make_unhandled_error_handler
from groundmodel.api.validation_error_handler import validation_error_handler
from groundmodel.application.resolve_litho_instances_use_case import (
    ResolveLithoInstances,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.session import AsyncSessionFactory, engine
from groundmodel.shared.config import settings
from groundmodel.shared.constants.model_kind import MODEL_KIND_LITHOSTRATIGRAPHIC
from groundmodel.shared.logging.logger_factory import LoggerFactory
from groundmodel.shared.parent_watchdog import start_parent_watchdog
from groundmodel.shared.timing import ms_since

logger = LoggerFactory.get_logger(__name__)

# Seconds to wait for the boot-time DB probe before declaring it
# unreachable. Short enough that a real outage doesn't delay app
# startup, long enough that a slow-but-up Postgres still passes.
_DB_PROBE_TIMEOUT_SECONDS = 5.0


async def _sweep_stale_bodies() -> None:
    """Reconcile ``BodyOrm`` rows across every litho model on boot.

    Runs ``ResolveLithoInstances`` per litho model so body rows stay in sync
    with the correlation graph (the resolver creates one body per connected
    component, stamps ``litho_layer.body_id``, and orphan-deletes unnamed
    bodies whose component disappeared).

    Why the resolver ONLY — no ``DetectBodies`` here
    -------------------------------------------------
    Body **extents** (the left/right wedge geometry) are section-scoped (2D):
    ``DetectBodies`` closes each side to the nearest target along an ACTIVE
    section.  The boot sweep has no active section, so running it here would
    re-derive extents with the geometry-free UUID fallback and silently
    overwrite the nearest-target extents the user committed on a section —
    a restart would re-break a fixed section (dogfeed 2026-06-03).  Extents
    persist in the DB; only the interactive ``POST .../bodies/detect`` (which
    carries the active ``section_id``) sets or reconciles them.

    Each model runs in its own commit so a single bad model doesn't abort
    the rest.  Failures are logged but never block startup.
    """
    swept_models = 0
    try:
        async with AsyncSessionFactory() as session:
            litho_model_ids = list(
                (
                    await session.execute(
                        select(GeologicalModelOrm.id, GeologicalModelOrm.app_project_id).where(
                            GeologicalModelOrm.kind == MODEL_KIND_LITHOSTRATIGRAPHIC,
                        )
                    )
                ).all()
            )
            for row in litho_model_ids:
                model_id = row.id
                project_id = row.app_project_id
                try:
                    await ResolveLithoInstances(session).execute(
                        model_id=model_id,
                        commit=False,
                    )
                    await session.commit()
                    swept_models += 1
                except Exception as model_exc:  # noqa: BLE001
                    await session.rollback()
                    logger.warning(
                        f"startup body sweep: model {model_id} (project {project_id}) "
                        f"failed — {type(model_exc).__name__}: {model_exc}; continuing"
                    )
        if swept_models == 0:
            logger.info("startup body sweep: no lithostratigraphic models — nothing to do")
        else:
            logger.success(f"startup body sweep: resolved {swept_models} litho model(s)")
    except Exception as exc:  # noqa: BLE001
        # A connection failure is the most common cause; the DB probe
        # above already logs an actionable hint.  Don't double-log the
        # whole traceback here — startup must continue either way.
        logger.warning(f"startup body sweep skipped: {type(exc).__name__}: {exc}")


async def _probe_database() -> None:
    """Try a single ``SELECT 1`` against the configured DB.

    Logs SUCCESS when reachable; logs ERROR with a hint when not.
    Deliberately does NOT raise — startup completes either way so the
    Electron client (which polls /openapi.json) doesn't hang on the
    waitForApi loop. The next request that touches the DB will surface
    the connection error in its own response.

    The most common cause is the docker compose stack being down; the
    log message names that path explicitly so the user doesn't have to
    parse the full asyncpg traceback (which routes through SSL setup
    even when SSL isn't configured, and reads as scary).
    """
    # Name the ACTUAL database (host:port/dbname, password stripped) so a
    # wrong-DB connection is obvious in the very first log line. The 2026-06-25
    # incident — an orphaned reseed backend bound to the app port talking to
    # ``groundmodel_integration`` instead of ``groundmodel`` — would have been a
    # 30-second diagnosis with this line instead of an evening of forensics.
    url = engine.url
    db_target = f"{url.host}:{url.port}/{url.database}"
    try:
        async with asyncio.timeout(_DB_PROBE_TIMEOUT_SECONDS):
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
        logger.success(f"PostgreSQL reachable on boot — connected to {db_target!r}")
    except Exception as exc:  # noqa: BLE001 — we want every failure path to surface the same hint
        logger.error(
            f"PostgreSQL unreachable on boot ({db_target!r}): {type(exc).__name__}: {exc}. "
            "Is the docker compose stack up? Try: docker compose up -d"
        )


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """FastAPI lifespan — starts the parse pool, runs the DB probe, tears down cleanly.

    A ``ProcessPoolExecutor`` is started here and stored on ``_app.state.parse_pool``
    so the DOV CPT router can access it via ``request.app.state.parse_pool``.
    Each worker is initialised with a parent watchdog so it self-exits if this
    engine ever dies (see the pool construction below). On application exit the
    pool is shut down with ``wait=False, cancel_futures=True`` so a clean stop
    never blocks on an in-flight parse and the workers get their shutdown signal.

    Also instruments the running loop so a listener-killing accept failure is
    CRITICAL rather than a stray asyncio ERROR — see ``api/serve.py``. Done
    here as well as in the entrypoint because a backend started by hand
    (``uvicorn.exe``, the e2e harness, a dev shell) never runs ``serve.main``
    and would otherwise lose its listener silently.
    """
    # Phase-timed so a packaged boot log shows where the seconds go between the
    # engine import finishing and /openapi.json answering (owner report,
    # installer #12). Each line carries the phase's own elapsed ms plus the
    # running total since the engine module was imported (see api/serve.py).
    logger.info(
        f"[engine-boot 1/6] lifespan begin (+{engine_uptime_ms()}ms since interpreter import)"
    )
    install_accept_failure_diagnostics(asyncio.get_running_loop())

    # Bring the database to schema head IN THIS PROCESS before anything touches
    # it. In the packaged app the launcher no longer runs a separate migrate.py
    # child — the engine's cold import overlapped the Postgres boot, and now the
    # engine waits for the server and migrates itself here (see
    # ``api/boot_migration.py``). A no-op in dev / CI / e2e (the env flag is
    # absent), where migrations run externally. Must precede the boot DB probe
    # below — the first lifespan DB connect — so the schema is at head first.
    _t = time.perf_counter()
    migrated = await run_boot_migration()
    logger.info(
        f"[engine-boot 2/6] engine-side DB migration "
        f"{'complete' if migrated else 'skipped (external/dev)'} [{ms_since(_t)}ms]"
    )

    # Pre-import the worker module in the main process so the worker function
    # reference resolves by module path when the child processes start.
    _t = time.perf_counter()
    import groundmodel.infrastructure.parsers.cpt.dov.dov_parse_worker  # noqa: F401

    logger.info(f"[engine-boot 3/6] DOV parse worker module imported [{ms_since(_t)}ms]")

    # Explicit spawn context: on Linux the default is fork, and forking a
    # threaded parent (uvicorn runs worker threads; polars/numba hold module
    # locks) can hand the child a mutex locked by a thread that does not
    # exist post-fork — the child deadlocks and pool.shutdown() joins
    # forever. Observed on the first Linux CI run (faulthandler dump, run
    # 33115778146). Windows only has spawn, so behaviour there is unchanged.
    #
    # ProcessPoolExecutor is LAZY: constructing it spawns NO worker processes
    # (measured ~1ms, 0 children) — the four workers warm up only on the first
    # parse task submitted (the first DOV import). So this is not a boot cost,
    # and there is no eager-spawn win to be had here.
    #
    # initializer=start_parent_watchdog(engine_pid): every worker, the moment it
    # DOES spawn, starts a daemon thread watching this engine process and exits
    # by itself if the engine is ever gone (crash, or a desktop tree-kill that
    # misses it). The engine's own pid is captured HERE, in the parent, and
    # passed down through initargs — the second layer behind
    # desktop/src/main/shutdownSequencer.ts, so a stranded worker can never keep
    # holding files in the install folder ("StrixGeo is nog actief", owner
    # 2026-09-06).
    _t = time.perf_counter()
    pool = ProcessPoolExecutor(
        max_workers=4,
        mp_context=multiprocessing.get_context("spawn"),
        initializer=start_parent_watchdog,
        initargs=(os.getpid(),),
    )
    _app.state.parse_pool = pool
    logger.info(
        f"[engine-boot 4/6] DOV parse pool created (max_workers=4, spawn, lazy) [{ms_since(_t)}ms]"
    )

    _t = time.perf_counter()
    await _probe_database()
    logger.info(f"[engine-boot 5/6] first DB connect (probe) [{ms_since(_t)}ms]")

    _t = time.perf_counter()
    await _sweep_stale_bodies()
    logger.info(f"[engine-boot 6/6] startup body sweep [{ms_since(_t)}ms]")

    logger.success(
        f"engine READY — /openapi.json answers now "
        f"(+{engine_uptime_ms()}ms since interpreter import)"
    )

    # READY is logged FIRST, above — the warm-up must never delay readiness. Now
    # that the app is serving, warm the heavy export/compute libraries (numba +
    # llvmlite, geolib, ezdxf, scipy) and compile the greedy-mesh Numba kernel on
    # a background daemon thread, so the FIRST export / voxel Build pays neither
    # their import nor the JIT (owner, 2026-09-04). Skipped when
    # STRIXGEO_SKIP_WARMUP=1 (the test suite + the e2e harness). Boot itself still
    # imports none of them — the imports live inside the warm-up steps.
    start_background_warmup()

    try:
        yield
    finally:
        # wait=False + cancel_futures=True: a clean stop must not block on an
        # in-flight DOV parse (the desktop only gives the whole tree ~2 s before
        # it force-kills it), and cancelling the queued futures lets the idle
        # workers take their shutdown sentinel and exit. Combined with the
        # per-worker parent watchdog above, a worker that somehow misses this
        # signal still self-exits once this engine is gone.
        pool.shutdown(wait=False, cancel_futures=True)
        logger.info("DOV parse pool shut down (wait=False, cancel_futures=True)")


# Max bytes any single request body may carry. 256 MiB is well above
# typical project sizes (a 500-CPT DOV-bbox import lands at a few MB
# per CLAUDE.md "DOV Import"); below this the per-array Pydantic
# ``max_length`` caps in ``ProjectBundleRequest`` defend against the
# next layer (10⁷ entry list inside a fits-the-envelope body). Above
# this the middleware returns 413 before any buffering kicks in.
# Debt #38.
_MAX_BODY_BYTES = 256 * 1024 * 1024


class BodySizeLimitMiddleware:
    """ASGI middleware that rejects requests whose body exceeds a cap.

    Pre-buffer check uses the ``Content-Length`` header (every browser
    + httpx + the Electron renderer set it on POST bodies). Streaming
    check tracks bytes across ``http.request`` events so a chunked-
    encoding upload that omits Content-Length still gets capped.

    Returns 413 ``Payload Too Large`` on overflow.
    """

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """ASGI entry: pass non-HTTP scopes through, cap the body of HTTP ones.

        Parameters
        ----------
        scope : Scope
            ASGI connection scope.
        receive : Receive
            ASGI receive callable, wrapped to count body bytes.
        send : Send
            ASGI send callable.
        """
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        # 1. Pre-buffer Content-Length check — rejects oversized
        #    requests before we read a single byte.
        for header_name, header_value in scope.get("headers", []):
            if header_name == b"content-length":
                try:
                    declared = int(header_value)
                except ValueError:
                    break
                if declared > self.max_bytes:
                    await PlainTextResponse("Request body too large", status_code=413)(
                        scope, receive, send
                    )
                    return
                break
        # 2. Streaming guard — tracks actual bytes across body chunks
        #    in case Content-Length was absent (chunked transfer
        #    encoding) or lied. We wrap ``receive`` so the app under
        #    test still gets its body normally on the happy path.
        received_bytes = 0
        overflowed = False

        async def guarded_receive() -> Message:
            nonlocal received_bytes, overflowed
            message = await receive()
            if message["type"] == "http.request":
                body = message.get("body", b"")
                received_bytes += len(body)
                if received_bytes > self.max_bytes:
                    overflowed = True
                    # Drain the rest so the client doesn't hang on a
                    # half-consumed body, then signal end of stream.
                    return {"type": "http.request", "body": b"", "more_body": False}
            return message

        async def guarded_send(message: Message) -> None:
            # If we've overflowed, suppress the app's normal response
            # and emit 413 instead. The app will write its response
            # after our guarded_receive returns end-of-stream; we
            # short-circuit it here.
            if overflowed:
                return
            await send(message)

        await self.app(scope, guarded_receive, guarded_send)
        if overflowed:
            await PlainTextResponse("Request body too large", status_code=413)(scope, receive, send)


# The API binds to 127.0.0.1 only; the threat model that matters is NOT
# network exposure (we have none) but cross-origin reads from other browser
# tabs the user opens while Strix runs. With ``allow_origins=["*"]`` and no
# auth, ``evil.com`` open in any tab could ``fetch("http://127.0.0.1:8765/
# projects/")`` and exfiltrate every CPT/borehole geometry the user has
# imported (often NDA / defence-adjacent per the privacy framing in
# CLAUDE.md "Distribution model"). Pin to the Electron renderer's origins:
#  * prod: BrowserWindow ``loadFile()`` serves from file://, which fetch
#    reports as ``Origin: null`` per the file-scheme rules — allowed in EVERY
#    environment because it is the packaged renderer's own origin.
#  * dev: vite serves the renderer on localhost:5173 (electron-vite default);
#    a wildcard regex covers any random port vite picks if 5173 is taken. This
#    is a DEVELOPMENT-ONLY allowance — a packaged build has no dev server, and
#    echoing ``http://localhost:<port>`` there would let a local web server
#    read the loopback API. See ``_cors_origin_regex_for``.
#
# Neither origin is trustworthy on its own — ``"null"`` is sent by any
# sandboxed iframe / ``data:`` document, and a bare ``http://localhost:<port>``
# by any local page. LocalClientTokenMiddleware makes both allowances safe: a
# request carrying ANY Origin must present the token the Electron main process
# minted for this launch (injected on both the packaged and the dev renderer's
# requests), so a hostile page can claim an origin but cannot prove it.
_ALLOWED_ORIGINS = ["null"]
_DEV_ALLOWED_ORIGIN_REGEX = r"^http://localhost(?::\d+)?$"


def _cors_origin_regex_for(environment: str) -> str | None:
    """Return the localhost CORS origin regex in development, ``None`` otherwise.

    The Vite dev-server origin only exists while ``npm run dev`` is running; a
    packaged build (``ENVIRONMENT=production``) serves the renderer from
    ``file://`` and never needs it. Allowing localhost in production would let
    any local web server read the loopback API, so the regex is gated on the
    same development check the docs and SECRET_KEY validator use.

    Parameters
    ----------
    environment : str
        A deployment-environment token, e.g. ``settings.environment``.

    Returns
    -------
    str | None
        The dev-server origin regex in development; ``None`` in any other
        environment.
    """
    return _DEV_ALLOWED_ORIGIN_REGEX if environment == "development" else None


def _docs_enabled_for(environment: str) -> bool:
    """Return whether the interactive API docs should be served.

    The interactive Swagger UI (``/docs``) and ReDoc (``/redoc``) are a
    developer convenience with no place in a shipped installer, so they are
    served ONLY in local development. Any non-development environment
    (``"production"`` — injected as ``ENVIRONMENT=production`` by the Electron
    main process for a packaged build — ``"staging"``, a packaged coworker
    binary) turns them off. ``/openapi.json`` is unaffected: it stays at its
    FastAPI default so the desktop client's ``waitForApi`` poll keeps working
    in every environment.

    This mirrors the ``environment == "development"`` dev/non-dev split the
    SECRET_KEY validator uses (see ``groundmodel.shared.config.Settings``).

    Parameters
    ----------
    environment : str
        A deployment-environment token, e.g. ``settings.environment``.

    Returns
    -------
    bool
        True only when ``environment`` is exactly ``"development"``.
    """
    return environment == "development"


def create_app(environment: str | None = None) -> FastAPI:
    """Build the FastAPI application, gating the interactive docs on environment.

    Constructed via a factory (rather than a bare module-level ``FastAPI(...)``)
    so the docs-off behaviour is testable in both environments in-process — a
    module-level singleton is fixed to whatever ``settings.environment`` held at
    import time and cannot exercise the other branch.

    Parameters
    ----------
    environment : str | None, optional
        The deployment environment used to decide whether the interactive docs
        are served. Defaults to ``settings.environment`` (the real runtime
        value); injectable so tests can exercise the production and development
        branches without re-importing the module.

    Returns
    -------
    FastAPI
        A fully wired app: body-size + local-client-token + CORS + trusted-host
        middleware, the validation/unhandled-error handlers, and every router.
        ``/docs`` and ``/redoc`` are present only in development; ``/openapi.json``
        is always present.
    """
    env = settings.environment if environment is None else environment
    docs_enabled = _docs_enabled_for(env)
    # Localhost (the Vite dev server) is a development-only CORS allowance; in a
    # packaged build only the renderer's ``null`` origin is accepted. The same
    # value feeds CORSMiddleware and the 500 handler so the error path can never
    # echo an origin the real CORS policy rejects.
    cors_origin_regex = _cors_origin_regex_for(env)

    app = FastAPI(
        title="StrixGeo",
        version="0.1.0",
        lifespan=lifespan,
        # openapi_url is left at its FastAPI default ("/openapi.json") so the
        # Electron client's readiness poll keeps working in production; only
        # the interactive UIs are gated.
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
    )
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=_MAX_BODY_BYTES)

    # Installed BEFORE CORSMiddleware, which means it runs INSIDE it: preflight
    # ``OPTIONS`` requests are answered by CORS and never reach the token check
    # (blocking a preflight would stop the real request from being sent without
    # protecting anything). See the class docstring for the threat model.
    app.add_middleware(LocalClientTokenMiddleware)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=_ALLOWED_ORIGINS,
        allow_origin_regex=cors_origin_regex,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # DNS-rebinding defence: binding to 127.0.0.1 doesn't help when a malicious
    # DNS record (set up by a page the user visits) resolves
    # ``some-host.example`` to 127.0.0.1. The browser would then send
    # ``Host: some-host.example`` to our API, and CORSMiddleware's
    # same-origin-by-Host trick wouldn't catch it. TrustedHostMiddleware
    # rejects everything except documented loopback names.
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=["127.0.0.1", "localhost"],
    )

    # Replaces FastAPI's default 422 handler, which cannot render an echo that
    # contains NaN/inf — see ``validation_error_handler`` for why that turned a
    # correctly-rejected body into a 500.
    app.add_exception_handler(RequestValidationError, validation_error_handler)

    # Starlette's ServerErrorMiddleware sits OUTSIDE CORSMiddleware, so an
    # escaped exception answers 500 with no CORS headers and the renderer
    # console reports it as a CORS failure rather than as the server error it is
    # (owner dogfeed 2026-08-15). Registering our own ``Exception`` handler lets
    # that 500 carry the same pinned origins the middleware would have allowed.
    # The exception is still logged with its traceback and the status is still
    # 500 — only the reporting changes.
    app.add_exception_handler(
        Exception,
        make_unhandled_error_handler(
            allowed_origins=_ALLOWED_ORIGINS,
            allowed_origin_regex=cors_origin_regex,
        ),
    )

    # Before cpt.router: /cpt/pdf/... must never be read as /cpt/{cpt_id}.
    app.include_router(cpt_pdf.router)
    app.include_router(cpt.router)
    # Before borehole.router: /borehole/pdf/... must never be read as
    # /borehole/{borehole_id}.
    app.include_router(borehole_pdf.router)
    app.include_router(borehole.router, prefix="/borehole", tags=["borehole"])
    # Hand-edited tracks (owner 2026-09-29) - own module, same /borehole prefix.
    app.include_router(borehole_tracks.router, prefix="/borehole", tags=["borehole"])
    app.include_router(project.router)
    app.include_router(geology.router)
    app.include_router(cross_section.router)
    app.include_router(bed_override.router)
    app.include_router(investigation_review.router)
    app.include_router(lab_series.router)
    app.include_router(stratigraphy_lumping.router)
    app.include_router(dem.router)
    app.include_router(codelists.router)
    app.include_router(virtuele_boring.catalog_router)
    app.include_router(virtuele_boring.project_router)

    return app


# Module-level app served by ``groundmodel.api.main:app`` (uvicorn import
# string, the e2e harness, and every unit test). Uses the real runtime
# ``settings.environment``.
app = create_app()
