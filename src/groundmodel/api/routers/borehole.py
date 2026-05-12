"""Borehole API route handlers."""

from __future__ import annotations

from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
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
    BoreholeRepository,
)
from groundmodel.infrastructure.db.session import get_session

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
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"DOV did not respond in time ({exc.__class__.__name__})",
        ) from exc
    except httpx.ConnectError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cannot reach DOV — check your internet connection",
        ) from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"DOV returned HTTP {exc.response.status_code}",
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"DOV request failed: {exc.__class__.__name__}: {exc}",
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
    session: AsyncSession = Depends(get_session),
) -> BoreholeDetailResponse:
    """Retrieve full borehole detail (header + drill segments + field log + observations).

    Phase C3 will extend the response to include samples and lab tests
    once the sample-import pipeline lands; the repository already eager-
    loads those collections, so this route only needs schema additions
    when that work happens.

    Parameters
    ----------
    borehole_id:
        Primary key of the borehole record.

    Returns
    -------
    BoreholeDetailResponse
        Full borehole tree, with observations sorted by observation_date
        and layers sorted by ``layer_index`` (per the ORM ``order_by``).

    Raises
    ------
    HTTPException(404)
        When no borehole with that id exists.
    """
    repo = BoreholeRepository(session)
    borehole = await repo.get_by_id(borehole_id)
    if borehole is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Borehole {borehole_id} not found",
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
    repo = BoreholeRepository(session)
    # The repository derives the canonical vertical CRS from the row's
    # horizontal EPSG when ``z_epsg`` is None — see ``vertical_crs.py``
    # for the table. Belgian DOV imports map to mTAW; future Dutch BRO
    # imports map to NAP without further router changes.
    borehole = await repo.set_elevation(borehole_id, request.elevation_m, request.z_epsg)
    if borehole is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Borehole {borehole_id} not found",
        )
    await session.commit()
    return BoreholeListItem.model_validate(borehole)
