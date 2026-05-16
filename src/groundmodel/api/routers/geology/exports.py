"""Geology API — model export routes (Plaxis 3D).

Split from the former 1,100-line ``geology.py`` monolith (debt
#40). Mounted under the shared ``/projects/{project_id}/geology``
prefix by this package's ``__init__``; paths are unchanged.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.application.build_ground_model_snapshot import (
    BuildGroundModelSnapshot,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.session import get_session
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
    safe_name = (
        "".join(
            c if c.isalnum() or c in ("-", "_", " ") else "_" for c in snapshot.project_name
        ).strip()
        or "project"
    )
    filename = f"{safe_name}_plaxis3d.py"
    return Response(
        content=payload,
        media_type="text/x-python",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
