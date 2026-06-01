"""Cross-section API routes — CRUD on project-scoped section definitions.

All routes are project-scoped via the URL prefix
``/projects/{project_id}/sections``. Same shape as the geology router
and the project router — the project_id in the URL is the scope guard;
every section returned belongs to that project.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import get_in_project_or_404, merge_view_state
from groundmodel.api.schemas.project.cross_section import (
    CrossSectionCreateRequest,
    CrossSectionResponse,
    CrossSectionUpdateRequest,
)
from groundmodel.application.build_section_snapshot import BuildSectionSnapshot
from groundmodel.application.section_snapshot import SectionSnapshot
from groundmodel.infrastructure.codelists.horizontal_crs import (
    horizontal_crs_label,
    is_supported_section_crs,
)
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.repositories.cross_section_repository import (
    CrossSectionRepository,
)
from groundmodel.infrastructure.db.session import get_session
from groundmodel.infrastructure.exporters.dxf_section_exporter import DxfSectionExporter
from groundmodel.infrastructure.exporters.plaxis_section_exporter import (
    PlaxisSectionExporter,
)
from groundmodel.shared.exceptions import ParseError
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Module-level logger — routers are stateless functions, not classes.
logger = LoggerFactory.get_logger(__name__)

router = APIRouter(prefix="/projects/{project_id}/sections", tags=["cross-sections"])


def _require_supported_section_crs(epsg: int | None, *, context: str) -> None:
    """Reject a non-metric section CRS with a clear 400 (debt #31).

    A cross-section's along-distance is a Euclidean distance in the
    section's CRS units; only a projected metric CRS makes that
    physically correct. Geographic CRS (e.g. EPSG:4326 — degrees)
    would silently produce ~1e-4-scale geometry in every export, so
    we fail loudly at the boundary instead.

    Parameters
    ----------
    epsg : int | None
        The section's horizontal EPSG (creation request or resolved
        snapshot).
    context : str
        Short phrase for the error message — e.g. ``"create a
        cross-section"`` or ``"export this section"``.

    Raises
    ------
    HTTPException(400)
        When ``epsg`` is not in the supported metric allowlist.
    """
    if is_supported_section_crs(epsg):
        return
    logger.warning(
        f"Rejected attempt to {context} in unsupported CRS "
        f"{horizontal_crs_label(epsg)} (not a projected metric CRS)"
    )
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=(
            f"Cannot {context}: {horizontal_crs_label(epsg)} is not a "
            "supported projected metric CRS. Cross-section geometry "
            "requires metres (e.g. Belgian Lambert 72 / RD New). Set a "
            "metric Default horizontal CRS in Project metadata."
        ),
    )


async def _build_export_snapshot(
    session: AsyncSession,
    project_id: UUID,
    section_id: UUID,
    model_id: UUID,
) -> SectionSnapshot:
    """Load a section snapshot and validate its CRS for export.

    Combines the three boilerplate steps repeated by every section-export
    handler: ``BuildSectionSnapshot``, ``ParseError → 404``, and the
    defence-in-depth CRS allowlist check (debt #31).

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    project_id : UUID
        Project scope guard — passed through to the snapshot builder.
    section_id : UUID
        Section to export.
    model_id : UUID
        Geological model whose contacts to include.

    Returns
    -------
    SectionSnapshot
        Snapshot ready for any section-export handler.

    Raises
    ------
    HTTPException(404)
        When the section / model / project cannot be resolved.
    HTTPException(400)
        When the section carries a non-metric CRS (debt #31).
    """
    try:
        snapshot = await BuildSectionSnapshot(session).execute(
            app_project_id=project_id,
            section_id=section_id,
            model_id=model_id,
        )
    except ParseError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    _require_supported_section_crs(snapshot.crs_epsg, context="export this section")
    return snapshot


def _section_safe_name(section_name: str) -> str:
    """Sanitise a section name into a safe filename stem.

    Strips characters that cause problems in filenames or
    ``Content-Disposition`` headers (forward slashes, control chars,
    double-quotes, etc.). Falls back to ``"section"`` when nothing
    safe remains.

    Parameters
    ----------
    section_name : str
        Raw section name from the snapshot.

    Returns
    -------
    str
        Alphanumeric + ``-_`` filename stem, stripped of leading/trailing
        spaces.
    """
    return (
        "".join(c if c.isalnum() or c in ("-", "_", " ") else "_" for c in section_name).strip()
        or "section"
    )


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
    """Create a new cross-section under the given project.

    Rejects a non-metric ``epsg`` with 400 — see
    :func:`_require_supported_section_crs` (debt #31).
    """
    _require_supported_section_crs(request.epsg, context="create a cross-section")
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
    snapshot = await _build_export_snapshot(session, project_id, section_id, model_id)
    payload = DxfSectionExporter().export(snapshot)
    filename = f"{_section_safe_name(snapshot.section_name)}.dxf"
    return Response(
        content=payload,
        media_type="application/dxf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{section_id}/export/pdf")
async def export_section_pdf(
    project_id: UUID,
    section_id: UUID,
    model_id: UUID,
    # Query-param length caps (debt #112): query strings bypass
    # BodySizeLimitMiddleware, so we cap them here. 256 chars covers any
    # reasonable report title / author name; 4096 covers a multi-line note.
    title: str | None = Query(default=None, max_length=256),
    author: str | None = Query(default=None, max_length=256),
    notes: str | None = Query(default=None, max_length=4096),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Export the section as a PDF project report (debt #52 slice 1).

    First slice of the project-report subsystem. Produces a single-
    section A4 portrait PDF with a title block + project metadata + the
    section figure (packed-but-nudge-capped column layout, 35 m cap per
    the owner directive) + a plan-view location-map inset with L/R
    end-of-line markers.

    Future slices ship the geometries report, the full geological +
    lithological report, and the parameters report (each its own
    endpoint, reusing this exporter's primitives — see debt #52).

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    section_id : UUID
        Section to export.  Must belong to ``project_id``.
    model_id : UUID
        Geological model whose contacts to render on the section.
    title : str | None
        Report title.  Defaults to ``"Cross-section: <section_name>"``.
    author : str | None
        Engineer name.  Defaults to empty.
    notes : str | None
        Free-text note rendered under the metadata table.  Defaults to
        empty.

    Returns
    -------
    Response
        ``application/pdf`` body with a ``Content-Disposition`` header
        proposing the filename ``"<section_name>.pdf"``.
    """
    from groundmodel.infrastructure.exporters.section_pdf_report_exporter import (
        ReportMetadata,
        SectionPdfReportExporter,
    )

    logger.info(f"GET /projects/{project_id}/sections/{section_id}/export/pdf (model={model_id})")
    snapshot = await _build_export_snapshot(session, project_id, section_id, model_id)
    effective_title = title or f"Cross-section: {snapshot.section_name}"
    metadata = ReportMetadata(
        title=effective_title,
        author=author or "",
        notes=notes or "",
    )
    payload = SectionPdfReportExporter().export(snapshot, metadata)
    filename = f"{_section_safe_name(snapshot.section_name)}.pdf"
    return Response(
        content=payload,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{section_id}/export/plaxis2d")
async def export_section_plaxis2d(
    project_id: UUID,
    section_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Export the section's drawn geology as a runnable Plaxis 2D script.

    The section-scoped sibling of the project-wide
    ``GET /geology/models/{model_id}/export/plaxis3d``. The emitted
    ``.py`` connects to a running PLAXIS 2D via ``plxscripting``,
    creates one Mohr-Coulomb placeholder material per formation, a
    global soil-layer stack in stratigraphic order, and one borehole
    per projected column placed at its along-section distance — the
    same geometry the section editor shows.

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
        ``text/x-python`` body with a ``Content-Disposition`` header
        proposing a ``<section>_plaxis2d.py`` filename.

    Raises
    ------
    HTTPException(404)
        When section / model / project resolution fails — the use
        case raises ``ParseError``; mapped to 404 since the typical
        failure mode is "this id doesn't exist in this project".
    """
    logger.info(
        f"GET /projects/{project_id}/sections/{section_id}/export/plaxis2d (model={model_id})"
    )
    snapshot = await _build_export_snapshot(session, project_id, section_id, model_id)
    payload = PlaxisSectionExporter().export(snapshot)
    filename = f"{_section_safe_name(snapshot.section_name)}_plaxis2d.py"
    return Response(
        content=payload,
        media_type="text/x-python",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
