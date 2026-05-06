"""CPT API route handlers."""

from __future__ import annotations

import tempfile
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.schemas.cpt_list_item import CptListItem
from groundmodel.api.schemas.cpt_plot_response import CptPlotResponse
from groundmodel.api.schemas.cpt_response import CptResponse
from groundmodel.api.schemas.import_cpt_response import ImportCptResponse
from groundmodel.api.schemas.validation_issue_schema import ValidationIssueSchema
from groundmodel.application.import_cpt import ImportCpt
from groundmodel.infrastructure.db.repositories.cpt_repository import CptRepository
from groundmodel.infrastructure.db.session import get_session

router = APIRouter(prefix="/cpt", tags=["cpt"])


@router.post("/import", response_model=ImportCptResponse, status_code=status.HTTP_201_CREATED)
async def import_cpt(
    file: UploadFile,
    session: AsyncSession = Depends(get_session),
) -> ImportCptResponse:
    """Import a CPT file and persist it to the database.

    Parameters
    ----------
    file:
        Uploaded CPT file.  GEF format is supported in Phase 1.
    session:
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    ImportCptResponse
        UUID of the created record plus any validation issues found during
        parsing.  The CPT is persisted even when ``has_errors`` is True — the
        caller decides how to handle error files.

    Raises
    ------
    HTTPException(400)
        When the file extension is not supported.
    """
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".gef"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type '{suffix}'. Supported: .gef",
        )

    content = await file.read()

    # Write to a temp file so ImportCpt can dispatch on the extension.
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)

    try:
        result = await ImportCpt(session).execute(tmp_path)
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


@router.get("/", response_model=list[CptListItem])
async def list_cpts(
    session: AsyncSession = Depends(get_session),
) -> list[CptListItem]:
    """Return a lightweight summary list of all CPTs.

    Series arrays are not loaded — this endpoint is designed for map and table
    views that need metadata only.

    Parameters
    ----------
    session:
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    list[CptListItem]
        All CPTs ordered by creation time, ascending.
    """
    repo = CptRepository(session)
    cpts = await repo.list_all()
    return [
        CptListItem(
            id=c.id,
            name=c.name,
            cpt_type=c.cpt_type,
            max_depth_m=c.max_depth_m,
            n_rows=c.n_rows,
        )
        for c in cpts
    ]


@router.get("/{cpt_id}", response_model=CptResponse)
async def get_cpt(
    cpt_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> CptResponse:
    """Return full CPT metadata for a single record.

    Parameters
    ----------
    cpt_id:
        UUID of the CPT to retrieve.
    session:
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    CptResponse
        All metadata columns for the requested CPT.

    Raises
    ------
    HTTPException(404)
        When no CPT with the given ID exists.
    """
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
        cone_area_ratio=cpt.cone_area_ratio,
        max_depth_m=cpt.max_depth_m,
        n_rows=cpt.n_rows,
    )


@router.get("/{cpt_id}/plot", response_model=CptPlotResponse)
async def get_cpt_plot(
    cpt_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> CptPlotResponse:
    """Return raw depth-series arrays for plotting qc, fs, and u2 vs depth.

    Arrays are ordered shallow-to-deep (ascending depth), matching the storage
    order.  The frontend should invert the depth axis when rendering charts
    (geotechnical convention: depth increases downward on screen).

    Parameters
    ----------
    cpt_id:
        UUID of the CPT whose series to retrieve.
    session:
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    CptPlotResponse
        Parallel arrays for depth, qc, fs (optional), u2 (optional), and Rf
        (optional).

    Raises
    ------
    HTTPException(404)
        When no CPT with the given ID exists, or when the series row is missing.
    """
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

    return CptPlotResponse(
        cpt_id=cpt.id,
        depths_m=s.depths_m,
        qc_mpa=s.qc_mpa,
        fs_mpa=s.fs_mpa,
        u2_mpa=s.u2_mpa,
        rf_pct=s.rf_pct,
    )
