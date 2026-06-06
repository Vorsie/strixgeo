"""Core restore pipeline phases for the bundle round-trip.

Handles CPTs, boreholes, geological formations, geotechnical units,
cross-sections, investigation reviews, and the top-level
``_restore_project_bundle_impl`` orchestrator that calls every phase
(including the litho-specific phases from ``bundle_restore_litho``).

All helpers accept an open async session and operate within the
caller's transaction — none commit independently.

Functions
---------
_wipe_project_scoped_rows
    Delete every project-scoped child collection, keeping the project
    shell (backs replace-restore / revert-to-last-save).
_restore_cpts
    Insert CPT rows from the bundle, skipping existing ids.
_restore_boreholes
    Insert borehole rows with their full child tree.
_restore_formations
    Insert geological formation rows.
_restore_geotech_units
    Insert geotechnical unit rows (FK to formations).
_restore_flat_rows
    Generic dedup+insert loop shared by formations, geotech units, and
    cross-sections.
_build_valid_formation_ids
    Return the union of DB + payload formation ids for FK guards.
_build_valid_model_ids
    Return the union of DB + payload model ids for FK guards.
_restore_cross_sections
    Insert cross-section rows, deferring the companion_lens_id FK.
_restore_investigation_reviews
    Insert investigation review rows with target-entity validation.
_restore_project_bundle_impl
    Top-level orchestrator: project shell → CPTs → boreholes →
    formations → geotech units → models → sections → reviews →
    bodies → absences → edges → shapes/nodes → flush.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.geotechnical_unit_orm import GeotechnicalUnitOrm
from groundmodel.infrastructure.db.models.investigation_review_orm import InvestigationReviewOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Re-export BundleIntegrityError here so bundle_restore_core callers (and the
# facade) can import it from either location; the canonical definition lives in
# bundle_build.py.
from .bundle_build import BundleIntegrityError
from .bundle_restore_litho import (
    _attach_companion_lens_links,
    _restore_bodies,
    _restore_contact_edges,
    _restore_formation_absences,
    _restore_geological_models,
    _restore_lens_shapes_and_nodes,
)
from .bundle_row_builders import _build_borehole, _build_cpt, _series_row_count, _uuid
from .bundle_serialization import _MAX_CPT_SERIES_ROWS, _apply_json_to_kwargs

__all__ = [
    "BundleIntegrityError",
    "_wipe_project_scoped_rows",
    "_restore_cpts",
    "_restore_boreholes",
    "_restore_formations",
    "_restore_geotech_units",
    "_restore_flat_rows",
    "_build_valid_formation_ids",
    "_build_valid_model_ids",
    "_restore_cross_sections",
    "_restore_investigation_reviews",
    "_restore_project_bundle_impl",
]


async def _wipe_project_scoped_rows(
    session: AsyncSession,
    project_id: UUID,
    *,
    logger: GroundModelLogger,
) -> None:
    """Delete every project-scoped child collection, keeping the project shell.

    Backs replace-restore (revert-to-last-save, debt #160): after the wipe the
    idempotent restore insert re-materialises the whole bundle against an empty
    project, so a close-without-save reverts creates, mutations, AND deletes.

    Order is FK-safe and relies on the verified DB-level ``ON DELETE CASCADE``
    map (bulk ``delete()`` fires DB cascades, not ORM-relationship cascades):

    * ``geological_model`` is deleted by ``kind`` — geotechnical →
      lithostratigraphic → geological — because ``parent_geological_model_id``
      is ``ON DELETE RESTRICT`` (a child model pins its parent). Each model
      delete CASCADEs to its formation contacts, contact-correlation edges,
      lens metadata, and lens shapes (→ boundary nodes).
    * ``geological_formation`` next — CASCADEs to any remaining formation
      contacts, geotechnical units, formation absences, and formation-scoped
      lens rows.
    * ``cross_section`` / ``investigation_review`` / ``cpt`` / ``borehole`` are
      independent project-scoped roots; deleting a cpt/borehole CASCADEs to its
      series / child tree and to contacts anchored on it.

    The project row itself is preserved — metadata revert is handled by the
    separate metadata two-stage-save model. Runs in the caller's session;
    wipe + insert + the caller's single commit are atomic.

    Parameters
    ----------
    session : AsyncSession
        Async session whose transaction also carries the subsequent insert.
    project_id : UUID
        Project whose child collections are removed.
    logger : GroundModelLogger
        Logger for the phase-summary line.
    """
    for kind in ("geotechnical", "lithostratigraphic", "geological"):
        await session.execute(
            delete(GeologicalModelOrm).where(
                GeologicalModelOrm.app_project_id == project_id,
                GeologicalModelOrm.kind == kind,
            )
        )
    await session.execute(
        delete(GeologicalFormationOrm).where(GeologicalFormationOrm.app_project_id == project_id)
    )
    await session.execute(
        delete(CrossSectionOrm).where(CrossSectionOrm.app_project_id == project_id)
    )
    await session.execute(
        delete(InvestigationReviewOrm).where(InvestigationReviewOrm.app_project_id == project_id)
    )
    await session.execute(delete(CptOrm).where(CptOrm.app_project_id == project_id))
    await session.execute(delete(BoreholeOrm).where(BoreholeOrm.app_project_id == project_id))
    await session.flush()
    logger.info(f"replace-restore: wiped project-scoped rows for project {project_id}")


async def _restore_cpts(
    session: AsyncSession,
    project_id: UUID,
    cpts_payload: list[dict[str, Any]],
    *,
    logger: GroundModelLogger,
) -> int:
    """Insert CPT rows from the bundle, skipping ids that already exist.

    Debt #112: CPTs whose depth-series exceeds ``_MAX_CPT_SERIES_ROWS``
    are inserted without the series payload (the CPT appears on the map
    but depth data is absent) rather than failing the whole restore.

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project_id : UUID
        Owning project.
    cpts_payload : list[dict[str, Any]]
        Raw CPT dicts from the bundle.
    logger : GroundModelLogger
        Caller's logger (phase-summary + per-row debug).

    Returns
    -------
    int
        Number of CPT rows newly inserted.
    """
    existing = set(
        (await session.execute(select(CptOrm.id).where(CptOrm.app_project_id == project_id)))
        .scalars()
        .all()
    )
    new_cpts = 0
    skipped = 0
    total = len(cpts_payload)
    logger.info(f"restoring {total} cpt(s) for project {project_id}")
    for i, cpt_payload in enumerate(cpts_payload, start=1):
        cpt_id = _uuid(cpt_payload.get("id"))
        if cpt_id is None:
            logger.debug(f"[{i}/{total}] cpt skipped — payload has no id")
            skipped += 1
            continue
        if cpt_id in existing:
            logger.debug(f"[{i}/{total}] cpt {cpt_id} already present — skipped")
            skipped += 1
            continue
        n_rows = _series_row_count(cpt_payload)
        if n_rows is not None and n_rows > _MAX_CPT_SERIES_ROWS:
            logger.warning(
                f"[{i}/{total}] cpt {cpt_id}: series has {n_rows} rows "
                f"(cap {_MAX_CPT_SERIES_ROWS}) — series dropped (debt #112)"
            )
            cpt_payload = {k: v for k, v in cpt_payload.items() if k != "series"}
        session.add(_build_cpt(cpt_payload, project_id))
        new_cpts += 1
        logger.debug(f"[{i}/{total}] cpt {cpt_id} queued for insert")
    logger.info(
        f"cpt restore: {new_cpts} new, {skipped} skipped (of {total}) for project {project_id}"
    )
    return new_cpts


async def _restore_boreholes(
    session: AsyncSession,
    project_id: UUID,
    boreholes_payload: list[dict[str, Any]],
    *,
    logger: GroundModelLogger,
) -> int:
    """Insert borehole rows (with full child tree) from the bundle.

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project_id : UUID
        Owning project.
    boreholes_payload : list[dict[str, Any]]
        Raw borehole dicts from the bundle, each carrying nested drill
        segments, field-log intervals, observations, and samples.
    logger : GroundModelLogger
        Caller's logger.

    Returns
    -------
    int
        Number of borehole rows newly inserted.
    """
    existing = set(
        (
            await session.execute(
                select(BoreholeOrm.id).where(BoreholeOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    new_boreholes = 0
    skipped = 0
    total = len(boreholes_payload)
    logger.info(f"restoring {total} borehole(s) for project {project_id}")
    for i, bh_payload in enumerate(boreholes_payload, start=1):
        bh_id = _uuid(bh_payload.get("id"))
        if bh_id is None:
            logger.debug(f"[{i}/{total}] borehole skipped — payload has no id")
            skipped += 1
            continue
        if bh_id in existing:
            logger.debug(f"[{i}/{total}] borehole {bh_id} already present — skipped")
            skipped += 1
            continue
        session.add(_build_borehole(bh_payload, project_id, logger=logger))
        new_boreholes += 1
        logger.debug(f"[{i}/{total}] borehole {bh_id} queued for insert")
    logger.info(
        f"borehole restore: {new_boreholes} new, {skipped} skipped (of {total}) for project {project_id}"  # noqa: E501
    )
    return new_boreholes


async def _restore_formations(
    session: AsyncSession,
    project_id: UUID,
    geological_formations_payload: list[dict[str, Any]],
) -> int:
    """Insert geological formation rows from the bundle.

    Formations are project-scoped (not nested under a model) — each row
    carries its own id and is deduped against the DB.

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project_id : UUID
        Owning project.
    geological_formations_payload : list[dict[str, Any]]
        Raw formation dicts from the bundle.

    Returns
    -------
    int
        Number of formation rows newly inserted.
    """
    return await _restore_flat_rows(
        session, project_id, GeologicalFormationOrm, geological_formations_payload
    )


async def _restore_geotech_units(
    session: AsyncSession,
    project_id: UUID,
    geotechnical_units_payload: list[dict[str, Any]],
) -> int:
    """Insert geotechnical unit rows from the bundle.

    Flat array — each row carries its own ``geological_formation_id``.
    Restore order must be "formations first, then units" so the FK
    resolves (the caller ensures this ordering).

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project_id : UUID
        Owning project.
    geotechnical_units_payload : list[dict[str, Any]]
        Raw geotech unit dicts from the bundle.

    Returns
    -------
    int
        Number of unit rows newly inserted.
    """
    return await _restore_flat_rows(
        session, project_id, GeotechnicalUnitOrm, geotechnical_units_payload
    )


async def _restore_flat_rows(
    session: AsyncSession,
    project_id: UUID,
    orm_cls: type[Any],
    payload: list[dict[str, Any]],
) -> int:
    """Insert project-scoped ORM rows from the bundle, skipping existing ids.

    Shared by ``_restore_formations``, ``_restore_geotech_units``, and
    ``_restore_cross_sections`` — all three follow the identical pattern of
    deduping against the DB by id and inserting new rows with
    ``app_project_id`` injected.

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project_id : UUID
        Owning project (injected into every new row as ``app_project_id``).
    orm_cls : type[Any]
        The ORM class to instantiate (must have ``id`` + ``app_project_id``
        columns that ``_apply_json_to_kwargs`` maps to).
    payload : list[dict[str, Any]]
        Raw item dicts from the bundle.

    Returns
    -------
    int
        Number of rows newly inserted.
    """
    existing = set(
        (await session.execute(select(orm_cls.id).where(orm_cls.app_project_id == project_id)))
        .scalars()
        .all()
    )
    inserted = 0
    for item in payload:
        item_id = _uuid(item.get("id"))
        if item_id is None or item_id in existing:
            continue
        kwargs = _apply_json_to_kwargs(orm_cls, item)
        kwargs["app_project_id"] = project_id
        session.add(orm_cls(**kwargs))
        inserted += 1
    return inserted


async def _build_valid_formation_ids(
    session: AsyncSession,
    project_id: UUID,
    geological_formations_payload: list[dict[str, Any]],
) -> set[UUID]:
    """Return the union of DB-persisted + bundle-carried formation ids.

    Used by ``_restore_geological_models`` and later phases to decide
    whether a contact/layer/absence/unit formation reference is valid.
    Re-queries the DB after the formation insert phase so newly-queued
    rows are included.

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project_id : UUID
        Owning project.
    geological_formations_payload : list[dict[str, Any]]
        Raw formation dicts from the bundle (payload-level ids included
        even when not yet flushed, so edge-validation doesn't need a
        flush in between).

    Returns
    -------
    set[UUID]
        All valid formation ids for this project.
    """
    db_ids = set(
        (
            await session.execute(
                select(GeologicalFormationOrm.id).where(
                    GeologicalFormationOrm.app_project_id == project_id
                )
            )
        )
        .scalars()
        .all()
    )
    payload_ids = {
        _uuid(f.get("id")) for f in geological_formations_payload if f.get("id") is not None
    } - {None}
    return db_ids | payload_ids  # type: ignore[return-value]


async def _build_valid_model_ids(
    session: AsyncSession,
    project_id: UUID,
    geological_models_payload: list[dict[str, Any]],
) -> set[UUID]:
    """Return the union of DB-persisted + bundle-carried geological model ids.

    Mirrors ``_build_valid_formation_ids``: avoids a mid-transaction autoflush
    by unioning already-in-DB ids with payload ids known at parse time.  Used
    by phases that follow the model-insert phase (bodies, absences, contact
    edges, etc.) to gate FK-guard checks without forcing SQLAlchemy to flush
    all pending model rows.

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project_id : UUID
        Owning project.
    geological_models_payload : list[dict[str, Any]]
        Raw geological model dicts from the bundle.

    Returns
    -------
    set[UUID]
        All valid geological model ids for this project.
    """
    db_ids = set(
        (
            await session.execute(
                select(GeologicalModelOrm.id).where(GeologicalModelOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    payload_ids = {
        _uuid(m.get("id")) for m in geological_models_payload if m.get("id") is not None
    } - {None}
    return db_ids | payload_ids  # type: ignore[return-value]


async def _restore_cross_sections(
    session: AsyncSession,
    project_id: UUID,
    cross_sections_payload: list[dict[str, Any]],
) -> tuple[int, dict[UUID, UUID]]:
    """Insert cross-section rows from the bundle, deferring the body FK (#196).

    ``cross_section.companion_lens_id`` is an FK → ``body.id``, but bodies
    restore in a LATER phase (Phase 8) than sections (Phase 6). Inserting a
    lens-companion section with that column set therefore FK-violates on flush
    on a cold restore. We strip the column here and return a
    ``{section_id: body_id}`` map so the caller re-attaches it after the bodies
    phase (see ``_attach_companion_lens_links``). ``is_lens_companion`` (a bool
    flag, not an FK) stays on the row so the companion is flagged immediately.

    This phase writes its own dedupe+insert loop rather than going through
    ``_restore_flat_rows`` because of that deferral need — the same reason
    ``_restore_investigation_reviews`` carries its own loop.

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project_id : UUID
        Owning project.
    cross_sections_payload : list[dict[str, Any]]
        Raw cross-section dicts from the bundle.

    Returns
    -------
    tuple[int, dict[UUID, UUID]]
        ``(inserted, deferred_companion_links)`` — the second is a map of
        ``cross_section.id → companion body.id`` to re-attach after Phase 8.
    """
    existing = set(
        (
            await session.execute(
                select(CrossSectionOrm.id).where(CrossSectionOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    inserted = 0
    deferred: dict[UUID, UUID] = {}
    for item in cross_sections_payload:
        item_id = _uuid(item.get("id"))
        if item_id is None or item_id in existing:
            continue
        kwargs = _apply_json_to_kwargs(CrossSectionOrm, item)
        kwargs["app_project_id"] = project_id
        # Defer the body FK — bodies don't exist yet on a cold restore.
        companion_id = _uuid(kwargs.pop("companion_lens_id", None))
        if companion_id is not None:
            deferred[item_id] = companion_id
        session.add(CrossSectionOrm(**kwargs))
        inserted += 1
    return inserted, deferred


async def _restore_investigation_reviews(
    session: AsyncSession,
    project_id: UUID,
    investigation_reviews_payload: list[dict[str, Any]],
    *,
    logger: GroundModelLogger,
) -> tuple[int, int]:
    """Insert investigation review rows from the bundle.

    Reviews point at CPT or borehole rows via a polymorphic anchor.  The
    target is validated to exist in the project; orphan reviews are dropped
    with a warning so one bad row doesn't sabotage the whole restore.

    Target validation queries the DB so it runs after CPTs and boreholes
    have been inserted (caller ensures ordering).

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project_id : UUID
        Owning project.
    investigation_reviews_payload : list[dict[str, Any]]
        Raw review dicts from the bundle.
    logger : GroundModelLogger
        Caller's logger (orphan-drop warnings).

    Returns
    -------
    tuple[int, int]
        ``(new_reviews, dropped_reviews)``.
    """
    valid_cpt_ids = set(
        (await session.execute(select(CptOrm.id).where(CptOrm.app_project_id == project_id)))
        .scalars()
        .all()
    )
    valid_bh_ids = set(
        (
            await session.execute(
                select(BoreholeOrm.id).where(BoreholeOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    existing = set(
        (
            await session.execute(
                select(InvestigationReviewOrm.id).where(
                    InvestigationReviewOrm.app_project_id == project_id
                )
            )
        )
        .scalars()
        .all()
    )
    new_reviews = 0
    dropped = 0
    for r_payload in investigation_reviews_payload:
        r_id = _uuid(r_payload.get("id"))
        if r_id is None or r_id in existing:
            continue
        target_kind = r_payload.get("target_kind")
        target_id = _uuid(r_payload.get("target_id"))
        if target_kind is None or target_id is None:
            dropped += 1
            continue
        valid_targets = valid_cpt_ids if target_kind == "cpt" else valid_bh_ids
        if target_id not in valid_targets:
            logger.warning(
                f"restore_project_bundle({project_id}): dropping orphan "
                f"review row {r_id} → {target_kind} {target_id} (target not present in this project)"  # noqa: E501
            )
            dropped += 1
            continue
        kwargs = _apply_json_to_kwargs(InvestigationReviewOrm, r_payload)
        kwargs["app_project_id"] = project_id
        session.add(InvestigationReviewOrm(**kwargs))
        new_reviews += 1
    return new_reviews, dropped


async def _restore_project_bundle_impl(
    session: AsyncSession,
    project_id: UUID,
    project_payload: dict[str, Any],
    cpts_payload: list[dict[str, Any]],
    boreholes_payload: list[dict[str, Any]],
    geological_formations_payload: list[dict[str, Any]] | None = None,
    geological_models_payload: list[dict[str, Any]] | None = None,
    cross_sections_payload: list[dict[str, Any]] | None = None,
    investigation_reviews_payload: list[dict[str, Any]] | None = None,
    geotechnical_units_payload: list[dict[str, Any]] | None = None,
    bodies_payload: list[dict[str, Any]] | None = None,
    formation_absences_payload: list[dict[str, Any]] | None = None,
    litho_contact_correlation_edges_payload: list[dict[str, Any]] | None = None,
    body_boundary_shapes_payload: list[dict[str, Any]] | None = None,
    body_boundary_nodes_payload: list[dict[str, Any]] | None = None,
    *,
    logger: GroundModelLogger,
    replace: bool = False,
) -> ProjectOrm:
    """Idempotently materialise a project + every child collection from a bundle.

    Behaviour:

    * Project row missing → INSERT with the supplied id + metadata.
    * Project row present → return it as-is (don't mutate metadata; the
      DB version is authoritative when it exists).
    * Each CPT / borehole / formation / model / cross-section in the
      payload is inserted if its id is not already in the DB. Existing
      ids are skipped (no mutation). Idempotent across re-restores.
    * Formation contacts ride along with their parent model (nested
      under ``contacts`` in the payload).

    Backwards compatibility: every extra-tree kwarg defaults to ``None``
    so callers from older clients keep working — they just produce no
    rows for the missing sections.

    The ``project_id`` from the URL takes precedence over any id in the
    payload — that's what makes the endpoint URL-driven and prevents a
    crafted body from sneaking the wrong id past the router.

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project_id : UUID
        Canonical project id (URL-driven — wins over any id in the payload).
    project_payload : dict[str, Any]
        Raw project metadata dict from the bundle.
    cpts_payload : list[dict[str, Any]]
        CPT dicts from the bundle.
    boreholes_payload : list[dict[str, Any]]
        Borehole dicts (with full child tree) from the bundle.
    geological_formations_payload : list[dict[str, Any]] | None
        Formation rows; ``None`` → empty (legacy caller compat).
    geological_models_payload : list[dict[str, Any]] | None
        Model rows with nested contacts / surfaces / litho_layers.
    cross_sections_payload : list[dict[str, Any]] | None
        Cross-section rows.
    investigation_reviews_payload : list[dict[str, Any]] | None
        Per-(project, investigation) review rows.
    geotechnical_units_payload : list[dict[str, Any]] | None
        Geotechnical unit rows (FK to formations).
    bodies_payload : list[dict[str, Any]] | None
        Body (lens) rows.
    formation_absences_payload : list[dict[str, Any]] | None
        Formation-absence rows.
    litho_contact_correlation_edges_payload : list[dict[str, Any]] | None
        Litho contact correlation edge rows.
    body_boundary_shapes_payload : list[dict[str, Any]] | None
        Lens boundary shape rows.
    body_boundary_nodes_payload : list[dict[str, Any]] | None
        Lens boundary node rows.
    logger : GroundModelLogger
        Caller's typed logger.
    replace : bool
        When ``True``, wipe the project's child collections before
        inserting (revert-to-last-save, debt #160) — the project ends
        up matching the bundle exactly.  When ``False`` (default),
        existing rows are skipped; the open-from-file path.

    Returns
    -------
    ProjectOrm
        The project row (created or pre-existing).

    Raises
    ------
    BundleIntegrityError
        On ``replace=True`` when the bundle is self-inconsistent
        (contacts/layers reference formation ids absent from the bundle).
        Protects against silently wiping valid DB state for a broken file.
    """
    # Normalise None → [] so every phase helper can iterate without guard.
    geological_formations_payload = geological_formations_payload or []
    geological_models_payload = geological_models_payload or []
    cross_sections_payload = cross_sections_payload or []
    investigation_reviews_payload = investigation_reviews_payload or []
    geotechnical_units_payload = geotechnical_units_payload or []
    bodies_payload = bodies_payload or []
    formation_absences_payload = formation_absences_payload or []
    litho_contact_correlation_edges_payload = litho_contact_correlation_edges_payload or []
    body_boundary_shapes_payload = body_boundary_shapes_payload or []
    body_boundary_nodes_payload = body_boundary_nodes_payload or []

    # ---- Project shell ---------------------------------------------------
    result = await session.execute(select(ProjectOrm).where(ProjectOrm.id == project_id))
    project = result.scalar_one_or_none()
    if project is None:
        kwargs = _apply_json_to_kwargs(ProjectOrm, project_payload)
        kwargs["id"] = project_id
        kwargs.pop("archived_at", None)  # restore brings the project back active
        project = ProjectOrm(**kwargs)
        session.add(project)
        await session.flush()
        logger.info(f"restored project shell {project_id}")
    else:
        logger.info(f"project {project_id} already exists — leaving metadata untouched")

    # ---- Replace mode: pre-wipe integrity guard --------------------------
    # Revert-to-last-save (debt #160). Runs after the project shell is
    # resolved and before any insert, in this same transaction, so the net
    # effect is "project's children == the bundle exactly".
    #
    # Pre-wipe guard (2026-05-31): when the bundle is self-inconsistent
    # (layers/contacts reference formation_ids not in geological_formations),
    # the post-wipe insert would silently drop those rows as orphans.  The
    # non-replace open-from-file path stays tolerant so legacy bundles still
    # open; the destructive replace path must NOT wipe valid DB state to make
    # room for a broken file.  Count orphans up front → actionable error.
    if replace:
        bundle_fids: set[UUID] = {
            _uuid(f.get("id"))  # type: ignore[misc]
            for f in geological_formations_payload
            if f.get("id") is not None
        } - {None}

        orphan_layer_count = 0
        orphan_contact_count = 0
        orphan_fids: set[UUID] = set()
        for m_payload in geological_models_payload:
            for c in m_payload.get("contacts") or []:
                fid = _uuid(c.get("formation_id"))
                if fid is not None and fid not in bundle_fids:
                    orphan_contact_count += 1
                    orphan_fids.add(fid)
            for layer in m_payload.get("litho_layers") or []:
                fid = _uuid(layer.get("formation_id"))
                if fid is not None and fid not in bundle_fids:
                    orphan_layer_count += 1
                    orphan_fids.add(fid)
        for u_payload in geotechnical_units_payload:
            fid = _uuid(u_payload.get("formation_id"))
            if fid is not None and fid not in bundle_fids:
                orphan_fids.add(fid)
        if orphan_fids:
            sample = sorted(str(i) for i in list(orphan_fids)[:5])
            raise BundleIntegrityError(
                f"Replace-restore refused for project {project_id}: bundle "
                f"is self-inconsistent. "
                f"{orphan_layer_count} litho layer(s) and "
                f"{orphan_contact_count} formation contact(s) reference "
                f"{len(orphan_fids)} formation id(s) not present in the "
                f"bundle's geological_formations array. Wiping the DB to "
                f"match this bundle would silently drop those rows. "
                f"Sample missing formation ids: {sample}."
            )
        await _wipe_project_scoped_rows(session, project_id, logger=logger)

    # ---- Phase 1: CPTs ---------------------------------------------------
    new_cpts = await _restore_cpts(session, project_id, cpts_payload, logger=logger)

    # ---- Phase 2: Boreholes ----------------------------------------------
    new_boreholes = await _restore_boreholes(session, project_id, boreholes_payload, logger=logger)

    # ---- Phase 3: Geological formations ----------------------------------
    new_formations = await _restore_formations(session, project_id, geological_formations_payload)

    # ---- Phase 4: Geotechnical units (FK → formations) -------------------
    new_units = await _restore_geotech_units(session, project_id, geotechnical_units_payload)

    # ---- Pre-model validation set ----------------------------------------
    # Computed AFTER formations so newly-queued payload ids are included.
    valid_formation_ids = await _build_valid_formation_ids(
        session, project_id, geological_formations_payload
    )

    # ---- Phase 5: Geological models + nested contacts / surfaces / layers -
    new_models, new_contacts = await _restore_geological_models(
        session,
        project_id,
        geological_models_payload,
        valid_formation_ids,
        logger=logger,
    )

    # ---- Phase 6: Cross-sections -----------------------------------------
    # companion_lens_id is deferred (FK → body, which restores in Phase 8).
    new_sections, deferred_companion_links = await _restore_cross_sections(
        session, project_id, cross_sections_payload
    )

    # ---- Phase 7: Investigation reviews (FK → CPT / borehole) ------------
    new_reviews, dropped_reviews = await _restore_investigation_reviews(
        session, project_id, investigation_reviews_payload, logger=logger
    )

    # ---- Valid model ids for FK guards on subsequent phases --------------
    # Built from DB ids (pre-restore) + payload ids — mirrors
    # _build_valid_formation_ids to avoid a mid-transaction autoflush that
    # would materialise all pending model rows before the session commits.
    valid_model_ids = await _build_valid_model_ids(session, project_id, geological_models_payload)

    # ---- Phase 8: Bodies (lenses) ----------------------------------------
    new_lenses, skipped_lenses, dropped_lenses = await _restore_bodies(
        session,
        project_id,
        bodies_payload,
        cpts_payload,
        boreholes_payload,
        valid_formation_ids,
        valid_model_ids,
        logger=logger,
    )

    # ---- Phase 8b: Re-attach deferred companion-lens links (#196) --------
    # Now bodies exist, set the cross_section.companion_lens_id FKs that
    # Phase 6 stripped to avoid the cold-restore FK violation.
    reattached_companions = await _attach_companion_lens_links(
        session, project_id, deferred_companion_links, logger=logger
    )

    # ---- Phase 9: Formation absences -------------------------------------
    new_absences, skipped_absences, dropped_absences = await _restore_formation_absences(
        session,
        project_id,
        formation_absences_payload,
        valid_formation_ids,
        logger=logger,
    )

    # ---- Phase 10: Litho contact correlation edges -----------------------
    new_contact_edges, skipped_contact_edges, dropped_contact_edges = await _restore_contact_edges(
        session,
        project_id,
        litho_contact_correlation_edges_payload,
        valid_model_ids,
        geological_models_payload,
        logger=logger,
    )

    # ---- Phase 11: Lens boundary shapes + nodes --------------------------
    new_shapes, dropped_shapes, new_nodes, dropped_nodes = await _restore_lens_shapes_and_nodes(
        session,
        project_id,
        body_boundary_shapes_payload,
        body_boundary_nodes_payload,
        valid_model_ids,
        logger=logger,
    )

    await session.flush()
    logger.info(
        f"restore_project_bundle({project_id}): "
        f"+{new_cpts} CPTs, +{new_boreholes} boreholes, "
        f"+{new_formations} formations, +{new_units} geotech units, "
        f"+{new_models} models (+{new_contacts} contacts), "
        f"+{new_sections} sections ({reattached_companions} companion links re-attached), "
        f"+{new_reviews} reviews ({dropped_reviews} dropped as orphan), "
        f"+{new_contact_edges} litho contact edges "
        f"({skipped_contact_edges} skipped, {dropped_contact_edges} dropped), "
        f"+{new_lenses} lenses ({skipped_lenses} skipped, {dropped_lenses} dropped), "
        f"+{new_absences} formation absences "
        f"({skipped_absences} skipped, {dropped_absences} dropped)"
    )
    return project
