"""FastAPI application entry point."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from sqlalchemy import text

from groundmodel.api.routers import (
    borehole,
    cpt,
    cross_section,
    dem,
    geology,
    investigation_review,
    jobs,
    project,
)
from groundmodel.infrastructure.db.session import engine
from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)

# Seconds to wait for the boot-time DB probe before declaring it
# unreachable. Short enough that a real outage doesn't delay app
# startup, long enough that a slow-but-up Postgres still passes.
_DB_PROBE_TIMEOUT_SECONDS = 5.0


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
    """FastAPI lifespan — runs the DB probe before serving requests."""
    await _probe_database()
    yield


app = FastAPI(title="Ground Model Platform", version="0.1.0", lifespan=lifespan)

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
