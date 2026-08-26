"""Clear ONE investigation's geotech packing bands — the rebuild escape hatch.

Owner ask 2026-08-18, alongside first-subdivision-wins: *"we'll also need a
per test clear subdivision just for utility, right click tests label and you
can fire it."* With the pipeline presses importing already-banded columns
as-is, the way to REDO one column is: clear it here, then press the step —
only the cleared column rebuilds.

The column's correlation edges die with its rows (endpoint FK cascade) and NO
tombstone is written — this is rebuild preparation, not judgement, and a
tombstone would block the machine from re-proposing the very ties the rebuild
is for. Tombstones are only ever written by the hand-delete verb.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.body_partition_lock import lock_body_partition
from groundmodel.application.orphan_formation_sweep import OrphanFormationSweep
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (
    LithoLayerRepository,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class ClearGeotechColumn(GroundModelLogger):
    """Delete one investigation's geotech bands so a pipeline press rebuilds it.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session. This use case commits once at the end.
    """

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(__name__)
        self._session = session
        self._litho_repo = LithoLayerRepository(session)

    async def execute(
        self,
        *,
        geotech_model_id: UUID,
        investigation_id: UUID,
    ) -> int:
        """Delete *investigation_id*'s bands in *geotech_model_id*.

        Parameters
        ----------
        geotech_model_id : UUID
            The geotechnical model to clear the column in (the route's scope
            guard has already proven it belongs to the project).
        investigation_id : UUID
            The CPT or borehole whose bands go. The anchor is a database XOR,
            so one ``OR`` matches whichever kind this id is.

        Returns
        -------
        int
            The number of band rows deleted (0 when the column carried none —
            an idempotent no-op, not an error).
        """
        self.info(f"ClearGeotechColumn: model={geotech_model_id} investigation={investigation_id}")
        # TAKE THE PARTITION LOCK BEFORE THE FIRST WRITE, not after it.
        # ``ResolveLithoInstances`` below takes this same lock, but by then this
        # transaction has already DELETEd the column's rows — and those deletes
        # race the debounced background ``bodies/recompute``, which UPDATEs
        # ``litho_layer.body_id`` stamps over the same rows in a different order
        # (owner dogfeed 2026-08-23: a band edit 500'd with DeadlockDetectedError
        # on ``DELETE FROM litho_layer`` while a recompute for the same model was
        # in flight). The lock is re-entrant per session, so the resolver's later
        # acquisition stays free.
        await lock_body_partition(
            self._session, model_id=geotech_model_id, operation="clear-geotech-column"
        )
        anchor = or_(
            LithoLayerOrm.cpt_id == investigation_id,
            LithoLayerOrm.borehole_id == investigation_id,
        )
        count = len(
            (
                await self._session.execute(
                    select(LithoLayerOrm.id).where(
                        LithoLayerOrm.model_id == geotech_model_id, anchor
                    )
                )
            )
            .scalars()
            .all()
        )
        await self._session.execute(
            delete(LithoLayerOrm).where(LithoLayerOrm.model_id == geotech_model_id, anchor)
        )
        # The column's bodies may have lived only on these rows — the resolver
        # removes the orphans and re-stamps the survivors; the 3-D cache is
        # stale either way.
        await self._litho_repo.mark_litho_solids_stale(geotech_model_id)
        await ResolveLithoInstances(self._session).execute(model_id=geotech_model_id, commit=False)
        # A unit that lived only on this column is now vocabulary describing
        # nothing — this verb rebuilds no bands to replace them. The project id
        # is not a parameter here (the route scopes by model), so read it off
        # the model; the sweep is project-scoped because a formation is shared
        # project-wide, not owned by one model.
        project_id = (
            await self._session.execute(
                select(GeologicalModelOrm.app_project_id).where(
                    GeologicalModelOrm.id == geotech_model_id
                )
            )
        ).scalar_one()
        await OrphanFormationSweep(self._session).sweep_geotech_units(project_id)
        await self._session.commit()
        self.success(
            f"ClearGeotechColumn ok: investigation={investigation_id} deleted={count} band(s)"
        )
        return count
