"""Litho-specific restore phases for the bundle pipeline.

Handles the geological models (with contacts, surfaces, and litho
layers), bodies (lateral extent entities), formation absences, contact
correlation edges, and lens boundary shapes + nodes.

All functions accept an open async session and operate within the
caller's transaction — none commit or flush independently.

Functions
---------
_restore_geological_models
    Insert model rows with nested contacts, surfaces, and litho layers.
_restore_bodies
    Insert body (lens) rows with FK integrity guards; extent fields are stripped.
_restore_formation_absences
    Insert formation-absence rows, skipping orphaned formation refs.
_restore_contact_edges
    Insert litho contact correlation edge rows.
_restore_lens_shapes_and_nodes
    Insert body-boundary shape + node rows.
_attach_companion_lens_links
    Re-attach deferred ``cross_section.companion_lens_id`` FKs after
    bodies have been inserted.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.body_boundary_node_orm import BodyBoundaryNodeOrm
from groundmodel.infrastructure.db.models.body_boundary_shape_orm import BodyBoundaryShapeOrm
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_absence_orm import FormationAbsenceOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.formation_surface_orm import FormationSurfaceOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.shared.constants.model_kind import MODEL_KIND_GEOLOGICAL, MODEL_KINDS
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

from .bundle_row_builders import _uuid, _validate_tin_payload
from .bundle_serialization import (
    _BODY_EXTENT_COLUMNS,
    _MAX_SURFACE_SOURCE_CONTACTS,
    _MAX_TIN_ARRAY_LEN,
    _apply_json_to_kwargs,
)

# Legacy aliases used by residual references (lens shapes / nodes sections
# still use the old names internally — renamed in slice 4).
LithoLensShapeOrm = BodyBoundaryShapeOrm
LithoLensBoundaryNodeOrm = BodyBoundaryNodeOrm


def _blank_surface_geometry(kwargs: dict[str, Any]) -> None:
    """Drop a restored surface's TIN geometry and force a rebuild.

    Mutates ``kwargs`` in place — empties ``vertices`` / ``triangles`` and
    sets ``is_stale=True``.  Shared by the size-cap and structural-validation
    guards in ``_restore_geological_models`` so a rejected surface row is
    still inserted (the formation keeps its surface metadata) but carries no
    untrusted geometry until the user rebuilds it.

    Parameters
    ----------
    kwargs : dict[str, Any]
        The ORM keyword dict for a ``FormationSurfaceOrm`` about to be built.
    """
    kwargs["vertices"] = []
    kwargs["triangles"] = []
    kwargs["is_stale"] = True


async def _restore_geological_models(
    session: AsyncSession,
    project_id: UUID,
    geological_models_payload: list[dict[str, Any]],
    valid_formation_ids: set[UUID],
    *,
    logger: GroundModelLogger,
) -> tuple[int, int]:
    """Insert geological model rows with nested contacts, surfaces, and layers.

    Behaviour per model:

    * Existing model id → skip the whole model (and all its nested rows).
      Mixing a live model with bundled contacts would silently merge two
      interpretations.
    * New model → insert with contacts filtered for valid formation refs,
      surfaces with TIN-blob size caps (debt #19), and litho layers with
      FC-trigger coexistence de-dupe.

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project_id : UUID
        Owning project.
    geological_models_payload : list[dict[str, Any]]
        Raw model dicts, each carrying nested ``contacts``, ``surfaces``,
        and ``litho_layers`` arrays.
    valid_formation_ids : set[UUID]
        Pre-computed union of DB + payload formation ids (from
        ``_build_valid_formation_ids``).
    logger : GroundModelLogger
        Caller's logger.

    Returns
    -------
    tuple[int, int]
        ``(new_models, new_contacts)`` — counts of inserted rows.
    """
    existing_model_ids = set(
        (
            await session.execute(
                select(GeologicalModelOrm.id).where(GeologicalModelOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    new_models = 0
    new_contacts = 0
    skipped_orphan_contacts = 0

    for m_payload in geological_models_payload:
        m_id = _uuid(m_payload.get("id"))
        if m_id is None or m_id in existing_model_ids:
            # Existing model wins — skip nested rows entirely.
            continue

        contacts_payload = m_payload.get("contacts") or []
        model_kwargs = _apply_json_to_kwargs(GeologicalModelOrm, m_payload)
        model_kwargs["app_project_id"] = project_id
        # Senior-review S6: ``kind`` is a plain VARCHAR with no DB CHECK.
        # Coerce unknown kinds to 'geological' (safe default — keeps
        # crossing validation active) and log loudly.
        bundled_kind = model_kwargs.get("kind")
        if bundled_kind is not None and bundled_kind not in MODEL_KINDS:
            logger.warning(
                f"restore: model {m_id} has unknown kind {bundled_kind!r} — coercing to 'geological'"  # noqa: E501
            )
            model_kwargs["kind"] = MODEL_KIND_GEOLOGICAL
        model = GeologicalModelOrm(**model_kwargs)

        # ---- Contacts ---------------------------------------------------
        valid_contacts: list[FormationContactOrm] = []
        for c in contacts_payload:
            fid = _uuid(c.get("formation_id"))
            if fid is None or fid not in valid_formation_ids:
                skipped_orphan_contacts += 1
                continue
            valid_contacts.append(
                FormationContactOrm(**_apply_json_to_kwargs(FormationContactOrm, c))
            )
        model.contacts = valid_contacts

        # ---- Surfaces (with TIN-blob size caps) --------------------------
        surfaces_payload = m_payload.get("surfaces") or []
        contacts_per_formation: dict[UUID, int] = {}
        for c in valid_contacts:
            contacts_per_formation[c.formation_id] = (
                contacts_per_formation.get(c.formation_id, 0) + 1
            )

        valid_surfaces: list[FormationSurfaceOrm] = []
        forced_stale = 0
        oversized_surfaces = 0
        malformed_surfaces = 0
        for s in surfaces_payload:
            fid = _uuid(s.get("formation_id"))
            if fid is None or fid not in valid_formation_ids:
                continue
            kwargs = _apply_json_to_kwargs(FormationSurfaceOrm, s)
            # Debt #19: cap untrusted TIN blobs — blank geometry + force
            # is_stale rather than letting an unbounded JSONB array OOM
            # the asyncio process.
            raw_verts = kwargs.get("vertices")
            raw_tris = kwargs.get("triangles")
            # A non-list (incl. None / a malformed scalar) has no meaningful
            # length — treat as 0 for the size-cap check so ``len`` cannot
            # raise; the structural check below rejects any *present* non-list.
            n_verts = len(raw_verts) if isinstance(raw_verts, list) else 0
            n_tris = len(raw_tris) if isinstance(raw_tris, list) else 0
            claimed_count = kwargs.get("source_contact_count")
            if (
                (claimed_count is not None and claimed_count > _MAX_SURFACE_SOURCE_CONTACTS)
                or n_verts > _MAX_TIN_ARRAY_LEN
                or n_tris > _MAX_TIN_ARRAY_LEN
            ):
                logger.warning(
                    f"restore_project_bundle({project_id}): surface for formation {fid} "
                    f"exceeds size caps (claimed={claimed_count}, verts={n_verts}, "
                    f"tris={n_tris}) — geometry dropped, is_stale forced"
                )
                _blank_surface_geometry(kwargs)
                oversized_surfaces += 1
                valid_surfaces.append(FormationSurfaceOrm(**kwargs))
                continue
            # Debt #112: structural validation — a malformed TIN triple
            # (wrong arity, non-finite / non-numeric coord, non-int or
            # out-of-range index, or a present-but-non-list array) would
            # crash the downstream slice/export code with an opaque error
            # long after the restore committed. Pass the RAW values so a
            # present non-list is caught (``None`` = not-yet-built = valid).
            # Blank + force-stale, same as the size-cap path above.
            if not _validate_tin_payload(raw_verts, raw_tris):
                logger.warning(
                    f"restore_project_bundle({project_id}): surface for formation {fid} "
                    f"has malformed TIN geometry (structural check failed) — "
                    f"geometry dropped, is_stale forced"
                )
                _blank_surface_geometry(kwargs)
                malformed_surfaces += 1
                valid_surfaces.append(FormationSurfaceOrm(**kwargs))
                continue
            # Force is_stale when the restored contact count disagrees
            # with the surface's claimed source_contact_count.
            actual = contacts_per_formation.get(fid, 0)
            claimed = kwargs.get("source_contact_count")
            if claimed is not None and claimed != actual:
                kwargs["is_stale"] = True
                forced_stale += 1
            valid_surfaces.append(FormationSurfaceOrm(**kwargs))
        if forced_stale:
            logger.info(
                f"restore_project_bundle({project_id}): forced is_stale=True on "
                f"{forced_stale} surface(s) — contact count drifted from saved source_contact_count"
            )
        if oversized_surfaces:
            logger.warning(
                f"restore_project_bundle({project_id}): dropped geometry on "
                f"{oversized_surfaces} surface(s) exceeding TIN size caps (debt #19) — rebuild required"  # noqa: E501
            )
        if malformed_surfaces:
            logger.warning(
                f"restore_project_bundle({project_id}): dropped geometry on "
                f"{malformed_surfaces} surface(s) with malformed TIN structure (debt #112) — rebuild required"  # noqa: E501
            )
        model.surfaces = valid_surfaces

        # ---- Litho layers (A4 Shape A) -----------------------------------
        # v4 bundles emit layers explicitly; v3 bundles do not — the
        # FC→LL trigger materialises them from the contacts that follow.
        # Coexistence: skip explicit INSERT for accepted layers whose id
        # matches a contact in contacts_payload — the trigger handles those.
        layers_payload = m_payload.get("litho_layers") or []
        contact_ids_in_payload = {
            _uuid(c.get("id")) for c in contacts_payload if c.get("id") is not None
        } - {None}

        valid_layers: list[LithoLayerOrm] = []
        skipped_orphan_layers = 0
        skipped_fc_trigger = 0
        for layer_payload in layers_payload:
            fid = _uuid(layer_payload.get("formation_id"))
            if fid is None or fid not in valid_formation_ids:
                skipped_orphan_layers += 1
                continue
            lid = _uuid(layer_payload.get("id"))
            if lid in contact_ids_in_payload:
                skipped_fc_trigger += 1
                continue
            layer_kwargs = _apply_json_to_kwargs(LithoLayerOrm, layer_payload)
            # body_id is re-stamped by the post-restore ResolveLithoInstances
            # pass — restoring it here would FK-violate, since bodies are
            # restored in a later phase (after every geological model).
            layer_kwargs.pop("body_id", None)
            valid_layers.append(LithoLayerOrm(**layer_kwargs))
        model.litho_layers = valid_layers
        if skipped_orphan_layers:
            logger.warning(
                f"restore_project_bundle({project_id}): skipped "
                f"{skipped_orphan_layers} orphan-formation litho layers (missing formation row in bundle)"  # noqa: E501
            )
        if skipped_fc_trigger:
            logger.debug(
                f"restore_project_bundle({project_id}): skipped explicit INSERT for "
                f"{skipped_fc_trigger} layers — FC→LL trigger materialises them from contact INSERTs"  # noqa: E501
            )

        session.add(model)
        new_models += 1
        new_contacts += len(valid_contacts)

    if skipped_orphan_contacts:
        logger.warning(
            f"restore_project_bundle({project_id}): skipped "
            f"{skipped_orphan_contacts} orphan-formation contacts (missing formation row in bundle)"
        )
    return new_models, new_contacts


async def _attach_companion_lens_links(
    session: AsyncSession,
    project_id: UUID,
    deferred_companion_links: dict[UUID, UUID],
    *,
    logger: GroundModelLogger,
) -> int:
    """Set the deferred ``cross_section.companion_lens_id`` now bodies exist (#196).

    Runs after the bodies phase. Re-queries the project's body ids (forcing an
    autoflush of the pending body inserts) so a link whose body was dropped /
    skipped during restore is logged and left NULL rather than FK-violating.

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project_id : UUID
        Owning project.
    deferred_companion_links : dict[UUID, UUID]
        ``{cross_section.id: companion body.id}`` from ``_restore_cross_sections``.
    logger : GroundModelLogger
        Caller's logger (dangling-link warnings).

    Returns
    -------
    int
        Number of companion links re-attached.
    """
    if not deferred_companion_links:
        return 0
    valid_body_ids = set(
        (await session.execute(select(BodyOrm.id).where(BodyOrm.app_project_id == project_id)))
        .scalars()
        .all()
    )
    attached = 0
    for section_id, body_id in deferred_companion_links.items():
        if body_id not in valid_body_ids:
            logger.warning(
                f"restore_project_bundle({project_id}): companion section {section_id} "
                f"→ body {body_id} not present after restore — leaving companion_lens_id NULL"
            )
            continue
        await session.execute(
            update(CrossSectionOrm)
            .where(
                CrossSectionOrm.id == section_id,
                CrossSectionOrm.app_project_id == project_id,
            )
            .values(companion_lens_id=body_id)
        )
        attached += 1
    return attached


async def _restore_bodies(
    session: AsyncSession,
    project_id: UUID,
    bodies_payload: list[dict[str, Any]],
    cpts_payload: list[dict[str, Any]],
    boreholes_payload: list[dict[str, Any]],
    valid_formation_ids: set[UUID],
    valid_model_ids: set[UUID],
    *,
    logger: GroundModelLogger,
) -> tuple[int, int, int]:
    """Insert body (lens) rows from the bundle with FK integrity guards.

    Extent fields (``extent_left/right_kind``, ``_target_contact_id``,
    ``_neighbour_inv_id``, ``_anchor_layer_id``, ``_provenance``) are
    stripped before insert — the extent system is retired in favour of the
    partition-fill model.  Legacy bundles that still carry these keys restore
    cleanly; the keys are silently dropped before ``_apply_json_to_kwargs``.

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project_id : UUID
        Owning project.
    bodies_payload : list[dict[str, Any]]
        Raw body dicts from the bundle.
    cpts_payload : list[dict[str, Any]]
        Raw CPT dicts — included to cover investigations queued in this
        transaction but not yet flushed.
    boreholes_payload : list[dict[str, Any]]
        Raw borehole dicts — same reason.
    valid_formation_ids : set[UUID]
        Pre-computed union of DB + payload formation ids.
    valid_model_ids : set[UUID]
        Model ids that belong to this project (bundle-injection guard).
    logger : GroundModelLogger
        Caller's logger.

    Returns
    -------
    tuple[int, int, int]
        ``(new_lenses, skipped_lenses, dropped_lenses)``.
    """
    # Build the valid investigation set (DB rows + payload ids not yet flushed).
    valid_inv_ids: set[UUID] = set(
        (await session.execute(select(CptOrm.id).where(CptOrm.app_project_id == project_id)))
        .scalars()
        .all()
    ) | set(
        (
            await session.execute(
                select(BoreholeOrm.id).where(BoreholeOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    for cpt_p in cpts_payload:
        cid = _uuid(cpt_p.get("id"))
        if cid is not None:
            valid_inv_ids.add(cid)
    for bh_p in boreholes_payload:
        bid = _uuid(bh_p.get("id"))
        if bid is not None:
            valid_inv_ids.add(bid)

    existing = set(
        (await session.execute(select(BodyOrm.id).where(BodyOrm.app_project_id == project_id)))
        .scalars()
        .all()
    )

    new_lenses = 0
    skipped = 0
    dropped = 0
    total = len(bodies_payload)
    logger.info(f"restore_project_bundle({project_id}): restoring {total} body/bodies")

    for i, lens_payload in enumerate(bodies_payload, start=1):
        lens_id = _uuid(lens_payload.get("id"))
        if lens_id is None:
            logger.debug(f"[{i}/{total}] body skipped — payload has no id")
            skipped += 1
            continue
        if lens_id in existing:
            logger.debug(f"[{i}/{total}] body {lens_id} already present — skipped")
            skipped += 1
            continue
        model_id = _uuid(lens_payload.get("model_id"))
        if model_id is None:
            logger.warning(f"[{i}/{total}] body {lens_id} has no model_id — dropped")
            dropped += 1
            continue
        if model_id not in valid_model_ids:
            logger.warning(
                f"[{i}/{total}] body {lens_id} → model {model_id} "
                f"not in this project — dropped (bundle-injection guard)"
            )
            dropped += 1
            continue
        pf_id = _uuid(lens_payload.get("formation_id"))
        if pf_id is None:
            logger.warning(f"[{i}/{total}] body {lens_id} missing formation_id — dropped")
            dropped += 1
            continue
        if pf_id not in valid_formation_ids:
            logger.warning(
                f"[{i}/{total}] body {lens_id}: formation_id {pf_id} "
                f"not present in this project — dropped (dangling FK)"
            )
            dropped += 1
            continue
        src_inv_id = _uuid(lens_payload.get("source_investigation_id"))
        if src_inv_id is None:
            logger.warning(
                f"[{i}/{total}] body {lens_id} missing source_investigation_id — dropped"
            )
            dropped += 1
            continue
        if src_inv_id not in valid_inv_ids:
            logger.warning(
                f"[{i}/{total}] body {lens_id}: source_investigation_id {src_inv_id} "
                f"not in this project's CPTs/boreholes — dropped (dangling polymorphic FK)"
            )
            dropped += 1
            continue

        # Strip legacy extent_* keys before mapping to ORM kwargs.  The
        # extent system is retired; the columns still exist in this step but
        # must not be written so the next migration step can drop them cleanly.
        # A future bundle (post-column-drop) that omits these keys is handled
        # automatically by _apply_json_to_kwargs's "unknown key → skip" rule.
        stripped_payload = {k: v for k, v in lens_payload.items() if k not in _BODY_EXTENT_COLUMNS}
        kwargs = _apply_json_to_kwargs(BodyOrm, stripped_payload)
        kwargs["app_project_id"] = project_id
        session.add(BodyOrm(**kwargs))
        existing.add(lens_id)
        new_lenses += 1
        logger.debug(f"[{i}/{total}] body {lens_id} queued for insert")

    if dropped:
        logger.warning(
            f"restore_project_bundle({project_id}): dropped {dropped} "
            f"body/bodies (model/formation/investigation not in project or missing FK)"
        )
    return new_lenses, skipped, dropped


async def _restore_formation_absences(
    session: AsyncSession,
    project_id: UUID,
    formation_absences_payload: list[dict[str, Any]],
    valid_formation_ids: set[UUID],
    *,
    logger: GroundModelLogger,
) -> tuple[int, int, int]:
    """Insert formation-absence rows from the bundle.

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project_id : UUID
        Owning project.
    formation_absences_payload : list[dict[str, Any]]
        Raw formation-absence dicts from the bundle.
    valid_formation_ids : set[UUID]
        Pre-computed union of DB + payload formation ids.
    logger : GroundModelLogger
        Caller's logger.

    Returns
    -------
    tuple[int, int, int]
        ``(new_absences, skipped_absences, dropped_absences)``.
    """
    existing = set(
        (
            await session.execute(
                select(FormationAbsenceOrm.id)
                .join(
                    GeologicalFormationOrm,
                    FormationAbsenceOrm.formation_id == GeologicalFormationOrm.id,
                )
                .where(GeologicalFormationOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    new_absences = 0
    skipped = 0
    dropped = 0
    total = len(formation_absences_payload)
    logger.info(f"restore_project_bundle({project_id}): restoring {total} formation absence(s)")
    for i, ab_payload in enumerate(formation_absences_payload, start=1):
        ab_id = _uuid(ab_payload.get("id"))
        if ab_id is None:
            logger.debug(f"[{i}/{total}] formation absence skipped — payload has no id")
            skipped += 1
            continue
        if ab_id in existing:
            logger.debug(f"[{i}/{total}] formation absence {ab_id} already present — skipped")
            skipped += 1
            continue
        ab_fid = _uuid(ab_payload.get("formation_id"))
        if ab_fid is None:
            logger.warning(f"[{i}/{total}] formation absence {ab_id} has no formation_id — dropped")
            dropped += 1
            continue
        if ab_fid not in valid_formation_ids:
            logger.warning(
                f"[{i}/{total}] formation absence {ab_id} → formation {ab_fid} "
                f"not in this project — dropped (dangling FK)"
            )
            dropped += 1
            continue
        kwargs = _apply_json_to_kwargs(FormationAbsenceOrm, ab_payload)
        session.add(FormationAbsenceOrm(**kwargs))
        new_absences += 1
        logger.debug(f"[{i}/{total}] formation absence {ab_id} queued for insert")
    if dropped:
        logger.warning(
            f"restore_project_bundle({project_id}): dropped {dropped} "
            f"formation absence(s) (formation not in project or missing formation_id)"
        )
    return new_absences, skipped, dropped


async def _restore_contact_edges(
    session: AsyncSession,
    project_id: UUID,
    litho_contact_correlation_edges_payload: list[dict[str, Any]],
    valid_model_ids: set[UUID],
    geological_models_payload: list[dict[str, Any]],
    *,
    logger: GroundModelLogger,
) -> tuple[int, int, int]:
    """Insert litho contact correlation edge rows from the bundle.

    Restored AFTER geological_models exist (model_id FK must resolve) and
    AFTER cross-sections are restored (Phase 6), so ``valid_section_ids``
    built from the DB here always includes the sections the edges reference.

    Both endpoints (contact_a_id, contact_b_id) FK ``litho_layer.id`` post-A4,
    so they must resolve to a litho_layer (or its mirrored formation_contact)
    belonging to this project's models. A canonical v4 litho-native bundle
    emits ``contacts: []`` and carries the endpoints as ``litho_layers``, so
    the valid-endpoint set unions both id spaces (FC + LL, from DB + payload)
    rather than relying on the FC↔LL mirror trigger firing before validation.

    Edges whose ``section_id`` is absent or not a section belonging to this
    project are silently dropped (clean-slate owner directive 2026-06-08).
    This makes legacy bundles saved before the section_id column was NOT NULL
    safe to open — their cross-section-less edges are discarded rather than
    causing a NOT-NULL violation.

    This restore block does NOT touch seeded_formation_contact_ids on any
    cross-section row — structural proof that the #57/applyUpdatedSection
    trap cannot recur here.

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project_id : UUID
        Owning project.
    litho_contact_correlation_edges_payload : list[dict[str, Any]]
        Raw correlation-edge dicts from the bundle.
    valid_model_ids : set[UUID]
        Model ids that belong to this project (bundle-injection guard).
    geological_models_payload : list[dict[str, Any]]
        Raw model dicts — used to include contacts queued in this
        transaction when validating edge endpoints.
    logger : GroundModelLogger
        Caller's logger.

    Returns
    -------
    tuple[int, int, int]
        ``(new_edges, skipped_edges, dropped_edges)``.
    """
    # Cross-sections are restored in Phase 6 (before this Phase 10 call), so
    # querying the DB here always returns the project's sections even on a
    # cold restore.  No payload-side union is needed because sections carry
    # their own restore phase and are committed before edges are validated.
    valid_section_ids: set[UUID] = set(
        (
            await session.execute(
                select(CrossSectionOrm.id).where(CrossSectionOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )

    valid_contact_ids: set[UUID] = set(
        (
            await session.execute(
                select(FormationContactOrm.id)
                .join(GeologicalModelOrm, FormationContactOrm.model_id == GeologicalModelOrm.id)
                .where(GeologicalModelOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    # Edges FK litho_layer.id post-A4; a canonical v4 litho-native bundle emits
    # contacts=[] and carries the endpoints as litho_layers. Union the LL id
    # space (DB + payload) so endpoint validation matches the real FK target
    # rather than depending on the FC↔LL mirror + autoflush timing.
    valid_contact_ids |= set(
        (
            await session.execute(
                select(LithoLayerOrm.id)
                .join(GeologicalModelOrm, LithoLayerOrm.model_id == GeologicalModelOrm.id)
                .where(GeologicalModelOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    # Also include contacts + litho_layers queued in this transaction (not yet
    # flushed) — both id spaces are valid edge endpoints.
    for m_payload in geological_models_payload:
        for c in m_payload.get("contacts") or []:
            cid = _uuid(c.get("id"))
            if cid is not None:
                valid_contact_ids.add(cid)
        for ly in m_payload.get("litho_layers") or []:
            lid = _uuid(ly.get("id"))
            if lid is not None:
                valid_contact_ids.add(lid)

    existing = set(
        (
            await session.execute(
                select(LithoContactCorrelationEdgeOrm.id)
                .join(
                    GeologicalModelOrm,
                    LithoContactCorrelationEdgeOrm.model_id == GeologicalModelOrm.id,
                )
                .where(GeologicalModelOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    new_edges = 0
    skipped = 0
    dropped = 0
    total = len(litho_contact_correlation_edges_payload)
    logger.info(
        f"restore_project_bundle({project_id}): restoring {total} litho contact correlation edge(s)"
    )
    for i, ce_payload in enumerate(litho_contact_correlation_edges_payload, start=1):
        ce_id = _uuid(ce_payload.get("id"))
        if ce_id is None:
            logger.debug(f"[{i}/{total}] litho contact edge skipped — payload has no id")
            skipped += 1
            continue
        if ce_id in existing:
            logger.debug(f"[{i}/{total}] litho contact edge {ce_id} already present — skipped")
            skipped += 1
            continue
        ce_model_id = _uuid(ce_payload.get("model_id"))
        if ce_model_id is None:
            logger.warning(f"[{i}/{total}] litho contact edge {ce_id} has no model_id — dropped")
            dropped += 1
            continue
        if ce_model_id not in valid_model_ids:
            logger.warning(
                f"[{i}/{total}] litho contact edge {ce_id} → model "
                f"{ce_model_id} not in this project — dropped (bundle-injection guard)"
            )
            dropped += 1
            continue
        ca_id = _uuid(ce_payload.get("contact_a_id"))
        cb_id = _uuid(ce_payload.get("contact_b_id"))
        if ca_id is None or cb_id is None:
            logger.warning(
                f"[{i}/{total}] litho contact edge {ce_id} missing contact endpoint(s) — dropped"
            )
            dropped += 1
            continue
        if ca_id not in valid_contact_ids or cb_id not in valid_contact_ids:
            logger.warning(
                f"[{i}/{total}] litho contact edge {ce_id}: contact "
                f"endpoint(s) not present in this project — dropped (dangling FK)"
            )
            dropped += 1
            continue
        # Section guard (owner directive 2026-06-08): edges are section-scoped.
        # A missing or unknown section_id means this is a legacy bundle saved
        # before the NOT-NULL column existed — drop cleanly rather than raising.
        ce_section_id = _uuid(ce_payload.get("section_id"))
        if ce_section_id is None or ce_section_id not in valid_section_ids:
            logger.warning(
                f"[{i}/{total}] litho contact edge {ce_id}: missing or unknown "
                f"section_id {ce_section_id} — dropped (section-scoped, clean slate)"
            )
            dropped += 1
            continue
        kwargs = _apply_json_to_kwargs(LithoContactCorrelationEdgeOrm, ce_payload)
        session.add(LithoContactCorrelationEdgeOrm(**kwargs))
        new_edges += 1
        logger.debug(f"[{i}/{total}] litho contact edge {ce_id} queued for insert")
    if dropped:
        logger.warning(
            f"restore_project_bundle({project_id}): dropped {dropped} "
            f"litho contact correlation edge(s) (model/contact not in project or missing FK)"
        )
    return new_edges, skipped, dropped


async def _restore_lens_shapes_and_nodes(
    session: AsyncSession,
    project_id: UUID,
    body_boundary_shapes_payload: list[dict[str, Any]],
    body_boundary_nodes_payload: list[dict[str, Any]],
    valid_model_ids: set[UUID],
    *,
    logger: GroundModelLogger,
) -> tuple[int, int, int, int]:
    """Insert body-boundary shape + node rows from the bundle.

    Shapes are restored AFTER geological_models (shape.model_id FK).
    Nodes are restored AFTER shapes (node.shape_id FK).  Both are
    idempotent by id; dangling FKs are dropped with a warning.

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project_id : UUID
        Owning project.
    body_boundary_shapes_payload : list[dict[str, Any]]
        Raw shape dicts from the bundle.
    body_boundary_nodes_payload : list[dict[str, Any]]
        Raw node dicts from the bundle.
    valid_model_ids : set[UUID]
        Model ids that belong to this project (bundle-injection guard).
    logger : GroundModelLogger
        Caller's logger.

    Returns
    -------
    tuple[int, int, int, int]
        ``(new_shapes, dropped_shapes, new_nodes, dropped_nodes)``.
    """
    existing_shapes: set[UUID] = set(
        (
            await session.execute(
                select(LithoLensShapeOrm.id)
                .join(GeologicalModelOrm, LithoLensShapeOrm.model_id == GeologicalModelOrm.id)
                .where(GeologicalModelOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    valid_shape_ids: set[UUID] = set(existing_shapes)
    new_shapes = 0
    dropped_shapes = 0
    for shape_payload in body_boundary_shapes_payload:
        sid = _uuid(shape_payload.get("id"))
        mid = _uuid(shape_payload.get("model_id"))
        if sid is None or mid is None:
            dropped_shapes += 1
            continue
        if sid in existing_shapes:
            valid_shape_ids.add(sid)
            continue
        if mid not in valid_model_ids:
            logger.warning(
                f"restore_project_bundle({project_id}): lens shape {sid} → model {mid} "
                f"not in this project — dropped (dangling FK)"
            )
            dropped_shapes += 1
            continue
        session.add(LithoLensShapeOrm(**_apply_json_to_kwargs(LithoLensShapeOrm, shape_payload)))
        valid_shape_ids.add(sid)
        new_shapes += 1

    existing_nodes: set[UUID] = set(
        (
            await session.execute(
                select(LithoLensBoundaryNodeOrm.id)
                .join(LithoLensShapeOrm, LithoLensBoundaryNodeOrm.shape_id == LithoLensShapeOrm.id)
                .join(GeologicalModelOrm, LithoLensShapeOrm.model_id == GeologicalModelOrm.id)
                .where(GeologicalModelOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    new_nodes = 0
    dropped_nodes = 0
    for node_payload in body_boundary_nodes_payload:
        nid = _uuid(node_payload.get("id"))
        shid = _uuid(node_payload.get("shape_id"))
        if nid is None or shid is None:
            dropped_nodes += 1
            continue
        if nid in existing_nodes:
            continue
        if shid not in valid_shape_ids:
            logger.warning(
                f"restore_project_bundle({project_id}): lens boundary node {nid} → shape {shid} "
                f"not in this project — dropped (dangling FK)"
            )
            dropped_nodes += 1
            continue
        session.add(
            LithoLensBoundaryNodeOrm(
                **_apply_json_to_kwargs(LithoLensBoundaryNodeOrm, node_payload)
            )
        )
        new_nodes += 1
    if dropped_shapes or dropped_nodes:
        logger.warning(
            f"restore_project_bundle({project_id}): dropped {dropped_shapes} lens shape(s) "
            f"+ {dropped_nodes} lens boundary node(s) (dangling FK)"
        )
    return new_shapes, dropped_shapes, new_nodes, dropped_nodes
