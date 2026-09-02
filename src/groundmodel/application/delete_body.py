"""Use case — delete the BodyOrm metadata row for a body.

Position 4 architecture (#101 R3).  Unlike the Approach C ``DeleteLithoLens``,
there are no synthetic contacts or absence rows owned by the metadata row:

* ``formation_absence`` rows are scoped to a formation, not to a body metadata
  row.  They survive metadata deletion (user may have already confirmed some
  absences as ``'manual'``).  This is intentional — the body still exists in
  the correlation graph; only its name disappears.
* Synthetic pinch-out contacts are scoped to the formation as well; they are
  not deleted when metadata is removed.

Deletion is therefore just a single-row DELETE on ``body`` with scope
guards.

Originally named DeleteLensMetadata — Slice 2 rename.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.body_partition_lock import (
    lock_body_partition,
    lock_sibling_geotech_partitions,
)
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class DeleteBody(GroundModelLogger):
    """Delete the BodyOrm metadata row for a body.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
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
        body_id: UUID,
    ) -> bool:
        """Delete the metadata row.

        Absence rows and synthetic contacts scoped to the formation are
        intentionally preserved — they belong to the body, not to the label.

        Parameters
        ----------
        project_id : UUID
            Project scope guard.
        model_id : UUID
            Model scope guard.
        body_id : UUID
            Primary key of the ``BodyOrm`` row to delete.
            Renamed from ``lens_id`` in Slice 3.3 (2026-06-01).

        Returns
        -------
        bool
            ``True`` when the row was found and deleted; ``False`` when it
            does not exist or is out of scope.
        """
        self.info(f"DeleteBody.execute: project={project_id} model={model_id} body={body_id}")

        body = await self._session.get(BodyOrm, body_id)
        if body is None:
            self.warning(f"BodyOrm {body_id} not found — no-op")
            return False
        if body.app_project_id != project_id or body.model_id != model_id:
            self.warning(
                f"BodyOrm {body_id} scope mismatch "
                f"(project={body.app_project_id} model={body.model_id}) — no-op"
            )
            return False

        # The resolver DELETEs orphan body rows under the lock; an unguarded
        # delete here walks an overlapping set in a different order (audit,
        # 2026-08-23). Taken after the 404/scope no-ops so a rejected request
        # never queues behind a live writer.
        await lock_body_partition(self._session, model_id=model_id, operation="delete-body")

        # If this body belongs to a LITHO model, lock its sibling GEOTECH children
        # before the delete below — same ordering rule the resolver follows (BP-3).
        # Deleting a litho body fires the ``ON DELETE SET NULL`` of the geotech rows'
        # ``parent_litho_body_id`` FK — a hidden write on the geotech ``body`` rows —
        # which would race a concurrent geotech ``bodies/recompute`` if the child
        # lock were taken after. A no-op when the body's model is geotech (a geotech
        # model has no geotech children), so the call is unconditional and correct.
        await lock_sibling_geotech_partitions(
            self._session, litho_model_id=model_id, operation="delete-body"
        )

        formation_id = body.formation_id
        body_ordinal = body.body_ordinal

        await self._session.delete(body)
        await self._session.commit()

        self.success(
            f"DeleteBody done: body={body_id} "
            f"formation={formation_id} ordinal={body_ordinal} deleted"
        )
        return True
