"""Resolve-litho-instances use case — Phase-2 Slice 3.

Loads model-scoped contact edges and formations, runs the pure resolver,
writes ``instance_ordinal`` back to non-locked rows, and marks changed
surfaces stale.

This use case is MODEL-level only.  It does NOT touch cross-section
rows, seeded_formation_contact_ids, or any section-level state.  The
#57/applyUpdatedSection trap structurally cannot recur here — there is
no section entity in scope.

The resolution + write-back + stale-marking logic lives entirely in
``execute``; this is the single canonical copy (formerly in
``CorrelateLithoUnits.run_resolver``).  All callers that previously
delegated through ``CorrelateLithoUnits`` now call this use case
directly (or call the inline helper ``_run_resolver`` for non-committing
paths inside other use cases).
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.domain.services.resolve_litho_instances import (
    CorrelationEdge,
    FormationNode,
    resolve_litho_instances,
)
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass
class OrdinalUpdate:
    """One formation whose instance_ordinal changed after resolution.

    Attributes
    ----------
    formation_id : UUID
        Primary key of the geological_formation row.
    old_ordinal : int | None
        The ordinal before the resolver ran.  ALWAYS ``None`` on the
        explicit-resolve path: the write-back captures the pre-mutation
        value for the debug log only and does not surface it in the
        return list.  Reserved for future callers that thread the old
        value through explicitly (review SF-2).
    new_ordinal : int
        The ordinal assigned by the resolver.
    """

    formation_id: UUID
    old_ordinal: int | None
    new_ordinal: int


@dataclass
class ResolveResult:
    """Output of ``ResolveLithoInstances.execute``.

    Attributes
    ----------
    updated : list[OrdinalUpdate]
        One entry per formation whose ``instance_ordinal`` changed.
        Empty when the resolver ran but found nothing to change
        (idempotent no-op).
    """

    updated: list[OrdinalUpdate]


async def _run_resolver(session: AsyncSession, model_id: UUID) -> list[dict]:
    """Run the pure resolver and write instance_ordinal back to changed rows.

    This is the canonical resolver implementation.  It loads all
    user-approved contact edges for the model, derives formation-level
    correlation edges from the contact→formation map, runs the pure
    ``resolve_litho_instances`` domain service, writes ordinals back to
    non-locked formations, and marks changed surfaces stale — all within
    the current session (no inner commit).

    Parameters
    ----------
    session : AsyncSession
        The active ORM session.  The caller owns the commit boundary.
    model_id : UUID
        The model whose formations and edges are resolved.

    Returns
    -------
    list[dict]
        One ``{"formation_id": str, "new_ordinal": int}`` entry per
        formation whose ordinal changed.
    """
    repo = GeologyRepository(session)
    logger = _RunResolverLogger()

    logger.debug(f"_run_resolver: loading formations + edges for model {model_id}")

    model = await session.get(GeologicalModelOrm, model_id)
    if model is None:
        logger.warning(f"_run_resolver: model {model_id} gone — skipping")
        return []

    # Load all user-approved contact edges for this model.  These are the
    # authority for the correlation graph since Phase-3 of #133: formation-
    # level LithoCorrelationEdgeOrm rows are no longer read here.
    contact_edges_stmt = select(LithoContactCorrelationEdgeOrm).where(
        LithoContactCorrelationEdgeOrm.model_id == model_id,
        LithoContactCorrelationEdgeOrm.user_approved.is_(True),
    )
    contact_edge_rows = list((await session.execute(contact_edges_stmt)).scalars().all())
    n_edges = len(contact_edge_rows)
    logger.debug(f"_run_resolver: {n_edges} user-approved contact edge(s) for model {model_id}")

    # Build contact_id → formation_id map from all contacts in this model.
    contacts_stmt = select(FormationContactOrm.id, FormationContactOrm.formation_id).where(
        FormationContactOrm.model_id == model_id
    )
    formation_by_contact: dict[UUID, UUID] = dict((await session.execute(contacts_stmt)).all())

    # Derive formation-to-formation CorrelationEdge objects from contact edges.
    # Skip self-loops (both contacts map to the same formation) and orphans.
    edges: list[CorrelationEdge] = []
    skipped_orphan = 0
    skipped_self_loop = 0
    for ce in contact_edge_rows:
        fa = formation_by_contact.get(ce.contact_a_id)
        fb = formation_by_contact.get(ce.contact_b_id)
        if fa is None or fb is None:
            skipped_orphan += 1
            logger.debug(
                f"_run_resolver: skipping orphan contact edge {ce.id} "
                f"(contact_a formation={fa}, contact_b formation={fb})"
            )
            continue
        if fa == fb:
            # Both contacts belong to the same formation — a self-loop at
            # the formation level.  Same-borehole contacts at different depths
            # on the same formation produce this; not a correlation between
            # two distinct bodies.
            skipped_self_loop += 1
            logger.debug(
                f"_run_resolver: skipping self-loop contact edge {ce.id} "
                f"(both contacts map to formation {fa})"
            )
            continue
        edges.append(CorrelationEdge(formation_a_id=fa, formation_b_id=fb))

    if skipped_orphan or skipped_self_loop:
        logger.warning(
            f"_run_resolver: skipped {skipped_orphan} orphan + {skipped_self_loop} "
            f"self-loop contact edge(s) for model {model_id}"
        )

    # Load all formations that participate in this model — every formation
    # that has at least one FormationContact in this model.
    # parent_formation_id IS NOT NULL restricts to litho-level units.
    # This scoping prevents sibling litho models from cross-contaminating
    # ordinal sequences (review B1).
    contacted_fids = select(FormationContactOrm.formation_id).where(
        FormationContactOrm.model_id == model_id
    )
    formations_stmt = select(GeologicalFormationOrm).where(
        GeologicalFormationOrm.app_project_id == model.app_project_id,
        GeologicalFormationOrm.parent_formation_id.is_not(None),
        GeologicalFormationOrm.id.in_(contacted_fids),
    )
    formations_rows = list((await session.execute(formations_stmt)).scalars().all())

    # Earliest depth per formation — ONE GROUP BY, not N+1 per-formation
    # SELECTs (review S2).
    depth_rows = (
        await session.execute(
            select(
                FormationContactOrm.formation_id,
                func.min(FormationContactOrm.depth_top_m),
            )
            .where(FormationContactOrm.model_id == model_id)
            .group_by(FormationContactOrm.formation_id)
        )
    ).all()
    earliest: dict[UUID, float | None] = {fid: d for fid, d in depth_rows}

    nodes: list[FormationNode] = [
        FormationNode(
            formation_id=f.id,
            parent_formation_id=f.parent_formation_id,
            litho_main_soil_code=f.litho_main_soil_code,
            earliest_contact_depth_m=earliest.get(f.id),
            instance_ordinal=f.instance_ordinal,
            instance_ordinal_locked=f.instance_ordinal_locked,
        )
        for f in formations_rows
    ]

    logger.debug(f"_run_resolver: {len(nodes)} formation node(s), {len(edges)} derived edge(s)")

    result = resolve_litho_instances(formations=nodes, edges=edges)

    if result.lock_conflicts:
        for conflict in result.lock_conflicts:
            logger.warning(
                f"_run_resolver: lock conflict — "
                f"winner={conflict.winner_formation_id} "
                f"loser={conflict.loser_formation_id} "
                f"ordinal={conflict.contested_ordinal}"
            )

    # Write back ordinals to non-locked formations that changed.
    updated: list[dict] = []
    orm_by_id: dict[UUID, GeologicalFormationOrm] = {f.id: f for f in formations_rows}
    loser_ids = {c.loser_formation_id for c in result.lock_conflicts}
    for fid, new_ordinal in result.ordinals.items():
        f_orm = orm_by_id.get(fid)
        if f_orm is None:
            continue
        # Never write back to locked formations (unless they are a conflict
        # loser, in which case the resolver has already overridden them).
        if f_orm.instance_ordinal_locked and fid not in loser_ids:
            continue
        if f_orm.instance_ordinal != new_ordinal:
            # Capture BEFORE the mutation so the debug log shows the delta.
            old_ordinal = f_orm.instance_ordinal
            f_orm.instance_ordinal = new_ordinal
            updated.append({"formation_id": str(fid), "new_ordinal": new_ordinal})
            logger.debug(f"_run_resolver: formation {fid} ordinal {old_ordinal} → {new_ordinal}")

    if updated:
        await session.flush()
        # Ordinal/label changed → the inspector grouping changed, so the
        # section view's stale-surface cue must fire even though no
        # geometry moved.  Done here so every caller (correlate, uncorrelate,
        # explicit-resolve) gets the stale cue (review S1).
        pairs = [(model_id, UUID(e["formation_id"])) for e in updated]
        await repo.mark_surfaces_stale(pairs)
        logger.info(
            f"_run_resolver: wrote back {len(updated)} ordinal change(s) "
            f"+ marked surfaces stale for model {model_id}"
        )
    else:
        logger.debug(f"_run_resolver: no ordinal changes for model {model_id}")

    return updated


class _RunResolverLogger(GroundModelLogger):
    """Internal logger for the module-level ``_run_resolver`` helper."""

    def __init__(self) -> None:
        """Initialise with this module's name."""
        super().__init__(__name__)


class ResolveLithoInstances(GroundModelLogger):
    """Re-run the litho-instance resolver for one model and commit the result.

    Loads user-approved contact edges, derives formation-level correlation
    topology, runs the pure domain resolver, writes ``instance_ordinal``
    back to non-locked rows, and marks changed surfaces stale.

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
