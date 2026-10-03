"""Propagate-litho-admixtures use case.

Writes ``litho_admixtures`` to every formation in the BFS-reachable connected
component of a seed formation, using the correlation-edge graph for the model.

Scope
-----
Only ``litho_admixtures`` is modified.  ``litho_main_soil_code``,
``instance_ordinal``, and all other columns are left untouched — no resolver
re-run is needed because no layer changes its litho unit, so bodies and ordinals
are unchanged.

If the seed formation has no edges its component is the singleton ``{seed}``,
so the update is applied to the seed alone (valid — single-unit bulk edit).
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.domain.services.resolve_litho_instances import (
    CorrelationEdge,
    connected_formation_ids,
)
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass
class PropagateAdmixturesResult:
    """Output of ``PropagateLithoAdmixtures.execute``.

    Attributes
    ----------
    updated_formations : list[GeologicalFormationOrm]
        The formation ORM rows that were updated (refreshed from the DB after
        commit so callers can serialise them directly).
    component_size : int
        Total number of formations in the connected component (≥ 1).
    """

    updated_formations: list[GeologicalFormationOrm]
    component_size: int


class PropagateLithoAdmixtures(GroundModelLogger):
    """Write ``litho_admixtures`` to every formation in a correlated body.

    Loads the model's correlation edges, BFS-expands from the seed formation
    to find the connected component, then bulk-writes the supplied admixture
    list to every formation in that component in one transaction.

    Guards
    ------
    * Seed formation must exist and belong to ``project_id``.
    * Model must exist, belong to ``project_id``, and be a lithostratigraphic
      model (``kind == 'lithostratigraphic'``).
    * Seed formation must have a non-null ``litho_main_soil_code`` (i.e. be a
      litho unit, not a geological-model formation).
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        project_id: UUID,
        model_id: UUID,
        seed_formation_id: UUID,
        admixtures: list[dict],
    ) -> PropagateAdmixturesResult:
        """Update admixtures for every formation in the seed's connected component.

        Parameters
        ----------
        project_id : UUID
            Owning project — used for scope guards.
        model_id : UUID
            The lithostratigraphic model whose edge graph is traversed.
        seed_formation_id : UUID
            Any formation in the target correlated body; BFS expands from it.
        admixtures : list[dict]
            List of ``{"soil_code": str, "amount": str, "locally": bool}``
            dicts to write.  An empty list clears all admixtures on the body.

        Returns
        -------
        PropagateAdmixturesResult
            Updated ORM rows (post-commit refresh) + component size.

        Raises
        ------
        ValueError
            When the model or seed formation does not exist or does not
            belong to ``project_id``, when the model kind is not
            ``'lithostratigraphic'``, or when the seed has no
            ``litho_main_soil_code`` (geological-model row passed in error).
        """
        self.info(
            f"PropagateLithoAdmixtures: project={project_id} "
            f"model={model_id} seed={seed_formation_id} "
            f"n_admixtures={len(admixtures)}"
        )

        # ------------------------------------------------------------------ #
        # 1. Guard: model exists + belongs to project + is litho kind.         #
        # ------------------------------------------------------------------ #
        model = await load_scoped_or_raise(
            self._session, GeologicalModelOrm, model_id, project_id, label="Model"
        )
        if model.kind != "lithostratigraphic":
            raise ValueError(
                f"Model {model_id} is kind '{model.kind}'; "
                "propagate admixtures requires a lithostratigraphic model"
            )

        # ------------------------------------------------------------------ #
        # 2. Guard: seed formation exists + belongs to project.                #
        # ------------------------------------------------------------------ #
        seed = await load_scoped_or_raise(
            self._session, GeologicalFormationOrm, seed_formation_id, project_id, label="Formation"
        )
        if seed.litho_main_soil_code is None:
            raise ValueError(
                f"Formation {seed_formation_id} has no litho_main_soil_code; "
                "only lithostratigraphic units can be the propagation seed"
            )

        # ------------------------------------------------------------------ #
        # 3. Derive formation-level edges from user-approved contact edges.    #
        # Formation-level LithoCorrelationEdgeOrm rows are no longer the      #
        # authority for the propagation graph since #133 Phase 3: contact     #
        # edges are the boundary-to-boundary ground truth.                     #
        # ------------------------------------------------------------------ #
        contact_edges_stmt = select(LithoContactCorrelationEdgeOrm).where(
            LithoContactCorrelationEdgeOrm.model_id == model_id,
            LithoContactCorrelationEdgeOrm.user_approved.is_(True),
        )
        contact_edge_rows = list((await self._session.execute(contact_edges_stmt)).scalars().all())
        self.debug(
            f"PropagateLithoAdmixtures: {len(contact_edge_rows)} user-approved "
            f"contact edge(s) for model {model_id}"
        )

        # Build contact_id → formation_id map (one query covers all contacts).
        contacts_stmt = select(FormationContactOrm.id, FormationContactOrm.formation_id).where(
            FormationContactOrm.model_id == model_id
        )
        formation_by_contact: dict[UUID, UUID] = dict(
            (await self._session.execute(contacts_stmt)).all()
        )

        # Derive formation-to-formation CorrelationEdge objects, skipping
        # self-loops (both contacts in same formation) and orphans (contact
        # deleted after edge was created — DB CASCADE handles it, but guarded
        # here for in-flight state).
        edges: list[CorrelationEdge] = []
        skipped_orphan = 0
        skipped_self_loop = 0
        for ce in contact_edge_rows:
            fa = formation_by_contact.get(ce.layer_a_id)
            fb = formation_by_contact.get(ce.layer_b_id)
            if fa is None or fb is None:
                skipped_orphan += 1
                self.debug(
                    f"PropagateLithoAdmixtures: skipping orphan contact edge {ce.id} "
                    f"(contact_a formation={fa}, contact_b formation={fb})"
                )
                continue
            if fa == fb:
                skipped_self_loop += 1
                self.debug(
                    f"PropagateLithoAdmixtures: skipping self-loop contact edge {ce.id} "
                    f"(both contacts map to formation {fa})"
                )
                continue
            edges.append(CorrelationEdge(formation_a_id=fa, formation_b_id=fb))

        if skipped_orphan or skipped_self_loop:
            self.warning(
                f"PropagateLithoAdmixtures: skipped {skipped_orphan} orphan + "
                f"{skipped_self_loop} self-loop contact edge(s) for model {model_id}"
            )
        self.debug(
            f"PropagateLithoAdmixtures: {len(edges)} derived formation edge(s) for model {model_id}"
        )

        # ------------------------------------------------------------------ #
        # 4. BFS: find all formation ids in the connected component.           #
        # ------------------------------------------------------------------ #
        component_ids = connected_formation_ids(seed_formation_id, edges)
        self.info(
            f"PropagateLithoAdmixtures: seed={seed_formation_id} "
            f"component_size={len(component_ids)} ids={component_ids}"
        )

        # ------------------------------------------------------------------ #
        # 5. Load all formation ORM rows in the component.                    #
        # ------------------------------------------------------------------ #
        formations_stmt = select(GeologicalFormationOrm).where(
            GeologicalFormationOrm.id.in_(component_ids),
            GeologicalFormationOrm.app_project_id == project_id,
        )
        formation_rows = list((await self._session.execute(formations_stmt)).scalars().all())

        if not formation_rows:
            # Defensive: the seed passed guard #2, so at minimum it exists.
            # If the IN query returns nothing, something very unexpected happened.
            self.warning(
                f"PropagateLithoAdmixtures: no formation rows found for component "
                f"{component_ids} — this should not happen; aborting without write"
            )
            return PropagateAdmixturesResult(
                updated_formations=[], component_size=len(component_ids)
            )

        # ------------------------------------------------------------------ #
        # 6. Bulk-write admixtures on every formation in the component.        #
        # Defensive copy of admixtures ensures each row gets its own list     #
        # object so JSONB mutation of one row doesn't alias the others.       #
        # ------------------------------------------------------------------ #
        admixtures_copy = list(admixtures)  # shallow copy of the list
        for i, f_orm in enumerate(formation_rows):
            # Per-item copy so JSONB tracking in SQLAlchemy sees distinct objects.
            f_orm.litho_admixtures = [dict(a) for a in admixtures_copy]
            self.debug(
                f"PropagateLithoAdmixtures: [{i + 1}/{len(formation_rows)}] "
                f"formation {f_orm.id} admixtures → {admixtures_copy}"
            )

        await self._session.flush()

        # ------------------------------------------------------------------ #
        # 7. Commit + refresh.                                                 #
        # ------------------------------------------------------------------ #
        await self._session.commit()
        for f_orm in formation_rows:
            await self._session.refresh(f_orm)

        self.success(
            f"PropagateLithoAdmixtures: committed admixtures on "
            f"{len(formation_rows)} formation(s) in component of seed {seed_formation_id}"
        )
        return PropagateAdmixturesResult(
            updated_formations=formation_rows,
            component_size=len(component_ids),
        )
