"""Geology API — model export routes (Plaxis 3D).

Split from the former 1,100-line ``geology.py`` monolith (debt
#40). Mounted under the shared ``/projects/{project_id}/geology``
prefix by this package's ``__init__``; paths are unchanged.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import (
    get_in_project_or_404,
    safe_filename_stem,
)
from groundmodel.api.schemas.project.fence_export_request import FenceExportRequest
from groundmodel.application.build_ground_model_snapshot import (
    BuildGroundModelSnapshot,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.session import get_session
from groundmodel.infrastructure.exporters.dxf_fence_exporter import DxfFenceExporter
from groundmodel.infrastructure.exporters.plaxis_exporter import PlaxisExporter
from groundmodel.shared.exceptions import ParseError
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Module-level logger — routers are stateless functions, not classes.
logger = LoggerFactory.get_logger(__name__)

# No prefix here — the package __init__ mounts this on the shared
# ``/projects/{project_id}/geology`` parent router (paths unchanged).
router = APIRouter()

# Exports
# ---------------------------------------------------------------------------


@router.get("/models/{model_id}/export/plaxis3d")
async def export_model_plaxis3d(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Export the geological model as a runnable Plaxis 3D Python script.

    Generates a self-contained ``plxscripting`` script that builds the
    boreholes + global soil-layer stack inside a running Plaxis 3D
    (2018+). Materials are Mohr-Coulomb placeholders — the engineer
    fills in parameters in Plaxis after import.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Geological model to export. Must belong to ``project_id``.

    Returns
    -------
    Response
        ``text/x-python`` body with a ``Content-Disposition`` header
        proposing a filename derived from the model name.

    Raises
    ------
    HTTPException(404)
        When project / model resolution fails — the snapshot builder
        raises ``ParseError``; we map to 404.
    """
    logger.info(f"GET /projects/{project_id}/geology/models/{model_id}/export/plaxis3d")
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id), project_id, detail="Model not found"
    )
    try:
        snapshot = await BuildGroundModelSnapshot(session).execute(
            app_project_id=project_id, model_id=model_id
        )
    except ParseError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    payload = PlaxisExporter().export(snapshot)
    safe_name = safe_filename_stem(snapshot.project_name, "project")
    filename = f"{safe_name}_plaxis3d.py"
    return Response(
        content=payload,
        media_type="text/x-python",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/models/{model_id}/export/fence-dxf")
async def export_model_fence_dxf(
    project_id: UUID,
    model_id: UUID,
    request: FenceExportRequest,
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Export the client-built 3-D fence diagram as a DXF file.

    The fence's wall panels are triangulated in the renderer (from the
    section partition engine, which the server cannot rebuild) and POSTed
    whole; this endpoint validates the panels' triangle indices, then
    serialises them with :class:`DxfFenceExporter`. Coordinates are
    written as-is in the project's projected CRS metres — see the
    exporter's module docstring for the coordinate-system contract.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Geological model the fence was built from. Must belong to
        ``project_id``. Not otherwise used — the fence geometry is
        entirely client-supplied — but kept in the path for scope
        consistency with the other model-export routes and so a future
        server-side fence rebuild has somewhere to hang the model id.
    request : FenceExportRequest
        The fence panels to export. An out-of-range triangle vertex index
        fails Pydantic validation (HTTP 422) before this handler runs.

    Returns
    -------
    Response
        ``application/dxf`` body with a ``Content-Disposition`` header
        proposing a filename derived from the project name.

    Raises
    ------
    HTTPException(404)
        When ``model_id`` does not exist or does not belong to
        ``project_id``.
    """
    logger.info(
        f"POST /projects/{project_id}/geology/models/{model_id}/export/fence-dxf "
        f"panels={len(request.panels)}"
    )
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id), project_id, detail="Model not found"
    )

    # The project row is guaranteed to exist once its model passed the scope
    # guard above (FK) — read it directly for the name + CRS rather than
    # repeating a second 404 check (mirrors surfaces.py's ground-surface
    # build handler, which resolves the project's EPSG the same way).
    project_row = await session.get(ProjectOrm, project_id)
    project_name = project_row.name if project_row is not None else "project"
    crs_epsg = project_row.default_horizontal_epsg if project_row is not None else None

    payload = DxfFenceExporter().export(
        request.panels,
        project_name=project_name,
        crs_epsg=crs_epsg,
    )
    filename = f"{safe_filename_stem(project_name, 'project')}_fence.dxf"
    return Response(
        content=payload,
        media_type="application/dxf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
