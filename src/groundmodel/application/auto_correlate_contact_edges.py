"""Auto-correlate contact-edges use case — #133 Phase 2+3.

Loads contacts + investigation locations + lithology context, calls the
pure-domain ``auto_correlate_contact_edges`` algorithm, and persists
net-new edges with ``user_approved=False``.  Does NOT call the resolver
or lens detection — auto edges are not approved, so they don't yet
participate in the user's correlation graph.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.domain.services.auto_correlate_contact_edges import (
    AutoCorrelateContactParams,
    ContactRecord,
    InvestigationLocation,
    auto_correlate_contact_edges,
)
from groundmodel.domain.services.auto_correlate_contact_edges_constants import (
    AUTO_SOURCE,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
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
class AutoCorrelateContactResult:
    """Outcome counts for the auto-correlate batch.

    Attributes
    ----------
    edges_created : int
        Net-new rows inserted (ON CONFLICT DO NOTHING — did not already exist).
    edges_skipped_existing : int
        Candidates that were skipped because an edge already existed for that
        ``(model_id, contact_a_id, contact_b_id)`` triple.
    """

    edges_created: int
    edges_skipped_existing: int


class AutoCorrelateContactEdges(GroundModelLogger):
    """Run contact-level auto-correlate for a litho model.

    Idempotent: existing edges (any source, any approval state) are skipped
    via ``ON CONFLICT DO NOTHING``.  Auto edges insert with
    ``user_approved=False`` — the lens detector + resolver do NOT fire
    here; the Accept flow is the trigger.

    Parameters
    ----------
    session : AsyncSession
        An active SQLAlchemy async session.  The use case owns the commit
        boundary (single commit at the end).
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
        params: AutoCorrelateContactParams | None = None,
    ) -> AutoCorrelateContactResult:
        """Run the use case.

        Parameters
        ----------
        project_id : UUID
            Project scope guard.  The model must belong to this project;
            investigation locations are filtered to this project.
        model_id : UUID
            The lithostratigraphic model whose contacts are auto-correlated.
        params : AutoCorrelateContactParams | None
            Algorithm tunables.  ``None`` uses the defaults from the
            constants module (``MAX_COLUMN_DISTANCE_M``,
            ``BASE_DEPTH_THRESHOLD_M``, ``DISTANCE_FACTOR``).

        Returns
        -------
        AutoCorrelateContactResult
            ``edges_created`` (net-new rows) + ``edges_skipped_existing``
            (candidates already present in the DB).

        Raises
        ------
        ValueError
            When the model does not belong to ``project_id``.
        """
        self.info(f"AutoCorrelateContactEdges.execute: model={model_id} project={project_id}")

        # 1. Scope guard.
        await load_scoped_or_raise(
            self._session, GeologicalModelOrm, model_id, project_id, label="Geological model"
        )

        # 2. Load all contacts with their formation's litho info.
        contacts_stmt = (
            select(
                FormationContactOrm.id,
                FormationContactOrm.formation_id,
                FormationContactOrm.cpt_id,
                FormationContactOrm.borehole_id,
                FormationContactOrm.depth_top_m,
                GeologicalFormationOrm.parent_formation_id,
                GeologicalFormationOrm.litho_main_soil_code,
            )
            .join(
                GeologicalFormationOrm,
                GeologicalFormationOrm.id == FormationContactOrm.formation_id,
            )
            .where(FormationContactOrm.model_id == model_id)
        )
        rows = (await self._session.execute(contacts_stmt)).all()
        self.debug(f"AutoCorrelateContactEdges: loaded {len(rows)} contact row(s)")

        # 3. Build contact stacks per investigation and derive litho_below_code.
        #    Each stack entry: (depth_top_m, contact_id, formation_id,
        #    parent_formation_id, litho_main_soil_code).
        stacks: dict[UUID, list[tuple[float, UUID, UUID, UUID | None, str]]] = {}
        for row in rows:
            inv_id = row.borehole_id if row.borehole_id is not None else row.cpt_id
            if inv_id is None:
                continue
            stacks.setdefault(inv_id, []).append(
                (
                    row.depth_top_m,
                    row.id,
                    row.formation_id,
                    row.parent_formation_id,
                    row.litho_main_soil_code or "",
                )
            )
        for s in stacks.values():
            s.sort()  # ascending depth

        contact_records: list[ContactRecord] = []
        for inv_id, entries in stacks.items():
            for i, (depth, cid, fid, parent, litho_above) in enumerate(entries):
                # litho_below_code is the main soil code of the unit directly
                # below this contact in the same investigation column.  None
                # for the deepest contact — depths are already sorted ascending
                # so i+1 is the next-deeper entry.
                litho_below = entries[i + 1][4] if i + 1 < len(entries) else None
                contact_records.append(
                    ContactRecord(
                        contact_id=cid,
                        formation_id=fid,
                        investigation_id=inv_id,
                        depth_top_m=depth,
                        parent_formation_id=parent,
                        litho_main_soil_code=litho_above,
                        litho_below_code=litho_below,
                    )
                )

        self.debug(
            f"AutoCorrelateContactEdges: built {len(contact_records)} ContactRecord(s) "
            f"across {len(stacks)} investigation(s)"
        )

        # 4. Load investigation locations — project-scoped so we pick up both
        #    CPTs and boreholes anchored to this project regardless of which
        #    models they appear in.
        cpt_locs = (
            await self._session.execute(
                select(CptOrm.id, CptOrm.location_x, CptOrm.location_y).where(
                    CptOrm.app_project_id == project_id,
                )
            )
        ).all()
        bh_locs = (
            await self._session.execute(
                select(BoreholeOrm.id, BoreholeOrm.location_x, BoreholeOrm.location_y).where(
                    BoreholeOrm.app_project_id == project_id,
                )
            )
        ).all()
        locations = [
            InvestigationLocation(investigation_id=r.id, x=r.location_x, y=r.location_y)
            for r in (*cpt_locs, *bh_locs)
        ]
        self.debug(
            f"AutoCorrelateContactEdges: {len(cpt_locs)} CPT + "
            f"{len(bh_locs)} borehole location(s) loaded"
        )

        # 5. Run the pure-domain algorithm.
        candidates = auto_correlate_contact_edges(contact_records, locations, params)
        self.debug(f"AutoCorrelateContactEdges: {len(candidates)} candidate pair(s)")

        # 6. Bulk-insert with ON CONFLICT DO NOTHING (Postgres-specific).
        #    Uses the named unique constraint so the conflict target is
        #    unambiguous even if the table grows more indexes in future.
        if not candidates:
            await self._session.commit()
            self.success("AutoCorrelateContactEdges: no candidates — nothing to insert")
            return AutoCorrelateContactResult(edges_created=0, edges_skipped_existing=0)

        values = [
            {
                "id": uuid7(),
                "model_id": model_id,
                "contact_a_id": c.contact_a_id,
                "contact_b_id": c.contact_b_id,
                "source": AUTO_SOURCE,
                "user_approved": False,
            }
            for c in candidates
        ]
        stmt = (
            insert(LithoContactCorrelationEdgeOrm)
            .values(values)
            .on_conflict_do_nothing(constraint="uq_litho_contact_corr_triple")
        )
        result = await self._session.execute(stmt)
        edges_created = result.rowcount or 0
        edges_skipped = len(values) - edges_created

        await self._session.commit()
        self.success(
            f"AutoCorrelateContactEdges: created={edges_created} skipped_existing={edges_skipped}"
        )
        return AutoCorrelateContactResult(
            edges_created=edges_created,
            edges_skipped_existing=edges_skipped,
        )
