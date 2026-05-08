"""CPT API route handlers."""

from __future__ import annotations

import tempfile
from pathlib import Path
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.schemas.cpt_list_item import CptListItem
from groundmodel.api.schemas.cpt_plot_response import CptPlotResponse
from groundmodel.api.schemas.cpt_response import CptResponse
from groundmodel.api.schemas.import_cpt_response import ImportCptResponse
from groundmodel.api.schemas.import_dov_request import ImportDovRequest
from groundmodel.api.schemas.import_dov_response import ImportDovResponse
from groundmodel.api.schemas.validation_issue_schema import ValidationIssueSchema
from groundmodel.application.import_cpt import ImportCpt
from groundmodel.application.import_cpt_dov import ImportCptDov
from groundmodel.domain.services.cpt_interpretation import calculate_ic_series
from groundmodel.infrastructure.db.repositories.cpt_repository import CptRepository
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.exceptions import DuplicateCptError, ParseError

router = APIRouter(prefix="/cpt", tags=["cpt"])


@router.post("/import", response_model=ImportCptResponse, status_code=status.HTTP_201_CREATED)
async def import_cpt(
    file: UploadFile,
    project_id: str | None = Form(None),
    session: AsyncSession = Depends(get_session),
) -> ImportCptResponse:
    """Import a CPT file and persist it to the database.

    Parameters
    ----------
    file:
        Uploaded CPT file.  GEF format is supported in Phase 1.
    project_id:
        UUID of the active app-level project.  CPT is tagged with this ID so
        it only appears in that project's list.  None = unscoped (tests/admin).
    session:
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    ImportCptResponse
        UUID of the created record plus any validation issues found during
        parsing.  The CPT is persisted even when ``has_errors`` is True.

    Raises
    ------
    HTTPException(400)
        When the file extension is not supported, or the file is a duplicate
        (same contract number + test number already in the database).
    """
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".gef"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type '{suffix}'. Supported: .gef",
        )

    app_project_uuid: UUID | None = None
    if project_id:
        try:
            app_project_uuid = UUID(project_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid project_id: {project_id!r}",
            )

    content = await file.read()

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)

    try:
        result = await ImportCpt(session).execute(tmp_path, app_project_uuid)
    except DuplicateCptError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"cpt_id": str(exc.existing_id), "message": str(exc)},
        )
    except ParseError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    finally:
        tmp_path.unlink(missing_ok=True)

    return ImportCptResponse(
        cpt_id=result.cpt_id,
        has_errors=result.has_errors,
        issues=[
            ValidationIssueSchema(
                level=i.level.value,
                code=i.code,
                message=i.message,
                rows=i.rows,
            )
            for i in result.issues
        ],
    )


@router.post("/import-dov", response_model=ImportDovResponse)
async def import_cpt_dov(
    request: ImportDovRequest,
    session: AsyncSession = Depends(get_session),
) -> ImportDovResponse:
    """Import CPTs from DOV within a WGS84 bounding box.

    Parameters
    ----------
    request:
        Bounding box (west, south, east, north in decimal degrees) and optional
        project_id.  The backend queries the DOV WFS, downloads CPT XMLs in
        parallel, and persists each one.

    Returns
    -------
    ImportDovResponse
        Counts of imported, duplicate, and failed CPTs plus all CPT IDs.

    Raises
    ------
    HTTPException(503)
        DOV unreachable (DNS / connection refused / no network).
    HTTPException(504)
        DOV did not respond within the timeout.
    HTTPException(502)
        DOV returned an unexpected error response (4xx/5xx from upstream).
    """
    try:
        result = await ImportCptDov(session).execute(
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

    return ImportDovResponse(
        imported=result.imported,
        duplicates=result.duplicates,
        failed=result.failed,
        cpt_ids=result.cpt_ids,
    )


@router.get("/", response_model=list[CptListItem])
async def list_cpts(
    project_id: str | None = None,
    session: AsyncSession = Depends(get_session),
) -> list[CptListItem]:
    """Return a lightweight summary list of CPTs.

    Parameters
    ----------
    project_id:
        When provided, only return CPTs belonging to this app-level project UUID.
        When absent, return all CPTs (used by tests and admin tools).
    session:
        Database session injected by FastAPI dependency injection.
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

    repo = CptRepository(session)
    cpts = await repo.list_all(app_project_uuid)
    return [
        CptListItem(
            id=c.id,
            name=c.name,
            cpt_type=c.cpt_type,
            max_depth_m=c.max_depth_m,
            n_rows=c.n_rows,
            location_x=c.location_x,
            location_y=c.location_y,
            epsg=c.epsg,
        )
        for c in cpts
    ]


@router.get("/{cpt_id}", response_model=CptResponse)
async def get_cpt(
    cpt_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> CptResponse:
    """Return full CPT metadata for a single record."""
    repo = CptRepository(session)
    cpt = await repo.get_by_id(cpt_id)
    if cpt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CPT not found")

    return CptResponse(
        id=cpt.id,
        name=cpt.name,
        cpt_type=cpt.cpt_type,
        location_x=cpt.location_x,
        location_y=cpt.location_y,
        epsg=cpt.epsg,
        elevation_m=cpt.elevation_m,
        pre_drill_m=cpt.pre_drill_m,
        cone_area_ratio=cpt.cone_area_ratio,
        max_depth_m=cpt.max_depth_m,
        n_rows=cpt.n_rows,
    )


@router.delete("/{cpt_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_cpt(
    cpt_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Delete a CPT and its series data.

    Parameters
    ----------
    cpt_id:
        UUID of the CPT to delete.
    session:
        Database session injected by FastAPI dependency injection.

    Raises
    ------
    HTTPException(404)
        When no CPT with the given ID exists.
    """
    repo = CptRepository(session)
    cpt = await repo.get_by_id(cpt_id)
    if cpt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CPT not found")
    await repo.delete(cpt_id)
    await session.commit()


@router.get("/{cpt_id}/plot", response_model=CptPlotResponse)
async def get_cpt_plot(
    cpt_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> CptPlotResponse:
    """Return raw depth-series arrays for plotting qc, fs, and u2 vs depth."""
    repo = CptRepository(session)
    cpt = await repo.get_by_id(cpt_id)
    if cpt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CPT not found")

    s = cpt.series
    if s is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Series data not found for this CPT",
        )

    ic = (
        calculate_ic_series(
            depths_m=s.depths_m,
            qc_mpa=s.qc_mpa,
            fs_mpa=s.fs_mpa,
            gwt_m=cpt.water_depth_m if cpt.water_depth_m is not None else 1.0,
        )
        if s.fs_mpa is not None
        else None
    )

    return CptPlotResponse(
        cpt_id=cpt.id,
        depths_m=s.depths_m,
        qc_mpa=s.qc_mpa,
        fs_mpa=s.fs_mpa,
        u2_mpa=s.u2_mpa,
        rf_pct=s.rf_pct,
        qt_mpa=s.qt_mpa,
        q_total_mpa=s.q_total_mpa,
        ic=ic,
        rf_source=s.rf_source,
    )
