"""Resolve-litho-instances use case — layer-granularity body reconciliation.

Loads accepted ``litho_layer`` rows + user-approved correlation edges
(whose endpoints FK ``litho_layer.id``), runs the pure layer-level
resolver, reconciles one ``body`` row per connected component, stamps
``litho_layer.body_id`` on every member layer, and marks changed
surfaces stale. It no longer writes ``geological_formation.instance_ordinal``
— body identity ``(formation_id, body_ordinal)`` is the durable record
of an instance.

This use case is MODEL-level only.  It does NOT touch cross-section
rows, seeded_formation_contact_ids, or any section-level state.  The
#57/applyUpdatedSection trap structurally cannot recur here — there is
no section entity in scope.

The resolution + body-reconciliation + stale-marking logic lives in the
module-level ``_run_resolver`` helper; this is the single canonical copy.
All callers that previously delegated through ``CorrelateLithoUnits`` now
call this use case directly (or call ``_run_resolver`` for non-committing
paths inside other use cases).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TypedDict
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from uuid6 import uuid7

from groundmodel.application.body_partition_lock import lock_body_partition
from groundmodel.domain.services.resolve_litho_instances import (
    LayerEdge,
    LayerNode,
    LayerSeparation,
    resolve_litho_instances,
)
from groundmodel.infrastructure.db.models.body_boundary_shape_orm import BodyBoundaryShapeOrm
from groundmodel.infrastructure.db.models.body_geometry_fact_orm import BodyGeometryFactOrm
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.body_separation_orm import BodySeparationOrm
from groundmodel.infrastructure.db.models.body_union_orm import BodyUnionOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.infrastructure.db.repositories.litho_layer_repository import LithoLayerRepository
from groundmodel.shared.constants.model_kind import MODEL_KIND_GEOTECHNICAL
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class _BodyChange(TypedDict):
    """One body whose ordinal was created/removed during reconciliation.

    The shape is kept stable (``formation_id`` str + ``new_ordinal`` int)
    so the outer ``ResolveLithoInstances.execute`` can map it onto an
    ``OrdinalUpdate`` for the section's stale-surface cue.

    Attributes
    ----------
    formation_id : str
        String form of the body's formation UUID.
    new_ordinal : int
        The body's ordinal within its ``(parent, soil)`` naming group.
    """

    formation_id: str
    new_ordinal: int


@dataclass
class OrdinalUpdate:
    """One body whose reconciliation created or removed an ordinal.

    The resolver no longer writes ``geological_formation.instance_ordinal``;
    it reconciles ``body`` rows instead.  This struct reports one body
    change, but the field names are deliberately unchanged — the API schema
    and the frontend stale-cue badge consume ``new_ordinal`` (see the
    "Do NOT rename" review note).

    Attributes
    ----------
    formation_id : UUID
        Primary key of the geological_formation row the body belongs to.
    old_ordinal : int | None
        ALWAYS ``None`` on this path.  Body reconciliation is a
        create-or-delete operation keyed by ``(formation_id, ordinal)``;
        there is no prior-ordinal value to carry, so the old value is never
        threaded through.  Reserved for future callers that supply it.
    new_ordinal : int
        The BODY ordinal of the ``(formation_id, ordinal)`` instance whose
        body was created or removed during reconciliation.  (No longer an
        instance_ordinal write — body identity is now the durable record.)
    """

    formation_id: UUID
    old_ordinal: int | None
    new_ordinal: int


@dataclass
class ResolveResult:
    """Output of ``ResolveLithoInstances.execute`` — body reconciliation changes.

    The resolver reconciles ``body`` rows (one per connected component);
    it does NOT write ``instance_ordinal`` any more.  Each entry in
    ``updated`` reports a body that was created or removed for a
    ``(formation_id, ordinal)`` instance.

    Attributes
    ----------
    updated : list[OrdinalUpdate]
        One entry per body created/removed during reconciliation.  Empty
        when the resolver ran but the body set already matched the resolved
        instances (idempotent no-op).
    renamed : tuple[str, ...]
        Names displaced by lineage adoption (a merge where the oldest name
        won, or a shift where the survivor's own name gave way). Surfaced so
        the recompute toast can say what happened to the engineer's labels.
    inert_unions : tuple[tuple[UUID, UUID], ...]
        ALWAYS EMPTY since owner 2026-09-02: a "Join with…" is a GROUP relation,
        not a merge, so the resolver is passed ``unions=()`` and never marks a union
        inert. The "never a mixed body" guard now runs at write time in the
        body-unions router. Kept (empty) for schema stability — the router still
        reads it as a defensive backstop.
    suppressed_unions : tuple[tuple[UUID, UUID], ...]
        ALWAYS EMPTY since owner 2026-09-02 (and since separations went dormant,
        2026-09-01): a union never enters the partition, so nothing can suppress it.
        Kept (empty) for schema stability.
    """

    updated: list[OrdinalUpdate]
    renamed: tuple[str, ...] = ()
    inert_unions: tuple[tuple[UUID, UUID], ...] = ()
    suppressed_unions: tuple[tuple[UUID, UUID], ...] = ()


async def _run_resolver(
    session: AsyncSession, model_id: UUID, *, stale_solids: bool = True
) -> tuple[
    list[_BodyChange],
    tuple[str, ...],
    tuple[tuple[UUID, UUID], ...],
    tuple[tuple[UUID, UUID], ...],
]:
    """Resolve instances over layers, reconcile bodies, stamp body_id.

    Loads accepted litho layers + user-approved correlation edges (layer-id
    endpoints), runs the pure ``resolve_litho_instances`` domain service,
    reconciles one ``body`` row per connected component, stamps
    ``litho_layer.body_id`` on every member layer, and marks surfaces stale
    when an instance ordinal changed. No inner commit — the caller owns the
    transaction boundary.

    Takes the model's body-partition advisory lock first and holds it until the
    caller's COMMIT/ROLLBACK, so the read and the rewrite are one serialised
    unit — see ``body_partition_lock``. A caller that resolves SEVERAL models in
    one transaction therefore holds several locks and must take them in a
    canonical order (litho before its geotech child).

    Parameters
    ----------
    session : AsyncSession
        The active ORM session. The caller owns the commit boundary.
    model_id : UUID
        The lithostratigraphic model whose layers + edges are resolved.
    stale_solids : bool
        Whether a body-membership change should also stale the cached 3-D solids.
        ``True`` (default) for every geometry-changing caller. ``False`` ONLY for a
        body-identity-only resolve — a Join / Un-join (``body_unions``): those change
        which masses count as ONE BODY, not the voxel geometry or its packing class,
        so the stored solids stay valid and forcing a rebuild is wrong (owner
        2026-09-01, D3). Surfaces still stale on an ordinal change regardless.

    Returns
    -------
    tuple[list[_BodyChange], tuple[str, ...], tuple[tuple[UUID, UUID], ...], \
tuple[tuple[UUID, UUID], ...]]
        One ``{"formation_id": str, "new_ordinal": int}`` per body whose ordinal
        changed (drives the section's stale-surface cue); the names displaced by
        lineage adoption; and two ALWAYS-EMPTY tuples (inert / suppressed union
        pairs). Since owner 2026-09-02 a "Join with…" is a GROUP relation, not a
        merge, so ``unions=()`` is passed to the resolver — it never marks a union
        inert or suppressed. The two tuples are kept for signature stability.
    """
    repo = GeologyRepository(session)
    logger = _RunResolverLogger()
    logger.debug(f"_run_resolver: model {model_id}")

    # Everything below is a read-then-rewrite of ONE model's body partition.
    # Two requests doing it at once produced unique-violation, FK-violation and
    # deadlock 500s (see ``body_partition_lock``); the lock makes the read and
    # the rewrite one serialised unit. Taken BEFORE the first read, and
    # re-entrant for a caller that already holds it.
    await lock_body_partition(session, model_id=model_id, operation="resolve-litho-instances")

    model = await session.get(GeologicalModelOrm, model_id)
    if model is None:
        logger.warning(f"_run_resolver: model {model_id} gone — skipping")
        return [], (), (), ()

    # 1. Accepted layers joined to their formation for (parent, soil).
    layer_rows = (
        await session.execute(
            select(
                LithoLayerOrm.id,
                LithoLayerOrm.formation_id,
                LithoLayerOrm.depth_top_m,
                LithoLayerOrm.borehole_id,
                LithoLayerOrm.cpt_id,
                LithoLayerOrm.body_id,
                LithoLayerOrm.parent_litho_layer_id,
                GeologicalFormationOrm.parent_formation_id,
                GeologicalFormationOrm.litho_main_soil_code,
                GeologicalFormationOrm.nad_class,
            )
            .join(GeologicalFormationOrm, GeologicalFormationOrm.id == LithoLayerOrm.formation_id)
            .where(
                LithoLayerOrm.model_id == model_id,
                LithoLayerOrm.status == "accepted",
            )
        )
    ).all()

    # A GEOTECH body is one soil AND one packing density (owner, 2026-08-19:
    # *"if a lens is touching a body with same litho and packing then lens
    # disappears and it becomes one body, in the renderer and in the database"*).
    # The band's own formation row IS its packing class, so it travels as the
    # resolver's mass filter. A litho model passes none and is untouched.
    is_geotechnical = model.kind == MODEL_KIND_GEOTECHNICAL
    nodes: list[LayerNode] = [
        LayerNode(
            layer_id=r.id,
            formation_id=r.formation_id,
            parent_formation_id=r.parent_formation_id,
            litho_main_soil_code=r.litho_main_soil_code,
            depth_top_m=r.depth_top_m,
            source_investigation_id=(r.borehole_id if r.borehole_id is not None else r.cpt_id),
            packing_formation_id=r.formation_id if is_geotechnical else None,
            # The CLASS the row states — the mass identity the resolver compares
            # (owner 2026-08-21: one mass one body). None on litho and on
            # skeleton bands, where the row comparison stands.
            packing_nad_class=r.nad_class if is_geotechnical else None,
        )
        for r in layer_rows
    ]
    existing_body_id_by_layer: dict[UUID, UUID | None] = {r.id: r.body_id for r in layer_rows}
    # (depth_top_m, parent_litho_layer_id) per layer — read by the geotech-body
    # litho-parent stamp (step 5b, debt #278 R1). parent_litho_layer_id is NULL
    # on litho-model rows, so this only carries anything on a geotech resolve.
    layer_meta: dict[UUID, tuple[float, UUID | None]] = {
        r.id: (r.depth_top_m, r.parent_litho_layer_id) for r in layer_rows
    }

    # 2. User-approved edges, MINUS the ones under review — endpoints already FK
    #    litho_layer.id.
    #
    #    A tie does two jobs: it draws the correlation, and it unions its two layers
    #    into one body. A hand edit that breaks the class match keeps the tie and
    #    flags it (flag-not-drop), and until 2026-08-10 the flagged tie went on
    #    unioning — which left one body spanning two packing classes. The owner met
    #    that on his own model: a body holding NAD 8 and NAD 7 at once, and pressing
    #    Build there would have welded a very dense sand to a dense sand across the
    #    gap and exported it.
    #
    #    A body's contract is one packing class, so a shape that breaks it must not
    #    survive on the strength of a correlation the engineer has been asked to
    #    re-judge. The tie itself is untouched: still kept, still self-healing, still
    #    badged. Only its effect on the model is suspended while it waits.
    #
    #    The suspension is scoped to the flags that cast doubt on the UNION itself
    #    (owner ruling refined 2026-08-11, audit F31): ``class_changed`` means the
    #    two ends no longer describe the same ground, ``ambiguous_band`` means the
    #    re-anchor could not be sure WHICH band the tie was drawn on — both doubts
    #    a union must not ride on. ``band_absorbed`` is different: the band the tie
    #    was drawn on was absorbed and the survivor still MATCHES the partner, so
    #    the correlation is still right — and since that flag never self-heals and
    #    is deliberately excluded from the keep-or-delete prompt (asking "these no
    #    longer match" about it would be false), suspending for it too meant every
    #    routine contact drag-merge silently and durably fragmented bodies.
    #
    #    Litho edges are unaffected in practice — nothing on that side writes a review
    #    reason — so this reads as a geotech rule even though it lives in the shared
    #    resolver, which is where the union is decided for both.
    edge_rows = (
        await session.execute(
            select(
                LithoContactCorrelationEdgeOrm.layer_a_id,
                LithoContactCorrelationEdgeOrm.layer_b_id,
            ).where(
                LithoContactCorrelationEdgeOrm.model_id == model_id,
                LithoContactCorrelationEdgeOrm.user_approved.is_(True),
                LithoContactCorrelationEdgeOrm.review_reason.notin_(
                    ["class_changed", "ambiguous_band"]
                )
                | LithoContactCorrelationEdgeOrm.review_reason.is_(None),
            )
        )
    ).all()
    edges = [LayerEdge(layer_a_id=a, layer_b_id=b) for a, b in edge_rows]

    # 2b. Geometry facts union like ties (owner ruling 2026-08-12: "every same
    #     litho that is connected should get the same body id"). A fact records
    #     observed geometric adjacency in the partition fill — connectivity a
    #     tie cannot state without redrawing the fill, because a tie defines
    #     both the 2/1/0 geometry AND body membership. Facts are written only
    #     by RecomputeBodies (full replace per model) and ride the SAME guards
    #     as ties inside the pure resolver: the one-lithology filter and the
    #     dangling-endpoint guard, so a rejected or deleted layer neutralises a
    #     stale fact until the next recompute refreshes it.
    fact_rows = (
        await session.execute(
            select(
                BodyGeometryFactOrm.layer_a_id,
                BodyGeometryFactOrm.layer_b_id,
            ).where(BodyGeometryFactOrm.model_id == model_id)
        )
    ).all()
    edges.extend(LayerEdge(layer_a_id=a, layer_b_id=b) for a, b in fact_rows)

    # 2c. User "Separate" rulings (debt #278 R5) — cannot-link constraints that
    #     forbid two anchors from ever landing in one body, however the ties and
    #     facts above would connect them. ONLY the user writes these (the
    #     tombstone rule): the resolver READS them and drops any union that would
    #     violate one. A separation whose anchor left the model is inert inside
    #     the pure resolver (the dangling-anchor guard), so a stale row never
    #     fragments the wrong body between a wipe and the re-anchor.
    separation_rows = (
        await session.execute(
            select(
                BodySeparationOrm.layer_a_id,
                BodySeparationOrm.layer_b_id,
            ).where(BodySeparationOrm.model_id == model_id)
        )
    ).all()
    separations = [LayerSeparation(layer_a_id=a, layer_b_id=b) for a, b in separation_rows]

    # 2d. User "Join with…" GROUP rulings (debt #278). DORMANT for identity since
    #     owner 2026-09-02: a union is a GROUP relation, NOT a merge — it lumps
    #     similar bodies for exports / display ("group 3 (silt FF)") and must NEVER
    #     change a body_id. Body identity is geometry-only, so these rows are NOT
    #     fed to the resolver as must-links (``unions=()`` below); the grouping is
    #     resolved client-side (``geotechGroupOrdinals``). We still COUNT them for
    #     the phase log, and EVERY OTHER use of the rows is untouched (the
    #     body_union table, its router, the re-anchor across a re-subdivide, and
    #     .strix bundle persistence), so a group survives a recompute / re-subdivide
    #     / reopen. Mirrors the dormant ``separations`` handling above.
    union_rows = (
        await session.execute(
            select(
                BodyUnionOrm.layer_a_id,
                BodyUnionOrm.layer_b_id,
            ).where(BodyUnionOrm.model_id == model_id)
        )
    ).all()

    logger.debug(
        f"_run_resolver: {len(nodes)} layer(s), {len(edge_rows)} edge(s), "
        f"{len(fact_rows)} geometry fact(s), {len(separation_rows)} separation(s), "
        f"{len(union_rows)} union(s)"
    )

    # Body identity is geometry-only (owner 2026-09-02): a "Join with…" is a GROUP
    # relation, not a merge, so the union rows are NOT passed as must-links. The
    # resolve is identical whether or not groups exist.
    result = resolve_litho_instances(layers=nodes, edges=edges, separations=separations, unions=())

    # DORMANT backstop (owner 2026-09-02): with ``unions=()`` above, the resolver
    # never marks a union inert or suppressed, so ``inert_unions`` / ``suppressed_
    # unions`` are always empty and these loops never fire. Kept as a defensive
    # backstop (and to keep the WARN wording near its data) — a later slice removes
    # the union path here entirely.
    for u in result.inert_unions:
        logger.warning(
            f"_run_resolver: model {model_id} — user join ({u.layer_a_id}, {u.layer_b_id}) "
            f"is INERT: classes re-derived apart, never a mixed body"
        )
    for u in result.suppressed_unions:
        logger.warning(
            f"_run_resolver: model {model_id} — user join ({u.layer_a_id}, {u.layer_b_id}) "
            f"is SUPPRESSED by a standing separation (cannot-link wins)"
        )

    # 3. Reconcile bodies. Existing bodies keyed (formation_id, ordinal).
    existing_bodies = (
        (await session.execute(select(BodyOrm).where(BodyOrm.model_id == model_id))).scalars().all()
    )
    body_by_key: dict[tuple[UUID, int], BodyOrm] = {
        (b.formation_id, b.body_ordinal): b for b in existing_bodies
    }

    wanted_keys: set[tuple[UUID, int]] = set()
    layer_to_body_id: dict[UUID, UUID] = {}
    changed: list[_BodyChange] = []

    for inst in result.instances:
        key = (inst.formation_id, inst.ordinal)
        wanted_keys.add(key)
        body = body_by_key.get(key)
        if body is None:
            body = BodyOrm(
                id=uuid7(),
                app_project_id=model.app_project_id,
                model_id=model_id,
                formation_id=inst.formation_id,
                body_ordinal=inst.ordinal,
                source_investigation_id=inst.source_investigation_id,
            )
            session.add(body)
            body_by_key[key] = body
            changed.append({"formation_id": str(inst.formation_id), "new_ordinal": inst.ordinal})
            logger.debug(f"_run_resolver: created body f={inst.formation_id} ord={inst.ordinal}")
        for lid in inst.member_layer_ids:
            layer_to_body_id[lid] = body.id

    # 3b. LINEAGE ADOPTION — user-authored state follows the BODY, not the row
    #     (owner ruling 2026-08-12: "oldest name wins"). The (formation,
    #     ordinal) key recycles rows on every renumbering, so ``created_at`` of
    #     the surviving ROW is not the body's age; age comes from the lineage —
    #     the rows that stamped this component's members before this run. A
    #     donor still representing its own component keeps everything (a split
    #     must not strip the remainder); a donor that stops representing
    #     anything hands its name over (the name MOVES — one name, one owner)
    #     and may then be deleted as an unnamed orphan in step 4, while its
    #     hand-drawn boundary and colour fill the survivor's holes instead of
    #     dying with the recycled row (the boundary FK is ON DELETE CASCADE).
    body_by_id: dict[UUID, BodyOrm] = {b.id: b for b in existing_bodies}
    shape_by_body: dict[UUID, BodyBoundaryShapeOrm] = {}
    if body_by_id:
        shape_rows = (
            (
                await session.execute(
                    select(BodyBoundaryShapeOrm).where(
                        BodyBoundaryShapeOrm.body_id.in_(list(body_by_id.keys()))
                    )
                )
            )
            .scalars()
            .all()
        )
        shape_by_body = {s.body_id: s for s in shape_rows}
    # New rows have no created_at until flush — treat them as youngest.
    _age_floor = datetime.max.replace(tzinfo=UTC)

    def _age(b: BodyOrm) -> tuple[datetime, str]:
        return (b.created_at or _age_floor, str(b.id))

    renamed: list[str] = []
    for inst in result.instances:
        target = body_by_key[(inst.formation_id, inst.ordinal)]
        lineage_ids = {existing_body_id_by_layer.get(lid) for lid in inst.member_layer_ids}
        lineage_ids.discard(None)
        lineage_ids.discard(target.id)
        donors: list[BodyOrm] = []
        for bid in lineage_ids:
            donor = body_by_id.get(bid) if bid is not None else None
            if donor is None:
                continue
            if (donor.formation_id, donor.body_ordinal) in wanted_keys:
                continue  # still representing its own component (a split)
            donors.append(donor)
        if not donors:
            continue
        donors.sort(key=_age)
        named = sorted((b for b in (target, *donors) if b.name), key=_age)
        if named:
            winner = named[0]
            if winner is not target:
                if target.name:
                    renamed.append(target.name)
                target.name = winner.name
                winner.name = None
                logger.debug(
                    f"_run_resolver: body {target.id} adopted name {target.name!r} "
                    f"from lineage donor {winner.id}"
                )
            for loser in named:
                if loser is winner or loser is target or not loser.name:
                    continue
                renamed.append(loser.name)
        for donor in donors:
            if target.display_color is None and donor.display_color:
                target.display_color = donor.display_color
            if target.primary_section_id is None and donor.primary_section_id is not None:
                target.primary_section_id = donor.primary_section_id
        if target.id not in shape_by_body:
            for donor in donors:
                shape = shape_by_body.pop(donor.id, None)
                if shape is not None:
                    shape.body_id = target.id
                    shape_by_body[target.id] = shape
                    break

    # 4. Delete orphan bodies (no longer a wanted instance) UNLESS named.
    for (f_id, ordn), body in body_by_key.items():
        if (f_id, ordn) in wanted_keys:
            continue
        if body.name:
            logger.debug(f"_run_resolver: preserving named orphan body {body.id} ({body.name!r})")
            continue
        await session.delete(body)
        changed.append({"formation_id": str(f_id), "new_ordinal": ordn})
        logger.debug(f"_run_resolver: deleted orphan body f={f_id} ord={ordn}")

    await session.flush()  # bodies get their ids before stamping layers

    # 5. Stamp litho_layer.body_id where it changed — grouped by target body so
    #    it's ONE UPDATE per body, not one per layer (audit #10: the per-layer
    #    loop was an N+1 issuing one round-trip per stamped layer on every
    #    accept / auto-correlate / startup sweep).
    layers_by_target: dict[UUID, list[UUID]] = defaultdict(list)
    for lid, bid in layer_to_body_id.items():
        if existing_body_id_by_layer.get(lid) != bid:
            layers_by_target[bid].append(lid)
    n_stamped = sum(len(lids) for lids in layers_by_target.values())
    for bid, lids in layers_by_target.items():
        await session.execute(
            update(LithoLayerOrm).where(LithoLayerOrm.id.in_(lids)).values(body_id=bid)
        )

    # 5b. Stamp body.parent_litho_body_id — the litho parent BODY each geotech
    #     body subdivides (debt #278, R1, owner 2026-08-31: "one connected
    #     geotech body = one row with an FK to its litho parent"). It is derivable
    #     via the SHALLOWEST member band's ``parent_litho_layer_id`` -> that litho
    #     layer's ``body_id`` — mirroring the shallowest-member rule the body
    #     formation stamp uses — but the owner ruled it STORED so the units pane,
    #     fence and exports read one connected body's litho parent from one column.
    #     A LITHO resolve re-stamps these from the other side (step 6) whenever it
    #     re-mints litho body ids, so the stored FK cannot dangle.
    if is_geotechnical:
        parent_layer_ids = {plid for _dt, plid in layer_meta.values() if plid is not None}
        litho_body_by_parent_layer: dict[UUID, UUID | None] = {}
        if parent_layer_ids:
            litho_body_by_parent_layer = {
                ll_id: ll_body_id
                for ll_id, ll_body_id in (
                    await session.execute(
                        select(LithoLayerOrm.id, LithoLayerOrm.body_id).where(
                            LithoLayerOrm.id.in_(parent_layer_ids)
                        )
                    )
                ).all()
            }
        for inst in result.instances:
            body = body_by_key[(inst.formation_id, inst.ordinal)]
            # Members carrying a covering litho band, as (depth_top, band id,
            # parent layer id). ``member_layer_ids`` is a SET, so iteration order
            # is meaningless; the tie-break must be explicit and must match the
            # rest of the system (domain ``_key``, step 6's SQL, the PLB test
            # oracle) or an exact depth tie between members with DIFFERENT litho
            # parents would pick nondeterministically and could disagree with
            # step 6. So sort by ``(depth_top_m, str(band id))`` — the same order
            # step 6 takes with ``geo_band.depth_top_m, geo_band.id``. A member
            # with no parent_litho_layer_id contributes nothing.
            members: list[tuple[float, str, UUID]] = []
            for lid in inst.member_layer_ids:
                meta = layer_meta.get(lid)
                if meta is None or meta[1] is None:
                    continue
                members.append((meta[0], str(lid), meta[1]))
            members.sort(key=lambda m: (m[0], m[1]))
            if not members:
                body.parent_litho_body_id = None
                continue
            distinct_parents = {litho_body_by_parent_layer.get(plid) for _d, _lid, plid in members}
            distinct_parents.discard(None)
            shallowest_parent = litho_body_by_parent_layer.get(members[0][2])
            if len(distinct_parents) > 1:
                logger.info(
                    f"_run_resolver: geotech body {body.id} members disagree on litho "
                    f"parent body ({sorted(str(b) for b in distinct_parents)}); stamping "
                    f"the shallowest member's parent {shallowest_parent}"
                )
            body.parent_litho_body_id = shallowest_parent

    if changed or n_stamped:
        await session.flush()
        pairs = [(model_id, UUID(c["formation_id"])) for c in changed]
        if pairs:
            await repo.mark_surfaces_stale(pairs)
        # Body membership changed → 3-D solid cache is stale — EXCEPT on a
        # body-identity-only resolve (a Join / Un-join). There the voxel geometry
        # and every voxel's packing class are unchanged; only which masses count as
        # ONE BODY moves, so the stored solids stay valid and forcing a rebuild is
        # wrong (owner 2026-09-01, D3). ``stale_solids=False`` from those callers
        # alone; every geometry-changing caller keeps the default True.
        if stale_solids:
            await LithoLayerRepository(session).mark_litho_solids_stale(model_id)
        logger.info(
            f"_run_resolver: {len(changed)} body change(s), {n_stamped} layer stamp(s) "
            f"for model {model_id} (stale_solids={stale_solids})"
        )
    else:
        logger.debug(f"_run_resolver: no changes for model {model_id}")

    # 6. A LITHO resolve re-mints litho body ids, so re-stamp every sibling
    #    GEOTECH model's body.parent_litho_body_id in the SAME transaction —
    #    otherwise a re-minted litho body id would leave every geotech body under
    #    it dangling until the next subdivide (debt #278, R1). One set-based
    #    UPDATE: each geotech body takes the litho body its SHALLOWEST member band
    #    subdivides (DISTINCT ON, shallowest first — the same rule step 5b stamps
    #    from the geotech side).
    #
    #    This UPDATE writes body.parent_litho_body_id on the GEOTECH model — the
    #    same column step 5b writes from the geotech side. The two sides share no
    #    lock by default (litho verbs — correlate / accept / delete-layer /
    #    update-contact / litho recompute — vs geotech verbs — set-class / split /
    #    merge / move-boundary / geotech recompute), so without a lock a concurrent
    #    geotech resolve's step-5b ORM write and this UPDATE could both write one
    #    body's FK last-commit-wins from possibly-stale snapshots — a silently
    #    WRONG non-NULL parent that persists (feeding the units pane / fence /
    #    exports) until that geotech model next resolves. So take each sibling
    #    geotech model's partition lock HERE, with the litho lock already held:
    #    litho-parent-first is exactly the order ``body_partition_lock`` mandates,
    #    so the geotech lock taken second introduces no new deadlock class. Sorted
    #    so two litho resolves acquire the sibling locks in one canonical order.
    if not is_geotechnical:
        sibling_geotech_ids = (
            (
                await session.execute(
                    select(GeologicalModelOrm.id).where(
                        GeologicalModelOrm.parent_model_id == model_id,
                        GeologicalModelOrm.kind == MODEL_KIND_GEOTECHNICAL,
                    )
                )
            )
            .scalars()
            .all()
        )
        if sibling_geotech_ids:
            for sibling_id in sorted(sibling_geotech_ids, key=str):
                await lock_body_partition(
                    session, model_id=sibling_id, operation="restamp-parent-litho-body"
                )
            geo_band = aliased(LithoLayerOrm)
            litho_band = aliased(LithoLayerOrm)
            parent_subq = (
                select(
                    geo_band.body_id.label("geo_body_id"),
                    litho_band.body_id.label("litho_body_id"),
                )
                .join(litho_band, litho_band.id == geo_band.parent_litho_layer_id)
                .where(
                    geo_band.model_id.in_(sibling_geotech_ids),
                    geo_band.body_id.is_not(None),
                    geo_band.parent_litho_layer_id.is_not(None),
                )
                .distinct(geo_band.body_id)
                .order_by(geo_band.body_id, geo_band.depth_top_m.asc(), geo_band.id.asc())
                .subquery()
            )
            await session.execute(
                update(BodyOrm)
                .where(BodyOrm.id == parent_subq.c.geo_body_id)
                .values(parent_litho_body_id=parent_subq.c.litho_body_id)
            )

    inert_pairs = tuple((u.layer_a_id, u.layer_b_id) for u in result.inert_unions)
    suppressed_pairs = tuple((u.layer_a_id, u.layer_b_id) for u in result.suppressed_unions)
    return changed, tuple(renamed), inert_pairs, suppressed_pairs


class _RunResolverLogger(GroundModelLogger):
    """Internal logger for the module-level ``_run_resolver`` helper."""

    def __init__(self) -> None:
        """Initialise with this module's name."""
        super().__init__(__name__)


class ResolveLithoInstances(GroundModelLogger):
    """Re-run the litho-instance resolver for one model and commit the result.

    Loads accepted litho layers + user-approved layer-level correlation
    edges, runs the pure domain resolver, reconciles one ``body`` row per
    connected component, stamps ``litho_layer.body_id``, and marks changed
    surfaces stale.

    This is the single canonical copy of the resolver implementation —
    ``CorrelateLithoUnits`` and ``UncorrelateLithoContacts`` delegate here
    via the shared ``_run_resolver`` module-level helper.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        model_id: UUID,
        commit: bool = True,
        stale_solids: bool = True,
    ) -> ResolveResult:
        """Run the resolver and (optionally) commit ordinal updates for ``model_id``.

        Parameters
        ----------
        model_id : UUID
            The lithostratigraphic model whose formations are resolved.
            The caller (API handler) must have already verified the model
            belongs to the request's project.
        commit : bool
            When ``True`` (default), commits the session after writing
            ordinals — appropriate for the explicit-resolve API path.
            When ``False``, only flushes; the caller owns the commit
            boundary.  Pass ``False`` when calling from inside
            ``CorrelateLithoContacts`` or ``UncorrelateLithoContacts``
            so all mutations in a single request land in one transaction.
        stale_solids : bool
            Whether a body-membership change should also stale the cached 3-D
            solids. ``True`` (default) for every geometry-changing caller;
            ``False`` ONLY for a body-identity-only resolve (a Join / Un-join),
            where the voxel geometry is unchanged and forcing a rebuild is wrong
            (owner 2026-09-01, D3). Forwarded verbatim to ``_run_resolver``.

        Returns
        -------
        ResolveResult
            The list of per-formation ordinal changes.  Empty when
            nothing changed (idempotent re-resolve).

        Notes
        -----
        This use case is MODEL-level only.  It never modifies
        ``seeded_formation_contact_ids`` on any cross-section — the #57
        trap structurally cannot recur here.
        """
        self.info(f"ResolveLithoInstances: resolving model {model_id}")

        raw_updates, renamed, inert_unions, suppressed_unions = await _run_resolver(
            self._session, model_id, stale_solids=stale_solids
        )

        # Commit or flush depending on whether the caller owns the transaction.
        if commit:
            await self._session.commit()
        else:
            await self._session.flush()

        # _run_resolver returns list[{"formation_id": str, "new_ordinal": int}].
        # old_ordinal is not tracked at that level — surface None for the
        # explicit-resolve path (the client only needs formation_id + new_ordinal
        # for the badge cue; old_ordinal is informational).
        updated = [
            OrdinalUpdate(
                formation_id=UUID(item["formation_id"]),
                old_ordinal=None,
                new_ordinal=item["new_ordinal"],
            )
            for item in raw_updates
        ]
        if renamed:
            # Count at INFO, the names themselves at DEBUG: unit names are
            # normally stratigraphic labels, but a user can rename a unit to
            # echo a site, and ``backend.log`` is unredacted on disk. The
            # phase-summary count stays always-on; the list is a DEBUG detail.
            self.info(f"ResolveLithoInstances: {len(renamed)} name(s) displaced")
            self.debug(f"ResolveLithoInstances: names displaced: {list(renamed)}")

        if updated:
            self.success(
                f"ResolveLithoInstances: committed {len(updated)} ordinal "
                f"update(s) for model {model_id}"
            )
        else:
            self.info(
                f"ResolveLithoInstances: no ordinal changes for model {model_id} (idempotent no-op)"
            )

        return ResolveResult(
            updated=updated,
            renamed=renamed,
            inert_unions=inert_unions,
            suppressed_unions=suppressed_unions,
        )
