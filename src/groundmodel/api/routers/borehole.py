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
from groundmodel.infrastructure.db.repositories.borehole_repository import (
    LAB_TEST_RELATIONSHIPS,
    BoreholeRepository,
)
from groundmodel.infrastructure.db.repositories.geology_repository import (
    GeologyRepository,
)
from groundmodel.infrastructure.db.session import get_session
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


async def _borehole_dov_event_generator(
    request: ImportBoreholeDovRequest,
    session: AsyncSession,
) -> AsyncGenerator[str, None]:
    """Run a borehole DOV import and yield SSE-formatted progress events.

    Mirrors ``_cpt_dov_event_generator`` in ``cpt.py``.  Progress events
    carry the borehole-specific phases (``"interpretations"``,
    ``"samples"``) in addition to the shared phases.

    Event shapes:

    Progress tick:
        ``{"phase": "wfs"|"download"|"dedup"|"persist"|
                   "interpretations"|"samples"|"commit",
           "done": int, "total": int}``

    Completion:
        ``{"type": "done", "imported": int, "duplicates": int,
           "failed": int, "borehole_ids": [...],
           "interpretations_attached": int, ...}``

    Error:
        ``{"type": "error", "message": str}``

    Parameters
    ----------
    request : ImportBoreholeDovRequest
        Bounding box + optional project_id.
    session : AsyncSession
        DB session injected by the route; shared with the import task.

    Yields
    ------
    str
        SSE-formatted event frames ending with a double newline.
    """
    queue: asyncio.Queue[dict | None] = asyncio.Queue()

    async def progress_cb(phase: str, done: int, total: int) -> None:
        await queue.put({"phase": phase, "done": done, "total": total})

    async def run_import() -> None:
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
            logger.warning(f"DOV borehole stream connect error: {type(exc).__name__}: {exc}")
            await queue.put(
                {"type": "error", "message": "Cannot reach DOV — check your internet connection"}
            )
        except httpx.HTTPStatusError as exc:
            logger.warning(
                f"DOV borehole stream upstream {exc.response.status_code}: "
                f"{type(exc).__name__}: {exc}"
            )
            await queue.put(
                {"type": "error", "message": f"DOV returned HTTP {exc.response.status_code}"}
            )
        except httpx.RequestError as exc:
            logger.warning(f"DOV borehole stream request error: {type(exc).__name__}: {exc}")
            await queue.put({"type": "error", "message": "DOV request failed"})
        except Exception as exc:  # noqa: BLE001
            logger.error(f"DOV borehole stream unexpected error: {type(exc).__name__}: {exc}")
            await queue.put({"type": "error", "message": "Import failed unexpectedly"})
        finally:
            await queue.put(None)

    task = asyncio.create_task(run_import())
    try:
        while True:
            event = await queue.get()
            if event is None:
                break
            yield f"data: {json.dumps(event)}\n\n"
    finally:
        task.cancel()


@router.post("/import-dov/stream")
async def import_borehole_dov_stream(
    request: ImportBoreholeDovRequest,
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    """Stream borehole DOV import progress as Server-Sent Events.

    Identical import semantics to ``POST /borehole/import-dov`` — same
    atomic-commit contract, same error handling.  Progress events
    include the borehole-specific ``"interpretations"`` and
    ``"samples"`` phases in addition to the shared phases.

    The client should close the connection after receiving the terminal
    ``{"type": "done", ...}`` or ``{"type": "error", ...}`` event.

    Parameters
    ----------
    request : ImportBoreholeDovRequest
        Bounding box (west, south, east, north) + optional project_id.
    session : AsyncSession
        Database session, injected.

    Returns
    -------
    StreamingResponse
        ``Content-Type: text/event-stream`` response.
    """
    return StreamingResponse(
        _borehole_dov_event_generator(request, session),
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
        When no borehole with that id exists.
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
    )
    if borehole is None:
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

    Raises
    ------
    HTTPException(404)
        When no borehole with the given id exists.
    """
    logger.info(
        f"PATCH /borehole/{borehole_id}/elevation: "
        f"elevation_m={request.elevation_m} z_epsg={request.z_epsg}"
    )
    repo = BoreholeRepository(session)
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
