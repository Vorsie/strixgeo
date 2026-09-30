"""Core restore pipeline phases for the bundle round-trip.

Handles CPTs, boreholes, geological formations,
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
_build_valid_formation_ids
    Return the union of DB + payload formation ids for FK guards.
_build_valid_model_ids
    Return the union of DB + payload model ids for FK guards.
_restore_cross_sections
    Insert cross-section rows, deferring the companion_body_id FK.
_restore_investigation_reviews
    Insert investigation review rows with target-entity validation.
_restore_project_bundle_impl
    Top-level orchestrator: project shell → CPTs → boreholes →
    formations → models → sections → reviews →
    bodies → absences → edges → shapes/nodes → flush.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.bed_override_orm import BedOverrideOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.investigation_review_orm import InvestigationReviewOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Re-export BundleIntegrityError here so bundle_restore_core callers (and the
# facade) can import it from either location; the canonical definition lives in
# bundle_build.py.
from .bundle_build import BundleIntegrityError
from .bundle_lab_series import attach_lab_series_trees
from .bundle_restore_drops import BundleRestoreDrops
from .bundle_restore_litho import (
    _attach_companion_body_links,
    _attach_sample_body_links,
    _restore_bodies,
    _restore_body_separations,
    _restore_body_unions,
    _restore_contact_edges,
    _restore_formation_absences,
    _restore_geological_models,
    _restore_geometry_facts,
    _restore_lens_shapes_and_nodes,
    _restore_litho_solids,
    _restore_tie_tombstones,
)
from .bundle_row_builders import _build_borehole, _build_cpt, _series_row_count, _uuid
from .bundle_serialization import _MAX_CPT_SERIES_ROWS, _apply_json_to_kwargs

__all__ = [
    "BundleIntegrityError",
    "_wipe_project_scoped_rows",
    "_restore_cpts",
    "_restore_boreholes",
    "_restore_formations",
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
      lithostratigraphic → geological — because ``parent_model_id``
      is ``ON DELETE RESTRICT`` (a child model pins its parent). Each model
      delete CASCADEs to its formation contacts, contact-correlation edges,
      lens metadata, and lens shapes (→ boundary nodes).
    * ``geological_formation`` next — CASCADEs to any remaining formation
      contacts, formation absences, and formation-scoped lens rows.
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
    await session.execute(delete(BedOverrideOrm).where(BedOverrideOrm.app_project_id == project_id))
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
    drops: BundleRestoreDrops | None = None,
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
    drops : BundleRestoreDrops | None, optional
        When provided, each dropped over-cap series adds one to
        ``cpt_series_dropped`` so the restore response can surface it (L6).

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
            if drops is not None:
                drops.cpt_series_dropped += 1
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
    drops: BundleRestoreDrops | None = None,
) -> tuple[int, dict[UUID, UUID]]:
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
    drops : BundleRestoreDrops | None, optional
        Threaded to ``_build_borehole`` so capped child-array drops accumulate
        into the tally (L6).

    Returns
    -------
    int
        Number of borehole rows newly inserted.
    """
    # ``{sample.id: body.id}`` stamps stripped on insert; Phase 8c re-attaches them.
    deferred_sample_body_links: dict[UUID, UUID] = {}
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
        borehole = _build_borehole(
            bh_payload,
            project_id,
            logger=logger,
            drops=drops,
            deferred_sample_body_links=deferred_sample_body_links,
        )
        # The raw lab-series family nests four levels under each sample, so it
        # is attached here rather than inside the flat sample builder.
        attach_lab_series_trees(borehole, bh_payload, logger=logger, drops=drops)
        session.add(borehole)
        new_boreholes += 1
        logger.debug(f"[{i}/{total}] borehole {bh_id} queued for insert")
    logger.info(
        f"borehole restore: {new_boreholes} new, {skipped} skipped (of {total}) for project {project_id}"  # noqa: E501
    )
    return new_boreholes, deferred_sample_body_links


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
    # Formerly the generic _restore_flat_rows helper — its other clients
    # (geotech units, cross-sections) grew bespoke loops (guards / FK
    # deferral) and stopped calling it, so the abstraction is inlined
    # back into its one remaining caller.
    existing = set(
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
    inserted = 0
    for item in geological_formations_payload:
        item_id = _uuid(item.get("id"))
        if item_id is None or item_id in existing:
            continue
        kwargs = _apply_json_to_kwargs(GeologicalFormationOrm, item)
        kwargs["app_project_id"] = project_id
        session.add(GeologicalFormationOrm(**kwargs))
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


async def _build_valid_inv_ids(
    session: AsyncSession,
    project_id: UUID,
    cpts_payload: list[dict[str, Any]],
    boreholes_payload: list[dict[str, Any]],
) -> set[UUID]:
    """Return the union of DB-persisted + bundle-carried investigation ids.

    Mirrors ``_build_valid_formation_ids`` for investigations (CPTs + boreholes).
    Must be called AFTER the CPT and borehole insert phases so the DB query
    covers rows committed in this transaction. Payload ids are unioned in to
    cover investigations queued-but-not-yet-flushed when downstream phases
    (contacts, absences, bodies) validate their investigation FK references.

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project_id : UUID
        Owning project.
    cpts_payload : list[dict[str, Any]]
        Raw CPT dicts from the bundle.
    boreholes_payload : list[dict[str, Any]]
        Raw borehole dicts from the bundle.

    Returns
    -------
    set[UUID]
        All valid CPT + borehole ids for this project (DB rows ∪ payload ids).
    """
    db_cpt_ids = set(
        (await session.execute(select(CptOrm.id).where(CptOrm.app_project_id == project_id)))
        .scalars()
        .all()
    )
    db_bh_ids = set(
        (
            await session.execute(
                select(BoreholeOrm.id).where(BoreholeOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    payload_cpt_ids = {_uuid(c.get("id")) for c in cpts_payload if c.get("id") is not None} - {None}
    payload_bh_ids = {_uuid(b.get("id")) for b in boreholes_payload if b.get("id") is not None} - {
        None
    }
    return db_cpt_ids | db_bh_ids | payload_cpt_ids | payload_bh_ids  # type: ignore[return-value]


async def _restore_cross_sections(
    session: AsyncSession,
    project_id: UUID,
    cross_sections_payload: list[dict[str, Any]],
) -> tuple[int, dict[UUID, UUID]]:
    """Insert cross-section rows from the bundle, deferring the body FK (#196).

    ``cross_section.companion_body_id`` is an FK → ``body.id``, but bodies
    restore in a LATER phase (Phase 8) than sections (Phase 6). Inserting a
    body-companion section with that column set therefore FK-violates on flush
    on a cold restore. We strip the column here and return a
    ``{section_id: body_id}`` map so the caller re-attaches it after the bodies
    phase (see ``_attach_companion_body_links``). ``is_body_companion`` (a bool
    flag, not an FK) stays on the row so the companion is flagged immediately.

    This phase writes its own dedupe+insert loop rather than sharing
    ``_restore_formations``'s because of that deferral need — the same
    reason ``_restore_investigation_reviews`` carries its own loop.

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
        companion_id = _uuid(kwargs.pop("companion_body_id", None))
        if companion_id is not None:
            deferred[item_id] = companion_id
        session.add(CrossSectionOrm(**kwargs))
        inserted += 1
    return inserted, deferred


async def _restore_bed_overrides(
    session: AsyncSession,
    project_id: UUID,
    bed_overrides_payload: list[dict[str, Any]],
) -> int:
    """Insert bed-override rows from the bundle (idempotent, dedupe by id).

    Bed overrides are an independent project-scoped root with no cross-table
    FK, so this is a plain dedupe+insert loop (no deferral) — the same shape as
    ``_restore_investigation_reviews`` without the FK guard.

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project_id : UUID
        Owning project (URL-driven — wins over any id in a payload row).
    bed_overrides_payload : list[dict[str, Any]]
        Raw bed-override dicts from the bundle.

    Returns
    -------
    int
        Number of rows inserted (existing ids are skipped).
    """
    existing = set(
        (
            await session.execute(
                select(BedOverrideOrm.id).where(BedOverrideOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    inserted = 0
    for item in bed_overrides_payload:
        item_id = _uuid(item.get("id"))
        if item_id is None or item_id in existing:
            continue
        kwargs = _apply_json_to_kwargs(BedOverrideOrm, item)
        kwargs["app_project_id"] = project_id
        session.add(BedOverrideOrm(**kwargs))
        inserted += 1
    return inserted


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
        # FIX 4: allow-list before the id-scope dispatch.  Without this, an
        # unknown kind (e.g. a garbage string from a crafted bundle) falls
        # through to the ``else`` branch → valid_bh_ids.  If the garbage-kind
        # review carries a locally-valid borehole id it passes the id-scope
        # check and reaches the INSERT, where the DB CHECK constraint
        # (``target_kind IN ('cpt', 'borehole')``) fires → IntegrityError →
        # the whole restore 500s.  The allow-list guard drops the row cleanly
        # before any DB interaction.
        if target_kind not in ("cpt", "borehole"):
            logger.warning(
                f"restore_project_bundle({project_id}): dropping review {r_id} "
                f"with unknown target_kind {target_kind!r} — "
                "allow-listed kinds are 'cpt' and 'borehole'"
            )
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
    bodies_payload: list[dict[str, Any]] | None = None,
    formation_absences_payload: list[dict[str, Any]] | None = None,
    litho_contact_correlation_edges_payload: list[dict[str, Any]] | None = None,
    body_geometry_facts_payload: list[dict[str, Any]] | None = None,
    body_boundary_shapes_payload: list[dict[str, Any]] | None = None,
    body_boundary_nodes_payload: list[dict[str, Any]] | None = None,
    litho_solids_payload: list[dict[str, Any]] | None = None,
    # NEW COLLECTIONS GO HERE, AT THE END: ProjectBundleService.restore
    # forwards positionally, so inserting a parameter mid-list silently
    # shifts every later payload into the wrong restorer (found the hard way
    # — a boundary shape restored as a "tombstone" and was dropped).
    geotech_tie_tombstones_payload: list[dict[str, Any]] | None = None,
    body_separations_payload: list[dict[str, Any]] | None = None,
    body_unions_payload: list[dict[str, Any]] | None = None,
    bed_overrides_payload: list[dict[str, Any]] | None = None,
    *,
    logger: GroundModelLogger,
    replace: bool = False,
    drops: BundleRestoreDrops | None = None,
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
    bodies_payload : list[dict[str, Any]] | None
        Body (lens) rows.
    formation_absences_payload : list[dict[str, Any]] | None
        Formation-absence rows.
    litho_contact_correlation_edges_payload : list[dict[str, Any]] | None
        Litho contact correlation edge rows.
    geotech_tie_tombstones_payload : list[dict[str, Any]] | None
        Deleted packing ties, keyed by place (owner 2026-08-17); absent in
        bundles saved before 2026-08-17 → empty.
    body_geometry_facts_payload : list[dict[str, Any]] | None
        Geometric body-connectivity fact rows (owner ruling 2026-08-12) —
        restored after litho layers, unioned by the post-restore resolver.
    body_separations_payload : list[dict[str, Any]] | None
        User "Separate" rulings (owner 2026-08-31, debt #278 R5) — cannot-link
        layer pairs restored after litho layers, honoured by the post-restore
        resolver; absent in bundles saved before 2026-08-31 → empty.
    body_unions_payload : list[dict[str, Any]] | None
        User "Join with…" rulings (owner 2026-08-31, debt #278) — must-link
        layer pairs restored after litho layers, honoured by the post-restore
        resolver; absent in bundles saved before 2026-08-31 → empty.
    body_boundary_shapes_payload : list[dict[str, Any]] | None
        Lens boundary shape rows.
    body_boundary_nodes_payload : list[dict[str, Any]] | None
        Lens boundary node rows.
    litho_solids_payload : list[dict[str, Any]] | None
        Cached watertight body-solid rows (watertight-loft Task 9). ``None``
        → empty (legacy bundle without the ``litho_solids`` key).
    logger : GroundModelLogger
        Caller's typed logger.
    replace : bool
        When ``True``, wipe the project's child collections before
        inserting (revert-to-last-save, debt #160) — the project ends
        up matching the bundle exactly.  When ``False`` (default),
        existing rows are skipped; the open-from-file path.
    drops : BundleRestoreDrops | None
        Mutable tally the caller passes in to learn how many CPT series and
        borehole child rows the size caps dropped, so the restore response can
        surface them (L6). Mutated in place; ``None`` to not track.

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
    bodies_payload = bodies_payload or []
    formation_absences_payload = formation_absences_payload or []
    litho_contact_correlation_edges_payload = litho_contact_correlation_edges_payload or []
    body_geometry_facts_payload = body_geometry_facts_payload or []
    geotech_tie_tombstones_payload = geotech_tie_tombstones_payload or []
    body_separations_payload = body_separations_payload or []
    body_unions_payload = body_unions_payload or []
    body_boundary_shapes_payload = body_boundary_shapes_payload or []
    body_boundary_nodes_payload = body_boundary_nodes_payload or []
    # Legacy tolerance: a bundle saved before the litho_solids field existed
    # has no such key, so the caller passes None → empty list (never KeyError).
    litho_solids_payload = litho_solids_payload or []
    # Legacy tolerance: bundles saved before bed overrides existed have no such
    # key — the caller passes None → empty list, so an old .gmproj restores with
    # no bed overrides rather than a KeyError (owner ruling 2026-09-06).
    bed_overrides_payload = bed_overrides_payload or []

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
        # ---- Sync the ORM identity map to the wiped DB state (debt #193) ---
        # ``_wipe_project_scoped_rows`` deletes via Core ``delete()``: the rows
        # are gone at the DB level, but their ORM instances are NOT evicted
        # from this session's identity map (a Core bulk delete never touches
        # it). If the SAME session had already loaded any wiped row — every
        # build→replace-restore round-trip on one session does, because
        # ``build_project_bundle`` ``selectin``-loads ``litho_layers`` and
        # ``contacts`` — the stale persistent instance lingers and collides
        # with the identical id the restore re-inserts below. The FC↔LL mirror
        # makes ``litho_layer.id`` equal its ``formation_contact.id``, so the
        # payload-staged pending ``LithoLayerOrm`` shares its key with the
        # stale one and SQLAlchemy warns "New instance ... conflicts with
        # persistent instance" + "Identity map already had an identity ...".
        # Evict every instance, then re-attach the project shell: the wipe
        # preserves the project row, and the rest of the restore plus the
        # endpoint's post-commit ``refresh(project)`` still need it in-session.
        # A fresh per-request session (the production restore endpoint) has
        # nothing loaded to evict, so this is a no-op there.
        session.expunge_all()
        session.add(project)

    # ---- Phase 1: CPTs ---------------------------------------------------
    new_cpts = await _restore_cpts(session, project_id, cpts_payload, logger=logger, drops=drops)

    # ---- Phase 2: Boreholes ----------------------------------------------
    new_boreholes, deferred_sample_body_links = await _restore_boreholes(
        session, project_id, boreholes_payload, logger=logger, drops=drops
    )

    # ---- Pre-phase guard: build valid_inv_ids ----------------------------
    # Built AFTER CPTs (Phase 1) and boreholes (Phase 2) so the DB query
    # covers all rows for this project.  Payload ids are unioned in to cover
    # investigations queued-but-not-yet-flushed when downstream phases
    # (contacts, absences, bodies) validate their investigation FK references.
    valid_inv_ids = await _build_valid_inv_ids(session, project_id, cpts_payload, boreholes_payload)

    # ---- Phase 3: Geological formations ----------------------------------
    new_formations = await _restore_formations(session, project_id, geological_formations_payload)

    # ---- Pre-phase guard: build valid_formation_ids ----------------------
    # Computed AFTER formations (Phase 3) so the payload-id union covers rows
    # that are queued-not-yet-flushed.  Used by Phase 5 (geological models +
    # nested contacts/surfaces/layers).
    valid_formation_ids = await _build_valid_formation_ids(
        session, project_id, geological_formations_payload
    )

    # ---- Phase 5: Geological models + nested contacts / surfaces / layers -
    new_models, new_contacts = await _restore_geological_models(
        session,
        project_id,
        geological_models_payload,
        valid_formation_ids,
        valid_inv_ids,
        logger=logger,
    )

    # ---- Phase 6: Cross-sections -----------------------------------------
    # companion_body_id is deferred (FK → body, which restores in Phase 8).
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
        valid_inv_ids,
        valid_formation_ids,
        valid_model_ids,
        logger=logger,
    )

    # ---- Phase 8b: Re-attach deferred companion-body links (#196) --------
    # Now bodies exist, set the cross_section.companion_body_id FKs that
    # Phase 6 stripped to avoid the cold-restore FK violation.
    reattached_companions = await _attach_companion_body_links(
        session, project_id, deferred_companion_links, logger=logger
    )
    # ---- Phase 8c: Re-attach deferred sample body stamps ------------------
    # ``sample.geotech_body_id`` (Divide boreholes) is an FK → body; Phase 2
    # stripped it. A stamp whose body is not in the restored project is a stale
    # window left by a re-minted body id: dropped to NULL and counted.
    reattached_sample_stamps = await _attach_sample_body_links(
        session, project_id, deferred_sample_body_links, logger=logger, drops=drops
    )
    logger.info(
        f"restore_project_bundle({project_id}): {reattached_sample_stamps} sample body "
        f"stamp(s) re-attached, "
        f"{len(deferred_sample_body_links) - reattached_sample_stamps} dropped"
    )

    # ---- Phase 9: Formation absences -------------------------------------
    new_absences, skipped_absences, dropped_absences = await _restore_formation_absences(
        session,
        project_id,
        formation_absences_payload,
        valid_formation_ids,
        valid_inv_ids,
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

    # ---- Phase 10b: Body geometry facts -----------------------------------
    # After the litho layers (both endpoints FK litho_layer.id) and before the
    # route's reconcile_bodies_after_restore, so the restored resolver run
    # already unions the facts (owner ruling 2026-08-12).
    new_facts, skipped_facts, dropped_facts = await _restore_geometry_facts(
        session,
        project_id,
        body_geometry_facts_payload,
        valid_model_ids,
        geological_models_payload,
        logger=logger,
    )

    # ---- Phase 10c: Deleted-tie tombstones --------------------------------
    # The engineer's deleted packing ties (owner 2026-08-17), keyed by place.
    # No layer FKs — only model + section — so ordering needs nothing beyond
    # the models and sections being in.
    new_tombstones, skipped_tombstones, dropped_tombstones = await _restore_tie_tombstones(
        session,
        project_id,
        geotech_tie_tombstones_payload,
        valid_model_ids,
        logger=logger,
    )

    # ---- Phase 10d: User "Separate" rulings -------------------------------
    # After the litho layers (both anchors FK litho_layer.id) and before the
    # route's reconcile_bodies_after_restore, so the restored resolver run
    # already honours the cannot-link and the two bodies stay split (owner
    # 2026-08-31, debt #278 R5 — the ruling is "permanent").
    new_separations, skipped_separations, dropped_separations = await _restore_body_separations(
        session,
        project_id,
        body_separations_payload,
        valid_model_ids,
        geological_models_payload,
        logger=logger,
    )

    # ---- Phase 10e: User "Join with…" rulings -----------------------------
    # After the litho layers (both anchors FK litho_layer.id) and AFTER the
    # separations (Phase 10d) but before the route's reconcile_bodies_after_restore,
    # so the restored resolver run honours the must-link and the two bodies stay
    # merged (owner 2026-08-31, debt #278). A union contradicting a restored
    # separation is suppressed by that resolver, never by this restore.
    new_unions, skipped_unions, dropped_unions = await _restore_body_unions(
        session,
        project_id,
        body_unions_payload,
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

    # ---- Phase 12: Cached watertight body solids (watertight-loft Task 9) -
    # Restored last among litho phases — both FK targets (model_id,
    # formation_id) are guaranteed present (Phase 3 formations + Phase 5
    # models), so the valid-id sets are complete.
    new_solids, skipped_solids, dropped_solids = await _restore_litho_solids(
        session,
        litho_solids_payload,
        valid_model_ids,
        valid_formation_ids,
        logger=logger,
    )

    # ---- Phase 13: Bed overrides -----------------------------------------
    # Independent project-scoped root (no cross-table FK), like cross-sections.
    new_bed_overrides = await _restore_bed_overrides(session, project_id, bed_overrides_payload)

    await session.flush()
    logger.info(
        f"restore_project_bundle({project_id}): "
        f"+{new_cpts} CPTs, +{new_boreholes} boreholes, "
        f"+{new_formations} formations, "
        f"+{new_models} models (+{new_contacts} contacts), "
        f"+{new_sections} sections ({reattached_companions} companion links re-attached), "
        f"+{new_reviews} reviews ({dropped_reviews} dropped as orphan), "
        f"+{new_contact_edges} litho contact edges "
        f"({skipped_contact_edges} skipped, {dropped_contact_edges} dropped), "
        f"+{new_lenses} lenses ({skipped_lenses} skipped, {dropped_lenses} dropped), "
        f"+{new_absences} formation absences "
        f"({skipped_absences} skipped, {dropped_absences} dropped), "
        f"+{new_solids} litho body solids "
        f"({skipped_solids} skipped, {dropped_solids} dropped), "
        f"+{new_bed_overrides} bed overrides"
    )
    return project
