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

from dataclasses import dataclass
from typing import TypedDict
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.domain.services.resolve_litho_instances import (
    LayerEdge,
    LayerNode,
    resolve_litho_instances,
)
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
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
    """

    updated: list[OrdinalUpdate]


async def _run_resolver(session: AsyncSession, model_id: UUID) -> list[_BodyChange]:
    """Resolve instances over layers, reconcile bodies, stamp body_id.

    Loads accepted litho layers + user-approved correlation edges (layer-id
    endpoints), runs the pure ``resolve_litho_instances`` domain service,
    reconciles one ``body`` row per connected component, stamps
    ``litho_layer.body_id`` on every member layer, and marks surfaces stale
    when an instance ordinal changed. No inner commit — the caller owns the
    transaction boundary.

    Parameters
    ----------
    session : AsyncSession
        The active ORM session. The caller owns the commit boundary.
    model_id : UUID
        The lithostratigraphic model whose layers + edges are resolved.

    Returns
    -------
    list[_BodyChange]
        One ``{"formation_id": str, "new_ordinal": int}`` per body whose
        ordinal changed (drives the section's stale-surface cue).
    """
    repo = GeologyRepository(session)
    logger = _RunResolverLogger()
    logger.debug(f"_run_resolver: model {model_id}")

    model = await session.get(GeologicalModelOrm, model_id)
    if model is None:
        logger.warning(f"_run_resolver: model {model_id} gone — skipping")
        return []

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
                GeologicalFormationOrm.parent_formation_id,
                GeologicalFormationOrm.litho_main_soil_code,
            )
            .join(GeologicalFormationOrm, GeologicalFormationOrm.id == LithoLayerOrm.formation_id)
            .where(
                LithoLayerOrm.model_id == model_id,
                LithoLayerOrm.status == "accepted",
            )
        )
    ).all()

    nodes: list[LayerNode] = [
        LayerNode(
            layer_id=r.id,
            formation_id=r.formation_id,
            parent_formation_id=r.parent_formation_id,
            litho_main_soil_code=r.litho_main_soil_code,
            depth_top_m=r.depth_top_m,
            source_investigation_id=(r.borehole_id if r.borehole_id is not None else r.cpt_id),
        )
        for r in layer_rows
    ]
    existing_body_id_by_layer: dict[UUID, UUID | None] = {r.id: r.body_id for r in layer_rows}

    # 2. User-approved edges — endpoints already FK litho_layer.id.
    edge_rows = (
        await session.execute(
            select(
                LithoContactCorrelationEdgeOrm.contact_a_id,
                LithoContactCorrelationEdgeOrm.contact_b_id,
            ).where(
                LithoContactCorrelationEdgeOrm.model_id == model_id,
                LithoContactCorrelationEdgeOrm.user_approved.is_(True),
            )
        )
    ).all()
    edges = [LayerEdge(layer_a_id=a, layer_b_id=b) for a, b in edge_rows]

    logger.debug(f"_run_resolver: {len(nodes)} layer(s), {len(edges)} edge(s)")

    result = resolve_litho_instances(layers=nodes, edges=edges)

    # 3. Reconcile bodies. Existing bodies keyed (formation_id, ordinal).
    existing_bodies = (
        (await session.execute(select(BodyOrm).where(BodyOrm.model_id == model_id))).scalars().all()
    )
    body_by_key: dict[tuple[UUID, int], BodyOrm] = {
        (b.formation_id, b.body_ordinal): b for b in existing_bodies
    }

    # Snapshot user-claimed (ANCHORED) extents BEFORE reconciliation so they
    # can be carried forward by their anchor layer (debt #195).  A user open /
    # pinch claim lives on a body, but an instance renumber orphan-deletes that
    # body and creates a fresh one — without carry-forward the claim vanishes
    # (the dogfeed "succeed toast but nothing renders" for a deep unit).  Each
    # tuple is (anchor_layer_id, side, kind, target_contact_id, neighbour_inv_id);
    # only sides that carry an anchor are snapshotted — detector / legacy
    # extents without one stay on their body if it survives (status quo).
    extent_snapshots: list[tuple[UUID, str, str, UUID | None, UUID | None]] = []
    for b in existing_bodies:
        for side in ("left", "right"):
            anchor = getattr(b, f"extent_{side}_anchor_layer_id")
            kind = getattr(b, f"extent_{side}_kind")
            if anchor is None or kind is None:
                continue
            extent_snapshots.append(
                (
                    anchor,
                    side,
                    kind,
                    getattr(b, f"extent_{side}_target_contact_id"),
                    getattr(b, f"extent_{side}_neighbour_inv_id"),
                )
            )
    # Deterministic re-apply order (first-wins per body+side on a conflict).
    extent_snapshots.sort(key=lambda s: (str(s[0]), s[1]))

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

    # 5. Stamp litho_layer.body_id where it changed.
    n_stamped = 0
    for lid, bid in layer_to_body_id.items():
        if existing_body_id_by_layer.get(lid) != bid:
            await session.execute(
                update(LithoLayerOrm).where(LithoLayerOrm.id == lid).values(body_id=bid)
            )
            n_stamped += 1

    # 6. Carry anchored extents forward by anchor layer (debt #195).
    # A user open / pinch claim lives on a body, but an instance renumber
    # orphan-deletes that body and creates a fresh one — without carry-forward
    # the claim vanishes.  Re-derive the DESIRED anchored-extent state from the
    # snapshot: each claim re-attaches to the body that NOW owns its anchor
    # layer.  Then diff against the live bodies and write ONLY the differences,
    # so a stable re-resolve (the common case) makes zero writes.  An anchor
    # whose layer is no longer accepted (unit deleted) is silently dropped.
    live_bodies = [b for key, b in body_by_key.items() if key in wanted_keys or b.name]
    desired: dict[tuple[UUID, str], tuple[str, UUID | None, UUID | None, UUID]] = {}
    for anchor, side, kind, target, neighbour in extent_snapshots:
        new_body_id = layer_to_body_id.get(anchor)
        if new_body_id is None:
            continue  # anchor layer no longer accepted → drop the claim
        body_side_key = (new_body_id, side)
        if body_side_key in desired:
            continue  # first-wins on a conflict (deterministic snapshot order)
        desired[body_side_key] = (kind, target, neighbour, anchor)

    n_carried = 0
    for b in live_bodies:
        for side in ("left", "right"):
            cur_anchor = getattr(b, f"extent_{side}_anchor_layer_id")
            want = desired.get((b.id, side))
            if want is None:
                # No claim belongs here now — clear ONLY if this side currently
                # holds an anchored extent (it moved to another body).
                if cur_anchor is not None:
                    setattr(b, f"extent_{side}_kind", None)
                    setattr(b, f"extent_{side}_target_contact_id", None)
                    setattr(b, f"extent_{side}_neighbour_inv_id", None)
                    setattr(b, f"extent_{side}_anchor_layer_id", None)
                    n_carried += 1
                continue
            current = (
                getattr(b, f"extent_{side}_kind"),
                getattr(b, f"extent_{side}_target_contact_id"),
                getattr(b, f"extent_{side}_neighbour_inv_id"),
                cur_anchor,
            )
            if current == want:
                continue  # already correct → no write
            kind, target, neighbour, anchor = want
            setattr(b, f"extent_{side}_kind", kind)
            setattr(b, f"extent_{side}_target_contact_id", target)
            setattr(b, f"extent_{side}_neighbour_inv_id", neighbour)
            setattr(b, f"extent_{side}_anchor_layer_id", anchor)
            n_carried += 1
    if n_carried:
        logger.info(f"_run_resolver: carried {n_carried} anchored extent(s) forward")

    if changed or n_stamped or n_carried:
        await session.flush()
        pairs = [(model_id, UUID(c["formation_id"])) for c in changed]
        if pairs:
            await repo.mark_surfaces_stale(pairs)
        logger.info(
            f"_run_resolver: {len(changed)} body change(s), {n_stamped} layer stamp(s) "
            f"for model {model_id}"
        )
    else:
        logger.debug(f"_run_resolver: no changes for model {model_id}")

    return changed


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

        raw_updates = await _run_resolver(self._session, model_id)

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

        if updated:
            self.success(
                f"ResolveLithoInstances: committed {len(updated)} ordinal "
                f"update(s) for model {model_id}"
            )
        else:
            self.info(
                f"ResolveLithoInstances: no ordinal changes for model {model_id} (idempotent no-op)"
            )

        return ResolveResult(updated=updated)
