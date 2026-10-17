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
_restore_litho_solids
    Insert cached watertight body-solid rows (dedup on (model_id, body_id)).
_restore_lens_shapes_and_nodes
    Insert body-boundary shape + node rows.
_attach_companion_body_links
    Re-attach deferred ``cross_section.companion_body_id`` FKs after
    bodies have been inserted.
"""

from __future__ import annotations

import math
from typing import Any
from uuid import UUID

from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.body_boundary_node_orm import BodyBoundaryNodeOrm
from groundmodel.infrastructure.db.models.body_boundary_shape_orm import BodyBoundaryShapeOrm
from groundmodel.infrastructure.db.models.body_geometry_fact_orm import BodyGeometryFactOrm
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.body_separation_orm import BodySeparationOrm
from groundmodel.infrastructure.db.models.body_union_orm import BodyUnionOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_absence_orm import FormationAbsenceOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.formation_surface_orm import FormationSurfaceOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.geotech_tie_tombstone_orm import (
    GeotechTieTombstoneOrm,
)
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from groundmodel.infrastructure.db.repositories.project_bundle.bundle_restore_drops import (
    BundleRestoreDrops,
)
from groundmodel.shared.constants.model_kind import MODEL_KIND_GEOLOGICAL, MODEL_KINDS
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

from .bundle_row_builders import _payload_ids, _uuid, _validate_tin_payload
from .bundle_serialization import (
    _MAX_SURFACE_SOURCE_CONTACTS,
    _MAX_TIN_ARRAY_LEN,
    _apply_json_to_kwargs,
    _normalise_restore_keys,
)


def _require_fk(
    payload: dict[str, Any],
    key: str,
    valid_set: set[UUID] | None,
    *,
    label: str,
    note: str,
    i: int,
    total: int,
    logger: GroundModelLogger,
) -> UUID | None:
    """Resolve + scope-check one FK from a bundle payload, or drop it.

    The per-FK guard every restore phase runs: parse the UUID, reject a
    missing value, and reject a value outside the project-scoped valid
    set (the bundle-injection guard — a crafted bundle must not attach
    rows to another project's parents). Previously the same block shape
    was copy-pasted ~10 times across the litho restore phases; the
    helper makes "every FK gets the injection guard" structural instead
    of copy-discipline.

    Parameters
    ----------
    payload : dict[str, Any]
        Raw bundle dict for the row being restored.
    key : str
        Payload key holding the FK (e.g. ``"model_id"``).
    valid_set : set[UUID] | None
        Project-scoped ids the FK must be in. ``None`` skips the
        membership check (missing-only guard, e.g. the litho solid's
        non-FK ``body_id``).
    label : str
        Per-phase log identity, e.g. ``f"body {lens_id}"`` — keeps the
        phase wording in the warning lines.
    note : str
        Parenthesised drop reason for the invalid case, e.g.
        ``"bundle-injection guard"`` / ``"dangling FK"``.
    i, total : int
        Progress-prefix counters for the ``[i/total]`` log convention.
    logger : GroundModelLogger
        Caller's logger.

    Returns
    -------
    UUID | None
        The validated FK, or ``None`` when the row must be dropped
        (a warning has already been logged; the caller increments its
        ``dropped`` counter and continues).
    """
    fk = _uuid(payload.get(key))
    if fk is None:
        logger.warning(f"[{i}/{total}] {label} has no {key} — dropped")
        return None
    if valid_set is not None and fk not in valid_set:
        logger.warning(f"[{i}/{total}] {label}: {key} {fk} not in this project — dropped ({note})")
        return None
    return fk


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
    valid_inv_ids: set[UUID],
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
    valid_inv_ids : set[UUID]
        Pre-computed union of DB + payload investigation ids (CPTs +
        boreholes, from ``_build_valid_inv_ids``). Used to reject a contact
        whose investigation anchor points at another project's investigation.
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
    # Deferred self-referential FK: a geotech band's parent_litho_layer_id
    # points at the accepted litho band it subdivides. Applied in a second pass
    # (below) rather than inline, because the bundle build has no ORDER BY and a
    # geotech model can appear BEFORE its litho parent — inserting the child's
    # self-FK inline would FK-violate. Same deferred-FK pattern as
    # _attach_companion_body_links.  ``{layer_id: parent_litho_layer_id}``.
    deferred_parent_links: dict[UUID, UUID] = {}

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
            # IDOR guard: a contact's investigation anchor (borehole_id / cpt_id)
            # is a cross-project FK the DB happily satisfies whenever the
            # referenced row exists under ANOTHER project. Drop a contact whose
            # non-null anchor is not in THIS project's investigation set.
            # Synthetic contacts (borehole_id AND cpt_id both null, anchored by
            # the synthetic_* coords) carry no investigation FK → pass through.
            bh_id = _uuid(c.get("borehole_id"))
            cpt_id = _uuid(c.get("cpt_id"))
            if (bh_id is not None and bh_id not in valid_inv_ids) or (
                cpt_id is not None and cpt_id not in valid_inv_ids
            ):
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
        contact_ids_in_payload = _payload_ids(contacts_payload)

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
            # parent_litho_layer_id is a SELF-referential FK (geotech band →
            # covering litho band). Defer it to the second pass so a
            # child-before-parent model order cannot FK-violate on insert; drop
            # it from the inline kwargs so nothing writes it prematurely.
            parent_ref = layer_kwargs.pop("parent_litho_layer_id", None)
            if lid is not None and parent_ref is not None:
                deferred_parent_links[lid] = parent_ref
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

    # ---- Second pass: the deferred parent-band self-FK -------------------
    # Every layer of every model is now queued; flush so the explicit inserts
    # AND the FC→LL trigger's accepted-litho materialisations both land before
    # we read the valid-layer set. Only then can a geotech band point at its
    # covering litho band without the insert order mattering.
    if deferred_parent_links:
        await session.flush()
        valid_layer_ids: set[UUID] = set(
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
        applied = 0
        dropped_parent = 0
        for layer_id, parent_id in deferred_parent_links.items():
            # Bundle-injection + dangling-FK guard: both endpoints must be a
            # litho band in THIS project. A parent that never restored drops to
            # NULL — the honest orphan state the tree reports, never a
            # cross-project attach.
            if layer_id not in valid_layer_ids or parent_id not in valid_layer_ids:
                dropped_parent += 1
                continue
            await session.execute(
                update(LithoLayerOrm)
                .where(LithoLayerOrm.id == layer_id)
                .values(parent_litho_layer_id=parent_id)
            )
            applied += 1
        logger.debug(
            f"restore_project_bundle({project_id}): stamped {applied} parent-band "
            f"FK(s) in the deferred pass"
        )
        if dropped_parent:
            logger.warning(
                f"restore_project_bundle({project_id}): dropped {dropped_parent} "
                f"parent-band FK(s) to NULL (parent litho band not in this project)"
            )

    return new_models, new_contacts


async def _attach_sample_body_links(
    session: AsyncSession,
    project_id: UUID,
    deferred: dict[UUID, UUID],
    *,
    logger: GroundModelLogger,
    drops: BundleRestoreDrops | None = None,
) -> int:
    """Re-attach deferred ``sample.geotech_body_id`` stamps once bodies exist.

    The stamp Divide boreholes writes on a sample is an FK to ``body``. Samples
    restore in Phase 2 with their boreholes and bodies only in Phase 8, so the
    row builder strips the stamp and records it; this pass writes it back for
    every body that IS in the restored project. A stamp whose body is not there
    (a body id re-minted after the last Divide, the stale window) stays NULL, is
    counted in ``drops.sample_body_stamps_dropped`` and logged: the next Divide
    re-stamps it. Before this pass such a file could not be restored at all
    (owner's ``test3.strix``, 2026-09-04: ``ForeignKeyViolationError`` on the
    first autoflush, answered as a 500).

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project_id : UUID
        Owning project.
    deferred : dict[UUID, UUID]
        ``{sample.id: body.id}`` collected by the Phase 2 row builders.
    logger : GroundModelLogger
        Caller's logger.
    drops : BundleRestoreDrops | None, optional
        Tally the dropped (dangling) stamps land in.

    Returns
    -------
    int
        Number of stamps re-attached.
    """
    if not deferred:
        return 0
    valid_body_ids = set(
        (await session.execute(select(BodyOrm.id).where(BodyOrm.app_project_id == project_id)))
        .scalars()
        .all()
    )
    attached = 0
    dropped = 0
    for sample_id, body_id in deferred.items():
        if body_id not in valid_body_ids:
            dropped += 1
            logger.debug(
                f"restore_project_bundle({project_id}): sample {sample_id} -> body {body_id} "
                "not present after restore; geotech_body_id left NULL until the next Divide"
            )
            continue
        await session.execute(
            update(SampleOrm).where(SampleOrm.id == sample_id).values(geotech_body_id=body_id)
        )
        attached += 1
    if dropped and drops is not None:
        drops.sample_body_stamps_dropped += dropped
    if dropped:
        logger.warning(
            f"restore_project_bundle({project_id}): {dropped} sample body stamp(s) pointed at "
            f"bodies not in the restored project; dropped to NULL ({attached} re-attached)"
        )
    return attached


async def _attach_companion_body_links(
    session: AsyncSession,
    project_id: UUID,
    deferred_companion_links: dict[UUID, UUID],
    *,
    logger: GroundModelLogger,
) -> int:
    """Set the deferred ``cross_section.companion_body_id`` now bodies exist (#196).

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
                f"→ body {body_id} not present after restore — leaving companion_body_id NULL"
            )
            continue
        await session.execute(
            update(CrossSectionOrm)
            .where(
                CrossSectionOrm.id == section_id,
                CrossSectionOrm.app_project_id == project_id,
            )
            .values(companion_body_id=body_id)
        )
        attached += 1
    return attached


async def _restore_bodies(
    session: AsyncSession,
    project_id: UUID,
    bodies_payload: list[dict[str, Any]],
    valid_inv_ids: set[UUID],
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
    valid_inv_ids : set[UUID]
        Pre-computed union of DB + payload investigation ids (CPTs +
        boreholes, from ``_build_valid_inv_ids``) — used to reject a body
        whose ``source_investigation_id`` points outside this project.
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
    # valid_inv_ids is now built once by the caller (_build_valid_inv_ids) and
    # shared across contacts / bodies / absences — no per-function rebuild.
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
        guard_args: dict[str, Any] = {
            "label": f"body {lens_id}",
            "i": i,
            "total": total,
            "logger": logger,
        }
        model_id = _require_fk(
            lens_payload, "model_id", valid_model_ids, note="bundle-injection guard", **guard_args
        )
        if model_id is None:
            dropped += 1
            continue
        pf_id = _require_fk(
            lens_payload, "formation_id", valid_formation_ids, note="dangling FK", **guard_args
        )
        if pf_id is None:
            dropped += 1
            continue
        src_inv_id = _require_fk(
            lens_payload,
            "source_investigation_id",
            valid_inv_ids,
            note="dangling polymorphic FK",
            **guard_args,
        )
        if src_inv_id is None:
            dropped += 1
            continue

        # Legacy bundles may still carry retired extent_* keys; the columns
        # were dropped from BodyOrm (migration d8868bb27884), so
        # _apply_json_to_kwargs's "unknown key → skip" rule drops them here.
        kwargs = _apply_json_to_kwargs(BodyOrm, lens_payload)
        # parent_litho_body_id is resolver-maintained, never restored (debt #278,
        # R1). Two reasons, and the FIRST is the durable one — do not revert this
        # pop to "carry it through":
        #  1. INSERT-ORDERING SAFETY. body is a self-referencing table and these
        #     rows insert one-by-one in payload order; a geotech body's
        #     parent_litho_body_id may name a litho body row that has not been
        #     inserted yet, which would FK-violate mid-loop. Popping keeps this a
        #     single-pass insert with no ordering dependency and no second pass.
        #  2. STALENESS. Even in the right order the bundled value names a litho
        #     body id from the SAVING session, which this restore re-mints, so it
        #     would be wrong on arrival.
        # The post-restore reconcile (reconcile_bodies_after_restore,
        # litho-before-geotech) re-stamps it from the freshly-resolved litho bodies.
        kwargs.pop("parent_litho_body_id", None)
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
    valid_inv_ids: set[UUID],
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
    valid_inv_ids : set[UUID]
        Pre-computed union of DB + payload investigation ids (CPTs +
        boreholes, from ``_build_valid_inv_ids``). ``investigation_id`` is a
        polymorphic UUID with no DB FK, so it must be scope-checked here.
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
        guard_args: dict[str, Any] = {
            "label": f"formation absence {ab_id}",
            "i": i,
            "total": total,
            "logger": logger,
        }
        ab_fid = _require_fk(
            ab_payload, "formation_id", valid_formation_ids, note="dangling FK", **guard_args
        )
        if ab_fid is None:
            dropped += 1
            continue
        # IDOR guard: investigation_id is a polymorphic UUID with NO DB FK, so
        # a crafted bundle can point it at another project's investigation and
        # nothing at the DB layer objects. Drop an absence whose investigation
        # anchor is not in THIS project's CPT/borehole set (None also fails —
        # the column is NOT NULL, so a missing anchor cannot be inserted).
        ab_inv_id = _require_fk(
            ab_payload,
            "investigation_id",
            valid_inv_ids,
            note="cross-project anchor",
            **guard_args,
        )
        if ab_inv_id is None:
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

    Both endpoints (layer_a_id, layer_b_id) FK ``litho_layer.id`` post-A4,
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
        ce_model_id = _require_fk(
            ce_payload,
            "model_id",
            valid_model_ids,
            label=f"litho contact edge {ce_id}",
            note="bundle-injection guard",
            i=i,
            total=total,
            logger=logger,
        )
        if ce_model_id is None:
            dropped += 1
            continue
        # Normalise renamed keys FIRST — the endpoint guards below must see
        # the current column names even for pre-ARCH-08 bundles that still
        # carry the retired contact_a_id / contact_b_id keys.
        ce_payload = _normalise_restore_keys(LithoContactCorrelationEdgeOrm, ce_payload)
        ca_id = _uuid(ce_payload.get("layer_a_id"))
        cb_id = _uuid(ce_payload.get("layer_b_id"))
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
        # A missing section_id = legacy bundle saved before the NOT-NULL column
        # existed (expected, clean-slate drop). An unknown section_id = a section
        # not in this project (suspicious — a bundle-injection guard, matching
        # the model/contact guards above). Both drop cleanly rather than raising.
        ce_section_id = _uuid(ce_payload.get("section_id"))
        if ce_section_id is None:
            logger.warning(
                f"[{i}/{total}] litho contact edge {ce_id}: no section_id "
                f"(legacy bundle, pre-NOT-NULL) — dropped (section-scoped clean slate)"
            )
            dropped += 1
            continue
        if ce_section_id not in valid_section_ids:
            logger.warning(
                f"[{i}/{total}] litho contact edge {ce_id}: section_id "
                f"{ce_section_id} not in this project — dropped (bundle-injection guard)"
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
            f"litho contact correlation edge(s) (model/contact/section not in project, "
            f"missing FK, or legacy section-less edge)"
        )
    return new_edges, skipped, dropped


async def _restore_layer_pair_rows(
    session: AsyncSession,
    project_id: UUID,
    payload: list[dict[str, Any]],
    valid_model_ids: set[UUID],
    geological_models_payload: list[dict[str, Any]],
    *,
    orm_cls: type[Any],
    label: str,
    logger: GroundModelLogger,
) -> tuple[int, int, int]:
    """Insert a bundle's canonical layer-pair rows (facts / separations / unions).

    Three collections share one shape — a ``(model_id, layer_a_id, layer_b_id)``
    row with the ``a < b`` CHECK, scoped through ``geological_model``, both anchors
    the resolver reads: body geometry FACTS (machine union evidence), user
    SEPARATIONS (cannot-link) and user UNIONS (must-link). This is the third
    caller, so the restore is extracted here rather than copied a third time.

    Restored after the litho layers so both FK anchors resolve, and BEFORE
    ``reconcile_bodies_after_restore`` runs, so the restored resolver pass already
    honours them. Guards: dedupe by id, model-scope guard, both anchor layers must
    belong to the row's OWN model (DB rows or rows queued in this transaction —
    a project-wide set would let a malformed row for model A anchor on model B's
    layer), and endpoints re-canonicalised (``a < b``) so a clone whose id remap
    flipped the order cannot trip the CHECK.

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project_id : UUID
        Owning project.
    payload : list[dict[str, Any]]
        Raw row dicts from the bundle.
    valid_model_ids : set[UUID]
        Model ids that belong to this project (bundle-injection guard).
    geological_models_payload : list[dict[str, Any]]
        Raw model dicts — includes litho layers queued in this transaction.
    orm_cls : type[Any]
        The ORM class the rows insert into (``BodyGeometryFactOrm`` /
        ``BodySeparationOrm`` / ``BodyUnionOrm``).
    label : str
        The human noun for logs (e.g. ``"geometry fact"``, ``"body separation"``,
        ``"body union"``).
    logger : GroundModelLogger
        Caller's logger.

    Returns
    -------
    tuple[int, int, int]
        ``(new_rows, skipped_rows, dropped_rows)``.
    """
    # layer id → OWNING MODEL, not a flat project-wide set: a row's endpoints
    layer_model: dict[UUID, UUID] = {
        row.id: row.model_id
        for row in (
            await session.execute(
                select(LithoLayerOrm.id, LithoLayerOrm.model_id)
                .join(GeologicalModelOrm, LithoLayerOrm.model_id == GeologicalModelOrm.id)
                .where(GeologicalModelOrm.app_project_id == project_id)
            )
        ).all()
    }
    for m_payload in geological_models_payload:
        mid = _uuid(m_payload.get("id"))
        if mid is None:
            continue
        for ly in m_payload.get("litho_layers") or []:
            lid = _uuid(ly.get("id"))
            if lid is not None:
                layer_model[lid] = mid

    existing = set(
        (
            await session.execute(
                select(orm_cls.id)
                .join(GeologicalModelOrm, orm_cls.model_id == GeologicalModelOrm.id)
                .where(GeologicalModelOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    new_rows = 0
    skipped = 0
    dropped = 0
    pending_rows: list[dict[str, UUID]] = []
    total = len(payload)
    if total:
        logger.info(f"restore_project_bundle({project_id}): restoring {total} {label}(s)")
    for i, row_payload in enumerate(payload, start=1):
        row_id = _uuid(row_payload.get("id"))
        if row_id is None or row_id in existing:
            skipped += 1
            continue
        row_model_id = _require_fk(
            row_payload,
            "model_id",
            valid_model_ids,
            label=f"{label} {row_id}",
            note="bundle-injection guard",
            i=i,
            total=total,
            logger=logger,
        )
        if row_model_id is None:
            dropped += 1
            continue
        a_id = _uuid(row_payload.get("layer_a_id"))
        b_id = _uuid(row_payload.get("layer_b_id"))
        if a_id is None or b_id is None or a_id == b_id:
            logger.warning(f"[{i}/{total}] {label} {row_id} has no valid pair — dropped")
            dropped += 1
            continue
        if layer_model.get(a_id) != row_model_id or layer_model.get(b_id) != row_model_id:
            logger.warning(
                f"[{i}/{total}] {label} {row_id}: layer anchor(s) not in the "
                f"{label}'s own model — dropped (dangling FK)"
            )
            dropped += 1
            continue
        if str(a_id) > str(b_id):
            a_id, b_id = b_id, a_id
        pending_rows.append(
            {"id": row_id, "model_id": row_model_id, "layer_a_id": a_id, "layer_b_id": b_id}
        )
        new_rows += 1
    if pending_rows:
        # ONE bulk insert instead of N ORM adds; values are fully validated above,
        # so nothing is lost by skipping the ORM (the owner's real model carries
        # ~10k geometry facts — the per-row path cost seconds on Discard).
        await session.execute(insert(orm_cls), pending_rows)
        logger.debug(
            f"restore_project_bundle({project_id}): bulk-inserted {len(pending_rows)} {label}(s)"
        )
    if dropped:
        logger.warning(
            f"restore_project_bundle({project_id}): dropped {dropped} {label}(s) "
            f"(model or layer not in project)"
        )
    return new_rows, skipped, dropped


async def _restore_geometry_facts(
    session: AsyncSession,
    project_id: UUID,
    body_geometry_facts_payload: list[dict[str, Any]],
    valid_model_ids: set[UUID],
    geological_models_payload: list[dict[str, Any]],
    *,
    logger: GroundModelLogger,
) -> tuple[int, int, int]:
    """Insert geometric body-connectivity facts from the bundle.

    Facts (owner ruling 2026-08-12) are layer-pair union evidence the resolver
    consumes alongside correlation edges. Thin delegation to
    ``_restore_layer_pair_rows`` — the shared canonical layer-pair restore.

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project_id : UUID
        Owning project.
    body_geometry_facts_payload : list[dict[str, Any]]
        Raw fact dicts from the bundle.
    valid_model_ids : set[UUID]
        Model ids that belong to this project (bundle-injection guard).
    geological_models_payload : list[dict[str, Any]]
        Raw model dicts — includes litho layers queued in this transaction.
    logger : GroundModelLogger
        Caller's logger.

    Returns
    -------
    tuple[int, int, int]
        ``(new_facts, skipped_facts, dropped_facts)``.
    """
    return await _restore_layer_pair_rows(
        session,
        project_id,
        body_geometry_facts_payload,
        valid_model_ids,
        geological_models_payload,
        orm_cls=BodyGeometryFactOrm,
        label="geometry fact",
        logger=logger,
    )


async def _restore_body_separations(
    session: AsyncSession,
    project_id: UUID,
    body_separations_payload: list[dict[str, Any]],
    valid_model_ids: set[UUID],
    geological_models_payload: list[dict[str, Any]],
    *,
    logger: GroundModelLogger,
) -> tuple[int, int, int]:
    """Insert user "Separate" rulings from the bundle.

    Separations (owner 2026-08-31, debt #278 R5) are cannot-link constraints the
    resolver reads: "the body containing layer_a is never the same body as the
    body containing layer_b". Restored after the litho layers so both FK anchors
    resolve, and BEFORE ``reconcile_bodies_after_restore`` runs, so the restored
    resolver pass already honours them — a reopened project keeps its bodies
    split exactly as the engineer left them, never silently rejoined (the
    ruling's word was "permanent").

    Thin delegation to ``_restore_layer_pair_rows`` — the shared canonical
    layer-pair restore (same guards: dedupe by id, model-scope, both anchors in
    the row's own model, endpoints re-canonicalised). An anchor whose layer is
    absent in the restored project drops that row (counted + logged), never fails
    the restore.

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project_id : UUID
        Owning project.
    body_separations_payload : list[dict[str, Any]]
        Raw separation dicts from the bundle.
    valid_model_ids : set[UUID]
        Model ids that belong to this project (bundle-injection guard).
    geological_models_payload : list[dict[str, Any]]
        Raw model dicts — includes litho layers queued in this transaction.
    logger : GroundModelLogger
        Caller's logger.

    Returns
    -------
    tuple[int, int, int]
        ``(new_separations, skipped_separations, dropped_separations)``.
    """
    return await _restore_layer_pair_rows(
        session,
        project_id,
        body_separations_payload,
        valid_model_ids,
        geological_models_payload,
        orm_cls=BodySeparationOrm,
        label="body separation",
        logger=logger,
    )


async def _restore_body_unions(
    session: AsyncSession,
    project_id: UUID,
    body_unions_payload: list[dict[str, Any]],
    valid_model_ids: set[UUID],
    geological_models_payload: list[dict[str, Any]],
    *,
    logger: GroundModelLogger,
) -> tuple[int, int, int]:
    """Insert user "Join with…" rulings from the bundle.

    Unions (owner 2026-08-31, debt #278) are must-link constraints the resolver
    reads: "the body containing layer_a IS the body containing layer_b". Restored
    after the litho layers so both FK anchors resolve, and BEFORE
    ``reconcile_bodies_after_restore`` runs, so the restored resolver pass already
    honours them — a reopened project keeps its joined bodies merged, never
    silently split (the ruling's word was "permanent"). A union that contradicts a
    restored separation is suppressed by the resolver, not by this restore.

    Thin delegation to ``_restore_layer_pair_rows`` — the shared canonical
    layer-pair restore.

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project_id : UUID
        Owning project.
    body_unions_payload : list[dict[str, Any]]
        Raw union dicts from the bundle.
    valid_model_ids : set[UUID]
        Model ids that belong to this project (bundle-injection guard).
    geological_models_payload : list[dict[str, Any]]
        Raw model dicts — includes litho layers queued in this transaction.
    logger : GroundModelLogger
        Caller's logger.

    Returns
    -------
    tuple[int, int, int]
        ``(new_unions, skipped_unions, dropped_unions)``.
    """
    return await _restore_layer_pair_rows(
        session,
        project_id,
        body_unions_payload,
        valid_model_ids,
        geological_models_payload,
        orm_cls=BodyUnionOrm,
        label="body union",
        logger=logger,
    )


async def _restore_litho_solids(
    session: AsyncSession,
    litho_solids_payload: list[dict[str, Any]],
    valid_model_ids: set[UUID],
    valid_formation_ids: set[UUID],
    *,
    logger: GroundModelLogger,
) -> tuple[int, int, int]:
    """Insert cached watertight body-solid rows from the bundle.

    Restores the ``litho_body_solid`` cache (watertight-loft builder Task 9,
    spec §7) so a freshly-opened ``.strix`` can export 3-D geometry without
    paying the on-click rebuild. Runs AFTER the geological models and
    formations are restored, so both FK targets (``model_id`` →
    ``geological_model``, ``formation_id`` → ``geological_formation``) exist.

    Guards (mirroring ``_restore_bodies``):

    * Dedup on the ``(model_id, body_id)`` unique key — a solid already
      present in the DB (or duplicated within the payload) is skipped, so the
      restore is idempotent and never violates ``uq_litho_body_solid_model_body``.
    * Drop a solid whose ``model_id`` is not in ``valid_model_ids`` (the
      bundle-injection guard) or whose ``formation_id`` is not in
      ``valid_formation_ids`` (a dangling FK that would 500 on flush).

    ``body_id`` is NOT validated against any table: the loft stores
    geology-split bodies under synthesized ``uuid5`` ids that have no row in
    the ``body`` table by design (see ``LithoBodySolidOrm`` — body_id is not
    an FK). It rides along verbatim as a plain UUID.

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    litho_solids_payload : list[dict[str, Any]]
        Raw solid dicts from the bundle (``litho_solids`` array).
    valid_model_ids : set[UUID]
        Model ids that belong to this project (bundle-injection guard).
    valid_formation_ids : set[UUID]
        Pre-computed union of DB + payload formation ids.
    logger : GroundModelLogger
        Caller's logger.

    Returns
    -------
    tuple[int, int, int]
        ``(new_solids, skipped_solids, dropped_solids)``.
    """
    # Existing (model_id, body_id) pairs across this project's models — the
    # dedup key. Scoped through geological_model since the solid table has no
    # direct app_project_id column.
    existing: set[tuple[UUID, UUID]] = {
        (row.model_id, row.body_id)
        for row in (
            await session.execute(
                select(LithoBodySolidOrm.model_id, LithoBodySolidOrm.body_id).where(
                    LithoBodySolidOrm.model_id.in_(valid_model_ids)
                )
            )
        ).all()
    }

    new_solids = 0
    skipped = 0
    dropped = 0
    total = len(litho_solids_payload)
    logger.info(f"restore_project_bundle: restoring {total} litho body solid(s)")

    for i, solid_payload in enumerate(litho_solids_payload, start=1):
        solid_id = _uuid(solid_payload.get("id"))
        if solid_id is None:
            logger.debug(f"[{i}/{total}] litho solid skipped — payload has no id")
            skipped += 1
            continue
        guard_args: dict[str, Any] = {
            "label": f"litho solid {solid_id}",
            "i": i,
            "total": total,
            "logger": logger,
        }
        model_id = _require_fk(
            solid_payload, "model_id", valid_model_ids, note="bundle-injection guard", **guard_args
        )
        if model_id is None:
            dropped += 1
            continue
        # body_id is deliberately NOT scope-checked (valid_set=None): the loft
        # stores geology-split bodies under synthesized uuid5 ids with no row
        # in the body table by design — only a missing value drops the solid.
        body_id = _require_fk(solid_payload, "body_id", None, note="", **guard_args)
        if body_id is None:
            dropped += 1
            continue
        if (model_id, body_id) in existing:
            logger.debug(
                f"[{i}/{total}] litho solid for (model {model_id}, body {body_id}) "
                f"already present — skipped"
            )
            skipped += 1
            continue
        formation_id = _require_fk(
            solid_payload, "formation_id", valid_formation_ids, note="dangling FK", **guard_args
        )
        if formation_id is None:
            dropped += 1
            continue

        kwargs = _apply_json_to_kwargs(LithoBodySolidOrm, solid_payload)
        # Debt #19 parity with the surface path: cap untrusted TIN blobs. An
        # unbounded vertices/triangles JSONB array from a crafted bundle would
        # OOM the asyncio worker before the first write. Blank the geometry +
        # force is_stale rather than inserting it verbatim; the solid keeps its
        # metadata and the user rebuilds it on the next on-click Build.
        raw_verts = kwargs.get("vertices")
        raw_tris = kwargs.get("triangles")
        n_verts = len(raw_verts) if isinstance(raw_verts, list) else 0
        n_tris = len(raw_tris) if isinstance(raw_tris, list) else 0
        if n_verts > _MAX_TIN_ARRAY_LEN or n_tris > _MAX_TIN_ARRAY_LEN:
            logger.warning(
                f"[{i}/{total}] litho solid {solid_id}: geometry exceeds size caps "
                f"(verts={n_verts}, tris={n_tris}) — geometry dropped, is_stale forced"
            )
            _blank_surface_geometry(kwargs)
        session.add(LithoBodySolidOrm(**kwargs))
        existing.add((model_id, body_id))
        new_solids += 1
        logger.debug(f"[{i}/{total}] litho solid {solid_id} queued for insert")

    if dropped:
        logger.warning(
            f"restore_project_bundle: dropped {dropped} litho body solid(s) "
            f"(model/formation not in project or missing FK)"
        )
    return new_solids, skipped, dropped


async def _restore_tie_tombstones(
    session: AsyncSession,
    project_id: UUID,
    geotech_tie_tombstones_payload: list[dict[str, Any]],
    valid_model_ids: set[UUID],
    *,
    logger: GroundModelLogger,
) -> tuple[int, int, int]:
    """Insert deleted-tie tombstones from the bundle.

    A tombstone (owner rulings 2026-08-17: *"a tie i delete stays deleted"*,
    keyed *"position xyz left and xyz right and the section it was on"*) is the
    engineer's recorded deletion of a machine-restatable packing tie.  It MUST
    survive the bundle round-trip: without this restorer a Discard or a
    reopen-after-wipe would revive every tie he deleted, which is precisely the
    loop the table exists to end.

    Guards mirror ``_restore_geometry_facts``: dedupe by id, model-scope guard
    (bundle-injection defence), the section must belong to this project, and
    all six coordinates must be finite numbers — a tombstone with a corrupt
    coordinate could otherwise silently suppress an unrelated tie forever.

    Parameters
    ----------
    session : AsyncSession
        Running SQLAlchemy async session.
    project_id : UUID
        Owning project.
    geotech_tie_tombstones_payload : list[dict[str, Any]]
        Raw tombstone dicts from the bundle.
    valid_model_ids : set[UUID]
        Model ids that belong to this project.
    logger : GroundModelLogger
        Caller's logger.

    Returns
    -------
    tuple[int, int, int]
        ``(new_tombstones, skipped_tombstones, dropped_tombstones)``.
    """
    total = len(geotech_tie_tombstones_payload)
    if total == 0:
        return 0, 0, 0
    logger.info(f"restore_project_bundle({project_id}): restoring {total} deleted-tie tombstone(s)")
    valid_section_ids: set[UUID] = set(
        (
            await session.execute(
                select(CrossSectionOrm.id).where(CrossSectionOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    existing = set(
        (
            await session.execute(
                select(GeotechTieTombstoneOrm.id)
                .join(
                    GeologicalModelOrm,
                    GeotechTieTombstoneOrm.model_id == GeologicalModelOrm.id,
                )
                .where(GeologicalModelOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    new_rows = 0
    skipped = 0
    dropped = 0
    for i, payload in enumerate(geotech_tie_tombstones_payload, start=1):
        row_id = _uuid(payload.get("id"))
        if row_id is None:
            logger.debug(f"[{i}/{total}] tombstone skipped - payload has no id")
            skipped += 1
            continue
        if row_id in existing:
            logger.debug(f"[{i}/{total}] tombstone {row_id} already present - skipped")
            skipped += 1
            continue
        model_id = _require_fk(
            payload,
            "model_id",
            valid_model_ids,
            label=f"tombstone {row_id}",
            note="bundle-injection guard",
            i=i,
            total=total,
            logger=logger,
        )
        if model_id is None:
            dropped += 1
            continue
        section_id = _uuid(payload.get("section_id"))
        if section_id is None or section_id not in valid_section_ids:
            logger.warning(
                f"[{i}/{total}] tombstone {row_id}: section not in this project - dropped"
            )
            dropped += 1
            continue
        raw_coords = [payload.get(key) for key in ("a_x", "a_y", "a_z", "b_x", "b_y", "b_z")]
        # bool is an int subclass; NaN and ±Infinity can never match a real
        # place — all three are corrupt here (the stdlib json parser accepts
        # the non-standard Infinity token, so it genuinely reaches this code).
        finite = [
            float(v)
            for v in raw_coords
            if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
        ]
        coords = finite if len(finite) == len(raw_coords) else None
        if coords is None:
            logger.warning(
                f"[{i}/{total}] tombstone {row_id}: non-numeric coordinate - dropped "
                f"(a corrupt place could silently suppress an unrelated tie forever)"
            )
            dropped += 1
            continue
        session.add(
            GeotechTieTombstoneOrm(
                id=row_id,
                model_id=model_id,
                section_id=section_id,
                a_x=coords[0],
                a_y=coords[1],
                a_z=coords[2],
                b_x=coords[3],
                b_y=coords[4],
                b_z=coords[5],
            )
        )
        new_rows += 1
        logger.debug(f"[{i}/{total}] tombstone {row_id} queued for insert")
    if dropped:
        logger.warning(
            f"restore_project_bundle({project_id}): dropped {dropped} deleted-tie tombstone(s)"
        )
    return new_rows, skipped, dropped


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
                select(BodyBoundaryShapeOrm.id)
                .join(GeologicalModelOrm, BodyBoundaryShapeOrm.model_id == GeologicalModelOrm.id)
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
        session.add(
            BodyBoundaryShapeOrm(**_apply_json_to_kwargs(BodyBoundaryShapeOrm, shape_payload))
        )
        valid_shape_ids.add(sid)
        new_shapes += 1

    existing_nodes: set[UUID] = set(
        (
            await session.execute(
                select(BodyBoundaryNodeOrm.id)
                .join(BodyBoundaryShapeOrm, BodyBoundaryNodeOrm.shape_id == BodyBoundaryShapeOrm.id)
                .join(GeologicalModelOrm, BodyBoundaryShapeOrm.model_id == GeologicalModelOrm.id)
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
        session.add(BodyBoundaryNodeOrm(**_apply_json_to_kwargs(BodyBoundaryNodeOrm, node_payload)))
        new_nodes += 1
    if dropped_shapes or dropped_nodes:
        logger.warning(
            f"restore_project_bundle({project_id}): dropped {dropped_shapes} lens shape(s) "
            f"+ {dropped_nodes} lens boundary node(s) (dangling FK)"
        )
    return new_shapes, dropped_shapes, new_nodes, dropped_nodes
