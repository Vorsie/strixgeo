"""Cross-section API routes — CRUD on project-scoped section definitions.

All routes are project-scoped via the URL prefix
``/projects/{project_id}/sections``. Same shape as the geology router
and the project router — the project_id in the URL is the scope guard;
every section returned belongs to that project.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import (
    apply_view_state_patch,
    export_response,
    get_in_project_or_404,
    parse_error_as_404,
)
from groundmodel.api.schemas.project.batch_create_sections_request import (
    BatchCreateSectionsRequest,
)
from groundmodel.api.schemas.project.batch_create_sections_response import (
    BatchCreateSectionsResponse,
)
from groundmodel.api.schemas.project.cross_section import (
    CrossSectionCreateRequest,
    CrossSectionResponse,
    CrossSectionUpdateRequest,
)
from groundmodel.api.schemas.project.section_dxf_export_request import (
    SectionDxfExportRequest,
)
from groundmodel.api.schemas.project.section_geometry_export_request import (
    SectionGeometryExportRequest,
)
from groundmodel.application.batch_create_sections import BatchCreateSections
from groundmodel.application.build_section_polygons import BuildSectionPolygons
from groundmodel.application.build_section_snapshot import BuildSectionSnapshot
from groundmodel.application.export_artifact import ExportArtifact
from groundmodel.application.section_cpt_trace import SectionCptTrace
from groundmodel.application.section_membership import (
    load_section_member_investigation_ids,
    stale_surfaces_if_membership_changed,
)
from groundmodel.application.section_membership_constants import (
    SECTION_MEMBERSHIP_FIELDS,
)
from groundmodel.application.section_polygon_set import SectionPolygonSet
from groundmodel.application.section_snapshot import SectionSnapshot
from groundmodel.application.thin_export_units import ThinExportUnits
from groundmodel.infrastructure.codelists.horizontal_crs import (
    horizontal_crs_label,
    is_supported_section_crs,
)
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.repositories.cpt_repository import CptRepository
from groundmodel.infrastructure.db.repositories.cross_section_repository import (
    CrossSectionRepository,
)
from groundmodel.infrastructure.db.session import get_session
from groundmodel.infrastructure.exporters.dsheet_piling_exporter import (
    DSheetPilingExporter,
)
from groundmodel.infrastructure.exporters.dsheet_piling_exporter_constants import (
    DEFAULT_SAMPLE_FRACTION,
)
from groundmodel.infrastructure.exporters.dstability_exporter import DStabilityExporter
from groundmodel.infrastructure.exporters.dxf_section_exporter import DxfSectionExporter
from groundmodel.infrastructure.exporters.plaxis_section_exporter import (
    PlaxisSectionExporter,
)
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
    *,
    thin_units: bool = False,
) -> SectionSnapshot:
    """Load a section snapshot and validate its CRS for export.

    Combines the three boilerplate steps repeated by every section-export
    handler: ``BuildSectionSnapshot``, ``ParseError → 404``, and the
    defence-in-depth CRS allowlist check (debt #31) — plus the optional
    same-NAD thinning pass (debt #104b).

    ``thin_units`` defaults to FALSE so the exact snapshot is what a new
    caller gets by default; the DXF and PDF handlers opt in per the owner
    ruling, and the Plaxis handler must never pass it (its global
    soil-layer stack cannot express an interleaved merge).

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
    with parse_error_as_404():
        snapshot = await BuildSectionSnapshot(session).execute(
            app_project_id=project_id,
            section_id=section_id,
            model_id=model_id,
        )
    _require_supported_section_crs(snapshot.crs_epsg, context="export this section")
    if thin_units:
        snapshot = ThinExportUnits().execute(snapshot)
    return snapshot


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

    Parameters
    ----------
    project_id : UUID
        Project scope guard from the URL prefix; the new section is created
        under this project.
    request : CrossSectionCreateRequest
        Section definition: endpoints, CRS, projection buffer, exaggeration,
        exclusions, depth clamps, display order, and view state.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    CrossSectionResponse
        The persisted cross-section row.

    Raises
    ------
    HTTPException(400)
        When ``request.epsg`` is not a supported projected metric CRS.
    """
    _require_supported_section_crs(request.epsg, context="create a cross-section")
    repo = CrossSectionRepository(session)
    members_before = await load_section_member_investigation_ids(session, project_id=project_id)
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
    # Only tests a section draws feed the model (owner ruling 2026-09-23): when the
    # new section draws a test no section drew before, every built surface of the
    # project must be rebuilt; a section over already-drawn tests changes nothing.
    await session.flush()
    await stale_surfaces_if_membership_changed(
        session,
        project_id=project_id,
        before=members_before,
        reason=f"section created: {section.name}",
    )
    await session.commit()
    await session.refresh(section)
    return section


@router.post("/batch", response_model=BatchCreateSectionsResponse)
async def batch_create_sections(
    project_id: UUID,
    request: BatchCreateSectionsRequest,
    session: AsyncSession = Depends(get_session),
) -> BatchCreateSectionsResponse:
    """Create several cross-sections in one transaction (Accept-all tie-sections).

    Mirrors :func:`create_section` per-section but commits once for the whole
    batch, matching the ``BatchAcceptLithoSuggestions`` pattern.  An empty
    ``sections`` list is a valid no-op that returns an empty response.

    Each section is validated (including the CRS check and distinct-endpoints
    invariant) before any row is written.

    Parameters
    ----------
    project_id : UUID
        Project scope guard from the URL prefix; every created section is
        placed under this project.
    request : BatchCreateSectionsRequest
        Body carrying the list of section definitions to create.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    BatchCreateSectionsResponse
        The persisted cross-section rows (empty when ``sections`` is empty).

    Raises
    ------
    HTTPException(400)
        When any section's ``epsg`` is not a supported projected metric CRS.
    """
    for req in request.sections:
        _require_supported_section_crs(req.epsg, context="batch-create cross-sections")

    # Build plain dicts from each request, forwarding every kwarg accepted by
    # CrossSectionRepository.create.  exclude_none keeps optional fields absent
    # rather than passing None explicitly (the repo already defaults them).
    specs = [
        s.model_dump(exclude_none=True, exclude={"view_state"})
        | ({"view_state": s.view_state} if s.view_state is not None else {})
        for s in request.sections
    ]

    rows = await BatchCreateSections(session).execute(app_project_id=project_id, sections=specs)
    return BatchCreateSectionsResponse(
        sections=[CrossSectionResponse.model_validate(row) for row in rows]
    )


@router.get("", response_model=list[CrossSectionResponse])
async def list_sections(
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[CrossSectionOrm]:
    """List every section for a project, ordered by display_order then name.

    Parameters
    ----------
    project_id : UUID
        Project scope guard from the URL prefix; only sections belonging to
        this project are returned.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    list[CrossSectionResponse]
        Every cross-section for the project, ordered by ``display_order``
        then ``name``.
    """
    repo = CrossSectionRepository(session)
    return await repo.list_all(project_id)


@router.get("/{section_id}", response_model=CrossSectionResponse)
async def get_section(
    project_id: UUID,
    section_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> CrossSectionOrm:
    """Fetch a single section by id. 404 when missing or not in this project.

    Parameters
    ----------
    project_id : UUID
        Project scope guard from the URL prefix; the section must belong to
        this project.
    section_id : UUID
        Primary key of the cross-section to fetch.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    CrossSectionResponse
        The requested cross-section row.

    Raises
    ------
    HTTPException(404)
        When no section with the given id exists, or it belongs to a
        different project.
    """
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
    """Partial update — only fields present in the body are written.

    Parameters
    ----------
    project_id : UUID
        Project scope guard from the URL prefix; the section must belong to
        this project.
    section_id : UUID
        Primary key of the cross-section to update.
    request : CrossSectionUpdateRequest
        Partial update body; only fields present are written. ``view_state``
        follows shallow-merge semantics (absent = no change, ``null`` =
        untouched, ``{}`` = clear, non-empty = merge).
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    CrossSectionResponse
        The updated cross-section row.

    Raises
    ------
    HTTPException(404)
        When no section with the given id exists, it belongs to a different
        project, or the row vanishes in a TOCTOU race during update.
    HTTPException(400)
        When the update would collapse the section endpoints (start equals
        end after the patch).
    """
    repo = CrossSectionRepository(session)
    await get_in_project_or_404(repo.get(section_id), project_id, detail="Cross-section not found")
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
    #
    # The non-empty merge is deferred to an atomic UPDATE AFTER the generic patch
    # lands: merging in Python here and writing the whole column back is a
    # lost-update race — two overlapping PATCHes read the same bag and the second
    # commit drops the first caller's key. See ``apply_view_state_patch``.
    view_state_merge: dict[str, Any] | None = None
    if "view_state" in patch:
        incoming = patch.pop("view_state")
        if incoming == {}:
            patch["view_state"] = None
        elif incoming is not None:
            view_state_merge = incoming
    touches_membership = bool(SECTION_MEMBERSHIP_FIELDS & patch.keys())
    members_before = (
        await load_section_member_investigation_ids(session, project_id=project_id)
        if touches_membership
        else set()
    )
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
    if view_state_merge is not None:
        await apply_view_state_patch(session, CrossSectionOrm, section_id, view_state_merge)
    if touches_membership:
        # Geometry, corridor or exclusion changes CAN move tests on or off this
        # section; the models go stale only when the drawn-test set actually
        # changed (owner ruling 2026-09-23: widening a corridor that captures
        # nobody new leaves the model fresh). A rename never gets here.
        await session.flush()
        await stale_surfaces_if_membership_changed(
            session,
            project_id=project_id,
            before=members_before,
            reason=f"section changed: {updated.name}",
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
    cascade via FK; today there's nothing to cascade.

    Parameters
    ----------
    project_id : UUID
        Project scope guard from the URL prefix; the section must belong to
        this project before deletion is permitted.
    section_id : UUID
        Primary key of the cross-section to delete.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    None
        Responds with ``204 No Content`` on success.

    Raises
    ------
    HTTPException(404)
        When no section with the given id exists, or it belongs to a
        different project.
    """
    repo = CrossSectionRepository(session)
    await get_in_project_or_404(repo.get(section_id), project_id, detail="Cross-section not found")
    members_before = await load_section_member_investigation_ids(session, project_id=project_id)
    await repo.delete(section_id)
    # The tests ONLY this section drew leave the model (owner ruling 2026-09-23);
    # a section whose tests another section still draws changes nothing.
    await session.flush()
    await stale_surfaces_if_membership_changed(
        session, project_id=project_id, before=members_before, reason="section deleted"
    )
    await session.commit()


@router.get("/{section_id}/export/dxf")
async def export_section_dxf(
    project_id: UUID,
    section_id: UUID,
    model_id: UUID,
    # debt #104b — same-NAD thinning is the DEFAULT for the CAD
    # deliverable per the owner ruling. The opt-out exists because the
    # merge erases a litho / geological boundary the engineer drew, and a
    # client whose CAD deliverable has to show those parent boundaries
    # should not need a code change to get them.
    thin_units: bool = Query(default=True),
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
    snapshot = await _build_export_snapshot(
        session, project_id, section_id, model_id, thin_units=thin_units
    )
    payload = DxfSectionExporter().export(snapshot)
    return export_response(
        ExportArtifact.build(
            content=payload,
            name=snapshot.section_name,
            fallback="section",
            suffix=".dxf",
            media_type="application/dxf",
        )
    )


async def _load_cpt_traces(
    session: AsyncSession, project_id: UUID, snapshot: SectionSnapshot
) -> list[SectionCptTrace]:
    """The stored qc / Rf series of the snapshot's CPT columns, for the curves.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    project_id : UUID
        Project scope guard on the series read.
    snapshot : SectionSnapshot
        Its ``cpt`` investigations are the columns that can carry a curve.

    Returns
    -------
    list[SectionCptTrace]
        One trace per CPT that has a series; a CPT without one draws no curve.
    """
    cpt_ids = [inv.investigation_id for inv in snapshot.investigations if inv.kind == "cpt"]
    if not cpt_ids:
        return []
    rows = await CptRepository(session).get_many_with_series(cpt_ids, app_project_id=project_id)
    traces: list[SectionCptTrace] = []
    for cpt in rows:
        series = cpt.series
        if series is None or not series.depths_m:
            continue
        traces.append(
            SectionCptTrace(
                investigation_id=cpt.id,
                depths_m=tuple(series.depths_m),
                qc_mpa=tuple(series.qc_mpa),
                rf_pct=None if series.rf_pct is None else tuple(series.rf_pct),
            )
        )
    logger.info(f"DXF export: {len(traces)} of {len(cpt_ids)} CPT column(s) carry a series")
    return traces


@router.post("/{section_id}/export/dxf")
async def export_section_dxf_with_fill(
    project_id: UUID,
    section_id: UUID,
    model_id: UUID,
    request: SectionDxfExportRequest,
    thin_units: bool = Query(default=True),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Export the section as DXF WITH its drawn fill and the CPT curves.

    Owner 2026-09-26: a DXF of a litho fill *"should literally look like litho
    fill in app"*. A POST, like D-Stability, because the fill is computed in
    the renderer and travels in the body (the same partition the voxel build
    sends). On top of everything the GET writes (contact polylines, column
    lines, title block, mapping table), each drawn region becomes a closed
    outline plus a solid see-through hatch on its unit's layer, and each CPT
    column with a stored series gets its qc and Rf curves on the app's scales.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    section_id : UUID
        Section to export. Must belong to ``project_id``.
    model_id : UUID
        Which model's units the fill is drawn on (the axis the engineer is on).
    request : SectionDxfExportRequest
        The section's drawn partition fill, or none for the line drawing
        plus the curves (the stratigraphy axis has no litho partition).
    thin_units : bool
        Same-NAD thinning of the contact snapshot (debt #104b), default on.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    Response
        ``application/dxf`` body with a ``Content-Disposition`` filename.

    Raises
    ------
    HTTPException(404)
        When section / model / project resolution fails.
    HTTPException(400)
        When the section carries a non-metric CRS.
    """
    logger.info(
        f"POST /projects/{project_id}/sections/{section_id}/export/dxf "
        f"(model={model_id}, "
        f"regions={'none' if request.partition is None else len(request.partition.regions)}, "
        f"thin_units={thin_units})"
    )
    snapshot = await _build_export_snapshot(
        session, project_id, section_id, model_id, thin_units=thin_units
    )
    fill = (
        None
        if request.partition is None
        else await BuildSectionPolygons(session).execute(
            snapshot=snapshot, partition=request.partition.to_domain()
        )
    )
    traces = await _load_cpt_traces(session, project_id, snapshot)
    payload = DxfSectionExporter().export(snapshot, fill=fill, cpt_traces=traces)
    return export_response(
        ExportArtifact.build(
            content=payload,
            name=snapshot.section_name,
            fallback="section",
            suffix=".dxf",
            media_type="application/dxf",
        )
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
    # No ``thin_units`` here, deliberately (debt #104b, owner ruling
    # "keep plaxis exact"): the emitted script indexes ONE global
    # soillayer stack that every borehole reuses, so a merged unit that
    # is interleaved anywhere on the section would have to occupy one
    # global layer twice in a column — inexpressible. The script's own
    # mapping table names every unit separately instead.
    snapshot = await _build_export_snapshot(session, project_id, section_id, model_id)
    payload = PlaxisSectionExporter().export(snapshot)
    return export_response(
        ExportArtifact.build(
            content=payload,
            name=snapshot.section_name,
            fallback="section",
            suffix="_plaxis2d.py",
            media_type="text/x-python",
        )
    )


async def _build_export_polygons(
    session: AsyncSession,
    project_id: UUID,
    section_id: UUID,
    model_id: UUID,
    request: SectionGeometryExportRequest,
) -> SectionPolygonSet:
    """Load a section snapshot and resolve the POSTed partition against it.

    The closed-geometry counterpart of :func:`_build_export_snapshot`:
    same scope guards and CRS check, then the renderer's drawn fill
    converted from gap-local fractions to absolute along-distances.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    project_id : UUID
        Project scope guard.
    section_id : UUID
        Section to export.
    model_id : UUID
        Geological / litho / geotech model the section is exported on.
    request : SectionGeometryExportRequest
        The drawn partition, from the renderer.

    Returns
    -------
    SectionPolygonSet
        Ready for any ``SectionGeometryExporter``.

    Raises
    ------
    HTTPException(404)
        When the section / model / project cannot be resolved.
    HTTPException(400)
        When the section carries a non-metric CRS (debt #31).
    """
    snapshot = await _build_export_snapshot(session, project_id, section_id, model_id)
    return await BuildSectionPolygons(session).execute(
        snapshot=snapshot,
        partition=request.partition.to_domain(),
    )


def _refuse_empty_geometry(exc: ValueError, code: str) -> HTTPException:
    """Map an exporter's refusal to a 422 the desktop can toast verbatim.

    Both D-Series exporters raise ``ValueError`` when there is nothing
    honest to write — no closed geometry at all, or no ground at the
    sampled position. That is a 422 rather than a 500: the request was
    well-formed, the MODEL is not ready to export, and the engineer's
    next action is to draw the fill.

    Parameters
    ----------
    exc : ValueError
        The exporter's refusal; its message names the section and the
        remedy.
    code : str
        Stable machine code for the client — ``"dstability_export_refused"``
        or ``"dsheetpiling_export_refused"``.

    Returns
    -------
    HTTPException
        The 422 to raise.
    """
    logger.warning(f"Section geometry export refused ({code}): {exc}")
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"code": code, "message": str(exc)},
    )


@router.post("/{section_id}/export/dstability")
async def export_section_dstability(
    project_id: UUID,
    section_id: UUID,
    model_id: UUID,
    request: SectionGeometryExportRequest,
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Export the section's drawn geometry as a D-Stability ``.stix``.

    A POST, not a GET, because D-Stability's geometry IS the section's
    filled polygons and the fill is computed in the renderer — the
    request body carries the same partition payload the 3-D voxel build
    sends. Each drawn region becomes one D-Stability layer; each unit
    becomes one soil named by its export identifier (``NAD-06_ZAND``).

    **No design parameter is exported.** Strength, stiffness and unit
    weight stay at GEOLib's initial values and no phreatic line is
    written — see ``DStabilityExporter`` for why that is the product's
    liability line.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    section_id : UUID
        Section to export. Must belong to ``project_id``.
    model_id : UUID
        Which model's units to name. The desktop sends the model whose
        axis the engineer is looking at.
    request : SectionGeometryExportRequest
        The section's drawn partition fill.

    Returns
    -------
    Response
        ``application/octet-stream`` body (a ``.stix`` is a zip
        container) with a ``Content-Disposition`` header proposing a
        ``<section>.stix`` filename.

    Raises
    ------
    HTTPException(404)
        When section / model / project resolution fails.
    HTTPException(400)
        When the section carries a non-metric CRS.
    HTTPException(422)
        ``code = "dstability_export_refused"`` when the section has no
        closed geometry to export — an empty ``.stix`` would be a
        plausible, correctly-named, completely wrong deliverable.
    """
    logger.info(
        f"POST /projects/{project_id}/sections/{section_id}/export/dstability "
        f"(model={model_id}, regions={len(request.partition.regions)})"
    )
    polygons = await _build_export_polygons(session, project_id, section_id, model_id, request)
    try:
        payload = DStabilityExporter().export(polygons)
    except ValueError as exc:
        raise _refuse_empty_geometry(exc, "dstability_export_refused") from exc
    return export_response(
        ExportArtifact.build(
            content=payload,
            name=polygons.section_name,
            fallback="section",
            suffix=".stix",
            media_type="application/octet-stream",
        )
    )


@router.post("/{section_id}/export/dsheetpiling")
async def export_section_dsheetpiling(
    project_id: UUID,
    section_id: UUID,
    model_id: UUID,
    request: SectionGeometryExportRequest,
    # Where along the section line to take the 1-D profile. Bounded here
    # so an out-of-range value is a 422 from the schema rather than a
    # ValueError from the exporter; the exporter keeps its own guard
    # because it is also callable outside HTTP.
    fraction: float = Query(default=DEFAULT_SAMPLE_FRACTION, ge=0.0, le=1.0),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Export a 1-D soil profile through the section as a D-Sheet Piling ``.shi``.

    D-Sheet Piling models a retaining wall against ONE soil profile per
    side, so this export samples the section's drawn fill at a position
    along the line — mid-section unless ``fraction`` says otherwise — and
    writes that column's layer stack, named by unit identifier.

    Everything else a D-Sheet model needs (the wall itself, real water
    levels, surcharges, anchors) is written into the file's
    ``[RUN IDENTIFICATION]`` block as an explicit ``TODO``, never as an
    invented value.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    section_id : UUID
        Section to export. Must belong to ``project_id``.
    model_id : UUID
        Which model's units to name.
    request : SectionGeometryExportRequest
        The section's drawn partition fill.
    fraction : float
        Where along the section line to sample, ``0.0`` at the section's
        start endpoint and ``1.0`` at its end. Defaults to mid-section.

    Returns
    -------
    Response
        ``application/octet-stream`` body with a
        ``Content-Disposition`` header proposing a ``<section>.shi``
        filename.

    Raises
    ------
    HTTPException(404)
        When section / model / project resolution fails.
    HTTPException(400)
        When the section carries a non-metric CRS.
    HTTPException(422)
        ``code = "dsheetpiling_export_refused"`` when nothing is drawn
        at the sampled position.
    """
    logger.info(
        f"POST /projects/{project_id}/sections/{section_id}/export/dsheetpiling "
        f"(model={model_id}, fraction={fraction}, regions={len(request.partition.regions)})"
    )
    polygons = await _build_export_polygons(session, project_id, section_id, model_id, request)
    try:
        payload = DSheetPilingExporter().export(polygons, fraction=fraction)
    except ValueError as exc:
        raise _refuse_empty_geometry(exc, "dsheetpiling_export_refused") from exc
    return export_response(
        ExportArtifact.build(
            content=payload,
            name=polygons.section_name,
            fallback="section",
            suffix=".shi",
            media_type="application/octet-stream",
        )
    )
