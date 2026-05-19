"""Borehole API route handlers."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.schemas.borehole.borehole_detail_response import (
    BoreholeDetailResponse,
)
from groundmodel.api.schemas.borehole.borehole_list_item import BoreholeListItem
from groundmodel.api.schemas.borehole.import_borehole_dov_request import (
    ImportBoreholeDovRequest,
)
from groundmodel.api.schemas.borehole.import_borehole_dov_response import (
    ImportBoreholeDovResponse,
)
from groundmodel.api.schemas.elevation_patch_request import ElevationPatchRequest
from groundmodel.application.import_borehole_dov import ImportBoreholeDov
from groundmodel.application.job_registry import JobRegistry, get_job_registry
from groundmodel.infrastructure.db.repositories.borehole_repository import (
    LAB_TEST_RELATIONSHIPS,
    BoreholeRepository,
)
from groundmodel.infrastructure.db.repositories.geology_repository import (
    GeologyRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory, get_session
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Friendly URL aliases for the ``?include=`` query param. The URL form
# uses the short / domain-natural name (``grain_size``); the value is
# the ORM relationship attribute name the repository expects. Adding a
# typed lab-test family means appending one entry here AND one to
# ``LAB_TEST_RELATIONSHIPS`` in the repository.
LAB_TEST_INCLUDE_ALIASES: dict[str, str] = {
    "grain_size": "grain_sizes",
    "atterberg": "atterberg_limits_tests",
    "caco3": "caco3_content_tests",
    "organic": "organic_content_tests",
    "water_content": "water_content_tests",
    "scalar": "scalar_lab_tests",
}

# Module-level logger — routers are stateless functions, not classes.
# See CLAUDE.md § Code Conventions for the rationale.
logger = LoggerFactory.get_logger(__name__)

router = APIRouter()


@router.post("/import-dov", response_model=ImportBoreholeDovResponse)
async def import_borehole_dov(
    request: ImportBoreholeDovRequest,
    session: AsyncSession = Depends(get_session),
) -> ImportBoreholeDovResponse:
    """Import boreholes from DOV within a WGS84 bounding box.

    Mirrors the CPT-side ``POST /cpt/import-dov`` endpoint exactly: same
    request shape, same upstream-error → HTTP-status mapping, same
    "imported / duplicates / failed + ids" response.

    Parameters
    ----------
    request:
        Bounding box (west, south, east, north in decimal degrees) and an
        optional ``project_id``. The backend queries the DOV WFS for the
        ``dov-pub:Boringen`` layer, downloads every borehole's XML in
        parallel (with persistent on-disk cache), parses it, and persists
        the row to the project.

    Returns
    -------
    ImportBoreholeDovResponse
        Counts of imported / duplicate / failed boreholes plus all
        borehole IDs the project now sees (new + pre-existing).

    Raises
    ------
    HTTPException(503)
        DOV unreachable (DNS / connection refused / no network).
    HTTPException(504)
        DOV did not respond within the timeout.
    HTTPException(502)
        DOV returned an unexpected response (4xx / 5xx from upstream).
    """
    try:
        result = await ImportBoreholeDov(session).execute(
            west=request.west,
            south=request.south,
            east=request.east,
            north=request.north,
            app_project_id=request.project_id,
        )
    # Same hardening as the CPT DOV path — library class names +
    # exception messages stay server-side; user-facing detail carries
    # only the category + (when safe) the upstream HTTP status.
    # Debt #43.
    except httpx.TimeoutException as exc:
        logger.warning(f"DOV import timeout: {type(exc).__name__}: {exc}")
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="DOV did not respond in time",
        ) from exc
    except httpx.ConnectError as exc:
        logger.warning(f"DOV import connect error: {type(exc).__name__}: {exc}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cannot reach DOV — check your internet connection",
        ) from exc
    except httpx.HTTPStatusError as exc:
        logger.warning(
            f"DOV import upstream {exc.response.status_code}: {type(exc).__name__}: {exc}",
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"DOV returned HTTP {exc.response.status_code}",
        ) from exc
    except httpx.RequestError as exc:
        logger.warning(f"DOV import request error: {type(exc).__name__}: {exc}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="DOV request failed",
        ) from exc

    return ImportBoreholeDovResponse(
        imported=result.imported,
        duplicates=result.duplicates,
        failed=result.failed,
        interpretations_attached=result.interpretations_attached,
        interpretations_failed=result.interpretations_failed,
        samples_attached=result.samples_attached,
        samples_failed=result.samples_failed,
        grain_sizes_attached=result.grain_sizes_attached,
        grain_sizes_failed=result.grain_sizes_failed,
        atterberg_attached=result.atterberg_attached,
        atterberg_failed=result.atterberg_failed,
        caco3_attached=result.caco3_attached,
        caco3_failed=result.caco3_failed,
        organic_attached=result.organic_attached,
        organic_failed=result.organic_failed,
        water_content_attached=result.water_content_attached,
        water_content_failed=result.water_content_failed,
        scalar_lab_tests_attached=result.scalar_lab_tests_attached,
        scalar_lab_tests_failed=result.scalar_lab_tests_failed,
        borehole_ids=result.borehole_ids,
    )


def _make_borehole_dov_import_coro(
    request: ImportBoreholeDovRequest,
) -> AsyncGenerator[asyncio.Queue[dict | None], None]:
    """Return a coroutine-factory for the borehole DOV import background task.

    Mirrors ``_make_cpt_dov_import_coro`` in ``cpt.py``.  The factory
    accepts an ``asyncio.Queue`` and returns a coroutine that creates
    its own ``AsyncSession``, runs the import, and puts events + a
    terminal ``None`` sentinel on the queue.

    Parameters
    ----------
    request : ImportBoreholeDovRequest
        Bounding box + optional project_id.

    Returns
    -------
    Callable[[asyncio.Queue], Coroutine[None]]
        Factory suitable for ``JobRegistry.start``.
    """

    def factory(queue: asyncio.Queue) -> object:  # -> Coroutine
        async def run_import() -> None:
            async def progress_cb(phase: str, done: int, total: int) -> None:
                await queue.put({"phase": phase, "done": done, "total": total})

            async with AsyncSessionFactory() as session:
                try:
                    result = await ImportBoreholeDov(session).execute(
                        west=request.west,
                        south=request.south,
                        east=request.east,
                        north=request.north,
                        app_project_id=request.project_id,
                        progress_cb=progress_cb,
                    )
                    await queue.put(
                        {
                            "type": "done",
                            "imported": result.imported,
                            "duplicates": result.duplicates,
                            "failed": result.failed,
                            "borehole_ids": [str(bid) for bid in result.borehole_ids],
                            "interpretations_attached": result.interpretations_attached,
                            "interpretations_failed": result.interpretations_failed,
                            "samples_attached": result.samples_attached,
                            "samples_failed": result.samples_failed,
                            "grain_sizes_attached": result.grain_sizes_attached,
                            "grain_sizes_failed": result.grain_sizes_failed,
                            "atterberg_attached": result.atterberg_attached,
                            "atterberg_failed": result.atterberg_failed,
                            "caco3_attached": result.caco3_attached,
                            "caco3_failed": result.caco3_failed,
                            "organic_attached": result.organic_attached,
                            "organic_failed": result.organic_failed,
                            "water_content_attached": result.water_content_attached,
                            "water_content_failed": result.water_content_failed,
                            "scalar_lab_tests_attached": result.scalar_lab_tests_attached,
                            "scalar_lab_tests_failed": result.scalar_lab_tests_failed,
                        }
                    )
                except httpx.TimeoutException as exc:
                    logger.warning(f"DOV borehole stream timeout: {type(exc).__name__}: {exc}")
                    await queue.put({"type": "error", "message": "DOV did not respond in time"})
                except httpx.ConnectError as exc:
                    logger.warning(
                        f"DOV borehole stream connect error: {type(exc).__name__}: {exc}"
                    )
                    await queue.put(
                        {
                            "type": "error",
                            "message": "Cannot reach DOV — check your internet connection",
                        }
                    )
                except httpx.HTTPStatusError as exc:
                    logger.warning(
                        f"DOV borehole stream upstream {exc.response.status_code}: "
                        f"{type(exc).__name__}: {exc}"
                    )
                    await queue.put(
                        {
                            "type": "error",
                            "message": f"DOV returned HTTP {exc.response.status_code}",
                        }
                    )
                except httpx.RequestError as exc:
                    logger.warning(
                        f"DOV borehole stream request error: {type(exc).__name__}: {exc}"
                    )
                    await queue.put({"type": "error", "message": "DOV request failed"})
                except Exception as exc:  # noqa: BLE001
                    logger.error(
                        f"DOV borehole stream unexpected error: {type(exc).__name__}: {exc}"
                    )
                    await queue.put({"type": "error", "message": "Import failed unexpectedly"})
                finally:
                    await queue.put(None)

        return run_import()

    return factory  # type: ignore[return-value]


async def _borehole_sse_from_registry(
    job_id: UUID,
    registry: JobRegistry,
) -> AsyncGenerator[str, None]:
    """Drain a borehole job's event queue as SSE-formatted frames.

    Parameters
    ----------
    job_id : UUID
        Job-id registered by ``POST /borehole/import-dov/stream``.
    registry : JobRegistry
        The shared in-process job registry.

    Yields
    ------
    str
        SSE frames ``data: <json>\\n\\n``.
    """
    async for event in registry.stream(job_id):
        yield f"data: {json.dumps(event)}\n\n"


@router.post("/import-dov/stream", status_code=status.HTTP_202_ACCEPTED)
async def import_borehole_dov_stream(
    request: ImportBoreholeDovRequest,
    registry: JobRegistry = Depends(get_job_registry),
) -> dict:
    """Spawn a borehole DOV import as a background task and return its job-id.

    Mirrors ``POST /cpt/import-dov/stream``.  The import runs in its own
    ``asyncio.Task`` with an independent ``AsyncSession`` so the spawning
    request completes immediately with ``202 Accepted``.  Connect to
    ``GET /borehole/import-dov/stream/{job_id}`` to receive the SSE stream.

    Parameters
    ----------
    request : ImportBoreholeDovRequest
        Bounding box + optional project_id.
    registry : JobRegistry
        In-process job registry, injected.

    Returns
    -------
    dict
        ``{"job_id": "<uuid>"}``
    """
    factory = _make_borehole_dov_import_coro(request)
    job_id = registry.start(factory)
    logger.info(f"DOV borehole import job {job_id} spawned")
    return {"job_id": str(job_id)}


@router.get("/import-dov/stream/{job_id}")
async def get_borehole_dov_stream(
    job_id: UUID,
    registry: JobRegistry = Depends(get_job_registry),
) -> StreamingResponse:
    """Drain the SSE event queue for a running borehole DOV import job.

    Parameters
    ----------
    job_id : UUID
        Job-id returned by ``POST /borehole/import-dov/stream``.
    registry : JobRegistry
        In-process job registry, injected.

    Returns
    -------
    StreamingResponse
        ``Content-Type: text/event-stream``.

    Raises
    ------
    HTTPException(404)
        When no job with that id is registered.
    """
    if job_id not in registry._jobs:  # noqa: SLF001
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No active import job with id {job_id}",
        )
    return StreamingResponse(
        _borehole_sse_from_registry(job_id, registry),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/", response_model=list[BoreholeListItem])
async def list_boreholes(
    project_id: str | None = None,
    session: AsyncSession = Depends(get_session),
) -> list[BoreholeListItem]:
    """Return a lightweight summary list of boreholes.

    Mirrors the CPT-side ``GET /cpt/`` endpoint exactly. Only header columns
    + denormalised counts are included so the desktop app can render the
    sidebar list + map markers from a single call without firing one
    ``GET /borehole/{id}`` per row.

    Parameters
    ----------
    project_id:
        When provided, only return boreholes belonging to this app-level
        project UUID. When absent, return all boreholes (used by tests
        and admin tools — production frontend always passes a project_id).
    session:
        Database session injected by FastAPI dependency injection.

    Raises
    ------
    HTTPException(400)
        When ``project_id`` is provided but isn't a parseable UUID.
    """
    app_project_uuid: UUID | None = None
    if project_id:
        try:
            app_project_uuid = UUID(project_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid project_id: {project_id!r}",
            )

    repo = BoreholeRepository(session)
    boreholes = await repo.list_all(app_project_uuid)
    # Pydantic ``from_attributes=True`` config on BoreholeListItem maps the
    # ORM columns by name — no manual field forwarding needed.
    return [BoreholeListItem.model_validate(b) for b in boreholes]


@router.get("/{borehole_id}", response_model=BoreholeDetailResponse)
async def get_borehole(
    borehole_id: UUID,
    project_id: UUID,
    include: str | None = Query(
        None,
        description=(
            "Comma-separated lab-test families to load on each sample. "
            "Omitting the parameter loads every family (the original "
            "always-load behaviour). Valid values: "
            "``grain_size``, ``atterberg``, ``caco3``, ``organic``, "
            "``water_content``, ``scalar``. Unrequested families come "
            "back as empty lists, NOT omitted keys — the response "
            "shape is unchanged so clients keep working unmodified "
            "(debt #2)."
        ),
    ),
    session: AsyncSession = Depends(get_session),
) -> BoreholeDetailResponse:
    """Retrieve full borehole detail (header + drill segments + field log + observations).

    Default (no ``?include=``) returns the full tree — preserves the
    pre-debt-#2 behaviour. Pass ``?include=grain_size,atterberg`` to
    skip the four unrequested lab-test families' SELECT queries; the
    JSON shape stays the same (skipped families render as ``[]``).

    Parameters
    ----------
    borehole_id : UUID
        Primary key of the borehole record.
    project_id : UUID
        Required project scope guard — the borehole must belong to this
        project (VULN-6).
    include : str | None
        Comma-separated lab-test family aliases — see the ``Query``
        description above. Whitespace around entries is tolerated.

    Returns
    -------
    BoreholeDetailResponse
        Full borehole tree, with observations sorted by observation_date
        and layers sorted by ``layer_index`` (per the ORM ``order_by``).

    Raises
    ------
    HTTPException(400)
        When ``include`` contains an alias that isn't in
        ``LAB_TEST_INCLUDE_ALIASES``.
    HTTPException(404)
        When no borehole with that id exists, or it belongs to a different project.
    """
    include_relationships: list[str] | None = None
    if include is not None:
        aliases = [token.strip() for token in include.split(",") if token.strip()]
        unknown = [a for a in aliases if a not in LAB_TEST_INCLUDE_ALIASES]
        if unknown:
            valid = sorted(LAB_TEST_INCLUDE_ALIASES.keys())
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(f"Unknown include value(s): {unknown!r}. Valid: {valid!r}"),
            )
        include_relationships = [LAB_TEST_INCLUDE_ALIASES[a] for a in aliases]
        logger.debug(
            f"GET /borehole/{borehole_id} include={aliases} "
            f"(→ relationships {include_relationships})"
        )

    repo = BoreholeRepository(session)
    borehole = await repo.get_by_id(
        borehole_id,
        include_lab_tests=include_relationships,
        app_project_id=project_id,
    )
    # Scope guard: the project predicate is fused into the fetch above
    # (M1), so a cross-project id already returns None here. The explicit
    # check is kept as cheap defence-in-depth (VULN-6).
    if borehole is None or borehole.app_project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Borehole {borehole_id} not found",
        )
    # Sanity check — the relationship-stamping path SHOULD have populated
    # every excluded family with ``[]``. If a future refactor breaks the
    # stamping, ``model_validate`` would silently lazy-load and crash
    # under async with ``MissingGreenlet``; assertively reading the
    # relationships keeps the failure mode loud.
    assert sorted(LAB_TEST_INCLUDE_ALIASES.values()) == sorted(LAB_TEST_RELATIONSHIPS), (
        "Router aliases drifted from repository relationships — update both lists together."
    )
    return BoreholeDetailResponse.model_validate(borehole)


@router.patch("/{borehole_id}/elevation", response_model=BoreholeListItem)
async def patch_borehole_elevation(
    borehole_id: UUID,
    project_id: UUID,
    request: ElevationPatchRequest,
    session: AsyncSession = Depends(get_session),
) -> BoreholeListItem:
    """Update the manually-entered surface elevation for a borehole.

    Mirrors ``PATCH /cpt/{id}/elevation``. The desktop frontend's Phase 3a
    ``ElevationEditor`` calls this when the user fills in the missing Z for
    a DOV row that came in without one. Setting ``elevation_m`` to ``null``
    clears the value so the user can undo a typo.

    Returns the lightweight ``BoreholeListItem`` shape (rather than the full
    detail tree) since the frontend only needs the header columns to refresh
    its sidebar list and badge state. The detail-cache entry can be patched
    in place client-side without re-fetching the heavy children.

    Parameters
    ----------
    borehole_id : UUID
        Primary key of the borehole record.
    project_id : UUID
        Required project scope guard (VULN-7).

    Raises
    ------
    HTTPException(404)
        When no borehole with the given id exists, or it belongs to a different project.
    """
    logger.info(
        f"PATCH /borehole/{borehole_id}/elevation: "
        f"elevation_m={request.elevation_m} z_epsg={request.z_epsg}"
    )
    repo = BoreholeRepository(session)
    # Scope guard before any mutation: reject cross-project ids (VULN-7).
    await get_in_project_or_404(
        repo.get_by_id(borehole_id),
        project_id,
        detail=f"Borehole {borehole_id} not found",
    )
    # The repository derives the canonical vertical CRS from the row's
    # horizontal EPSG when ``z_epsg`` is None — see ``vertical_crs.py``
    # for the table. Belgian DOV imports map to mTAW; future Dutch BRO
    # imports map to NAP without further router changes.
    borehole = await repo.set_elevation(borehole_id, request.elevation_m, request.z_epsg)
    if borehole is None:
        logger.warning(f"PATCH /borehole/{borehole_id}/elevation → 404 (not found)")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Borehole {borehole_id} not found",
        )
    # Debt #34: changing this borehole's elevation shifts the absolute z
    # of every contact anchored here (z = elevation_m − depth_top_m), so
    # flip the dependent TIN surfaces stale in the same transaction —
    # otherwise the viewer keeps rendering the old geometry as fresh.
    flipped = await GeologyRepository(session).stale_surfaces_for_investigation(
        borehole_id=borehole_id
    )
    if flipped:
        logger.info(
            f"PATCH /borehole/{borehole_id}/elevation: staled {flipped} dependent surface(s)"
        )
    await session.commit()
    return BoreholeListItem.model_validate(borehole)
