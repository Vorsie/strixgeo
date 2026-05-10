"""FastAPI application entry point."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from groundmodel.api.routers import borehole, cpt, jobs, project
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

# The API only ever binds to 127.0.0.1 and is accessed exclusively by the
# local Electron renderer (Vite dev server at localhost:5173 in dev, file://
# origin in production).  Allowing all origins is safe here — there is no
# internet exposure.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(cpt.router)
app.include_router(borehole.router, prefix="/borehole", tags=["borehole"])
app.include_router(jobs.router)
app.include_router(project.router)
