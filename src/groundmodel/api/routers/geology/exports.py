"""Geology API — model export routes (Plaxis 3D).

Split from the former 1,100-line ``geology.py`` monolith (debt
#40). Mounted under the shared ``/projects/{project_id}/geology``
prefix by this package's ``__init__``; paths are unchanged.
"""

from __future__ import annotations

from collections.abc import Sequence
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import (
    export_response,
    get_in_project_or_404,
    parse_error_as_404,
)
from groundmodel.api.schemas.project.fence_export_request import (
    FenceExportPanel,
    FenceExportRequest,
)
from groundmodel.application.build_ground_model_snapshot import (
    BuildGroundModelSnapshot,
)
from groundmodel.application.export_artifact import ExportArtifact
from groundmodel.infrastructure.db.models.cross_section_orm import (
    CrossSectionOrm,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.session import get_session
from groundmodel.infrastructure.exporters.dxf_fence_exporter import (
    DxfFenceExporter,
    FenceFormationIdentity,
)
from groundmodel.infrastructure.exporters.plaxis_exporter import PlaxisExporter
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
    with parse_error_as_404():
        snapshot = await BuildGroundModelSnapshot(session).execute(
            app_project_id=project_id, model_id=model_id
        )

    payload = PlaxisExporter().export(snapshot)
    return export_response(
        ExportArtifact.build(
            content=payload,
            name=snapshot.project_name,
            fallback="project",
            suffix="_plaxis3d.py",
            media_type="text/x-python",
        )
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

    # Resolve each panel's machine identity (nad_class + soil) so the exporter
    # can name layers by the unit identifier (debt #104). The renderer does not
    # send these — it should not have to know the export naming scheme — so we
    # look them up here from the panels' formation_ids, scoped to the project.
    identity_by_formation_id = await _resolve_fence_identities(session, project_id, request.panels)

    # Resolve each panel's section name so the exporter can split the layers per
    # section (owner ruling 2026-09-05) — the renderer sends only the section id,
    # for the same reason it sends only the formation id above. Scoped to the
    # project so a panel cannot pull a section from another project.
    section_name_by_id = await _resolve_fence_section_names(session, project_id, request.panels)

    payload = DxfFenceExporter().export(
        request.panels,
        project_name=project_name,
        crs_epsg=crs_epsg,
        identity_by_formation_id=identity_by_formation_id,
        section_name_by_id=section_name_by_id,
    )
    return export_response(
        ExportArtifact.build(
            content=payload,
            name=project_name,
            fallback="project",
            suffix="_fence.dxf",
            media_type="application/dxf",
        )
    )


async def _resolve_fence_identities(
    session: AsyncSession,
    project_id: UUID,
    panels: Sequence[FenceExportPanel],
) -> dict[str, FenceFormationIdentity]:
    """Look up each panel formation's ``nad_class`` + soil for layer naming.

    The fence layer name is the unit's machine identifier (debt #104), which is
    built from the formation's ``nad_class`` and ``litho_main_soil_code`` — two
    fields the renderer-POSTed panel does not carry. This resolves them from the
    panels' ``formation_id`` values in ONE query, scoped to ``project_id`` so a
    panel cannot pull a formation from another project.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    project_id : UUID
        Project scope guard — only formations under this project are read.
    panels : Sequence[FenceExportPanel]
        The client-built panels; their ``formation_id`` strings are the lookup
        keys.

    Returns
    -------
    dict[str, FenceFormationIdentity]
        ``formation_id (str) -> identity`` for every panel formation the query
        resolved. A formation_id that does not parse as a UUID, or that the
        query does not return, is simply absent — the exporter then falls back
        to that panel's display name for its layer.
    """
    formation_ids: set[UUID] = set()
    for panel in panels:
        try:
            formation_ids.add(UUID(panel.formation_id))
        except (ValueError, AttributeError):
            # A non-UUID formation_id (e.g. a renderer placeholder) cannot match
            # a row; skip it and let the exporter fall back to the display name.
            continue
    if not formation_ids:
        return {}

    rows = (
        await session.execute(
            select(
                GeologicalFormationOrm.id,
                GeologicalFormationOrm.nad_class,
                GeologicalFormationOrm.litho_main_soil_code,
            ).where(
                GeologicalFormationOrm.app_project_id == project_id,
                GeologicalFormationOrm.id.in_(formation_ids),
            )
        )
    ).all()
    return {
        str(row.id): FenceFormationIdentity(
            nad_class=row.nad_class,
            litho_main_soil_code=row.litho_main_soil_code,
        )
        for row in rows
    }


async def _resolve_fence_section_names(
    session: AsyncSession,
    project_id: UUID,
    panels: Sequence[FenceExportPanel],
) -> dict[str, str]:
    """Look up each panel's cross-section name for the per-section layer split.

    The fence DXF splits its layers per section (owner ruling 2026-09-05), and
    the layer name leads with the section's human name — a field the
    renderer-POSTed panel does not carry (it sends only the ``section_id``, the
    same way it sends only the ``formation_id``). This resolves those ids to
    names in ONE query, scoped to ``project_id`` so a panel cannot pull a section
    from another project.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    project_id : UUID
        Project scope guard — only cross-sections under this project are read.
    panels : Sequence[FenceExportPanel]
        The client-built panels; their ``section_id`` strings are the lookup
        keys.

    Returns
    -------
    dict[str, str]
        ``section_id (str) -> section name`` for every panel section the query
        resolved. A ``section_id`` that is ``None``, does not parse as a UUID, or
        that the query does not return, is simply absent — the exporter then
        keeps the pre-section ``Fence-<unit>`` name for that panel.
    """
    section_ids: set[UUID] = set()
    for panel in panels:
        if panel.section_id is None:
            continue
        try:
            section_ids.add(UUID(panel.section_id))
        except (ValueError, AttributeError):
            # A non-UUID section_id (e.g. a renderer placeholder) cannot match a
            # row; skip it and let the exporter fall back to the unprefixed name.
            continue
    if not section_ids:
        return {}

    rows = (
        await session.execute(
            select(CrossSectionOrm.id, CrossSectionOrm.name).where(
                CrossSectionOrm.app_project_id == project_id,
                CrossSectionOrm.id.in_(section_ids),
            )
        )
    ).all()
    return {str(row.id): row.name for row in rows}
