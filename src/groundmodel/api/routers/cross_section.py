"""Cross-section API routes — CRUD on project-scoped section definitions.

All routes are project-scoped via the URL prefix
``/projects/{project_id}/sections``. Same shape as the geology router
and the project router — the project_id in the URL is the scope guard;
every section returned belongs to that project.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import get_in_project_or_404, merge_view_state
from groundmodel.api.schemas.project.cross_section import (
    CrossSectionCreateRequest,
    CrossSectionResponse,
    CrossSectionUpdateRequest,
)
from groundmodel.application.build_section_snapshot import BuildSectionSnapshot
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.repositories.cross_section_repository import (
    CrossSectionRepository,
)
from groundmodel.infrastructure.db.session import get_session
from groundmodel.infrastructure.exporters.dxf_section_exporter import DxfSectionExporter
from groundmodel.shared.exceptions import ParseError
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Module-level logger — routers are stateless functions, not classes.
logger = LoggerFactory.get_logger(__name__)

router = APIRouter(prefix="/projects/{project_id}/sections", tags=["cross-sections"])


@router.post(
    "",
    response_model=CrossSectionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_section(
    project_id: UUID,
    request: CrossSectionCreateRequest,
    session: AsyncSession = Depends(get_session),
) -> CrossSectionOrm:
    """Create a new cross-section under the given project."""
    repo = CrossSectionRepository(session)
    section = await repo.create(
        project_id,
        name=request.name,
        description=request.description,
        start_x=request.start_x,
        start_y=request.start_y,
        end_x=request.end_x,
        end_y=request.end_y,
        epsg=request.epsg,
        projection_buffer_m=request.projection_buffer_m,
        vertical_exaggeration=request.vertical_exaggeration,
        excluded_borehole_ids=request.excluded_borehole_ids,
        excluded_cpt_ids=request.excluded_cpt_ids,
        min_depth_m=request.min_depth_m,
        max_depth_m=request.max_depth_m,
        display_order=request.display_order,
        view_state=request.view_state,
    )
    await session.commit()
    await session.refresh(section)
    return section


@router.get("", response_model=list[CrossSectionResponse])
async def list_sections(
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[CrossSectionOrm]:
    """List every section for a project, ordered by display_order then name."""
    repo = CrossSectionRepository(session)
    return await repo.list_all(project_id)


@router.get("/{section_id}", response_model=CrossSectionResponse)
async def get_section(
    project_id: UUID,
    section_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> CrossSectionOrm:
    """Fetch a single section by id. 404 when missing or not in this project."""
    repo = CrossSectionRepository(session)
    return await get_in_project_or_404(
        repo.get(section_id), project_id, detail="Cross-section not found"
    )


@router.patch("/{section_id}", response_model=CrossSectionResponse)
async def update_section(
    project_id: UUID,
    section_id: UUID,
    request: CrossSectionUpdateRequest,
    session: AsyncSession = Depends(get_session),
) -> CrossSectionOrm:
    """Partial update — only fields present in the body are written."""
    repo = CrossSectionRepository(session)
    section = await get_in_project_or_404(
        repo.get(section_id), project_id, detail="Cross-section not found"
    )
    # exclude_unset so omitted fields stay untouched; an explicit null
    # is honoured (e.g. clearing min_depth_m back to auto-fit).
    patch = request.model_dump(exclude_unset=True)
    # view_state has its own merge semantics — see the schema docstring:
    #   * absent from body → key not in patch (exclude_unset) → no change
    #   * explicit ``null`` → "do not touch" sentinel; drop the key now
    #     before the generic setattr loop runs in the repo
    #   * empty dict ``{}`` → clear the bag (store None on the column)
    #   * non-empty dict → shallow-merge into the existing bag so
    #     callers can patch individual toggle keys without round-
    #     tripping the whole bag (mirrors PATCH /projects/{id}/view-state)
    if "view_state" in patch:
        incoming = patch["view_state"]
        if incoming is None:
            patch.pop("view_state")
        elif incoming == {}:
            patch["view_state"] = None
        else:
            patch["view_state"] = merge_view_state(section.view_state, incoming)
    updated = await repo.update(section_id, patch)
    # repo.update returns None only on a TOCTOU race (the row vanished
    # between scope-check and update). Vanishingly rare; surface as 404.
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cross-section not found")
    # Post-update invariant: line still has non-zero length. Cheap check.
    if updated.start_x == updated.end_x and updated.start_y == updated.end_y:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cross-section endpoints must remain distinct after update.",
        )
    await session.commit()
    await session.refresh(updated)
    return updated


@router.delete("/{section_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_section(
    project_id: UUID,
    section_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Delete a section. Polylines drawn on it (when the editor lands)
    cascade via FK; today there's nothing to cascade."""
    repo = CrossSectionRepository(session)
    await get_in_project_or_404(repo.get(section_id), project_id, detail="Cross-section not found")
    await repo.delete(section_id)
    await session.commit()


@router.get("/{section_id}/export/dxf")
async def export_section_dxf(
    project_id: UUID,
    section_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Export the section's drawn geological model to a DXF file.

    The DXF carries:

    * One LWPOLYLINE per formation, threaded through the formation's
      contacts sorted left-to-right along the section line.
    * One vertical LINE + name TEXT per projected investigation
      column (CPT or borehole within the section's projection
      buffer).
    * A title block with project + section + datum metadata.

    Engineers download the file and import it into AutoCAD /
    Plaxis 2D / D-Sheet / GeoStudio as the geometric reference for
    their design calculations.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    section_id : UUID
        Section to export. Must belong to ``project_id``.
    model_id : UUID
        Which geological model's contacts to include. The desktop
        sends the active model id by default; nothing prevents
        exporting a non-active model.

    Returns
    -------
    Response
        ``application/dxf`` body with a ``Content-Disposition``
        header proposing a filename derived from the section name.

    Raises
    ------
    HTTPException(404)
        When section / model / project resolution fails — the use
        case raises ``ParseError``; we map to 404 since the typical
        failure mode is "this id doesn't exist in this project".
    """
    logger.info(f"GET /projects/{project_id}/sections/{section_id}/export/dxf (model={model_id})")
    try:
        snapshot = await BuildSectionSnapshot(session).execute(
            app_project_id=project_id,
            section_id=section_id,
            model_id=model_id,
        )
    except ParseError as exc:
        # The use case raises ParseError for not-found / degenerate
        # cases; surface as 404 with the underlying message.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc

    payload = DxfSectionExporter().export(snapshot)
    # Sanitise the section name for the filename — DXF receivers
    # don't like names with forward slashes, control chars, etc.
    safe_name = (
        "".join(
            c if c.isalnum() or c in ("-", "_", " ") else "_" for c in snapshot.section_name
        ).strip()
        or "section"
    )
    filename = f"{safe_name}.dxf"
    return Response(
        content=payload,
        media_type="application/dxf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
