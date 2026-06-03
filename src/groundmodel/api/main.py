"""FastAPI application entry point."""

import asyncio
from collections.abc import AsyncIterator
from concurrent.futures import ProcessPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from sqlalchemy import select, text
from starlette.responses import PlainTextResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from groundmodel.api.routers import (
    borehole,
    codelists,
    cpt,
    cross_section,
    dem,
    geology,
    investigation_review,
    jobs,
    project,
    virtuele_boring,
)
from groundmodel.application.resolve_litho_instances_use_case import (
    ResolveLithoInstances,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.session import AsyncSessionFactory, engine
from groundmodel.shared.constants.model_kind import MODEL_KIND_LITHOSTRATIGRAPHIC
from groundmodel.shared.logging.logger_factory import LoggerFactory

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
    try:
        async with asyncio.timeout(_DB_PROBE_TIMEOUT_SECONDS):
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
        logger.success("PostgreSQL reachable on boot")
    except Exception as exc:  # noqa: BLE001 — we want every failure path to surface the same hint
        logger.error(
            f"PostgreSQL unreachable on boot: {type(exc).__name__}: {exc}. "
            "Is the docker compose stack up? Try: docker compose up -d"
        )


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """FastAPI lifespan — starts the parse pool, runs the DB probe, tears down cleanly.

    A ``ProcessPoolExecutor`` is started here and stored on ``_app.state.parse_pool``
    so the DOV CPT router can access it via ``request.app.state.parse_pool``.
    The pool is shut down gracefully (``wait=True``) on application exit so
    in-flight parse tasks complete before the process exits.
    """
    # Pre-import the worker module in the main process so the pickled
    # function reference is resolvable when the child processes start.
    import groundmodel.infrastructure.parsers.cpt.dov.dov_parse_worker  # noqa: F401

    pool = ProcessPoolExecutor(max_workers=4)
    _app.state.parse_pool = pool
    logger.info("DOV parse pool started (max_workers=4)")

    await _probe_database()
    await _sweep_stale_bodies()
    try:
        yield
    finally:
        pool.shutdown(wait=True)
        logger.info("DOV parse pool shut down")


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


app = FastAPI(title="Ground Model Platform", version="0.1.0", lifespan=lifespan)
app.add_middleware(BodySizeLimitMiddleware, max_bytes=_MAX_BODY_BYTES)

# The API binds to 127.0.0.1 only; the threat model that matters is NOT
# network exposure (we have none) but cross-origin reads from other browser
# tabs the user opens while Strix runs. With ``allow_origins=["*"]`` and no
# auth, ``evil.com`` open in any tab could ``fetch("http://127.0.0.1:8765/
# projects/")`` and exfiltrate every CPT/borehole geometry the user has
# imported (often NDA / defence-adjacent per the privacy framing in
# CLAUDE.md "Distribution model"). Pin to the Electron renderer's origins:
#  * dev: vite serves the renderer on localhost:5173 (electron-vite default)
#  * prod: BrowserWindow ``loadFile()`` serves from file://, which fetch
#    reports as ``Origin: null`` per the file-scheme rules
# A wildcard regex covers any random port vite picks if 5173 is taken.
_ALLOWED_ORIGINS = ["null"]
_ALLOWED_ORIGIN_REGEX = r"^http://localhost(?::\d+)?$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_origin_regex=_ALLOWED_ORIGIN_REGEX,
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

app.include_router(cpt.router)
app.include_router(borehole.router, prefix="/borehole", tags=["borehole"])
app.include_router(jobs.router)
app.include_router(project.router)
app.include_router(geology.router)
app.include_router(cross_section.router)
app.include_router(investigation_review.router)
app.include_router(dem.router)
app.include_router(codelists.router)
app.include_router(virtuele_boring.catalog_router)
app.include_router(virtuele_boring.project_router)
