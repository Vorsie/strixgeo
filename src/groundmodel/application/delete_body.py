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
        lens_id: UUID,
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
        lens_id : UUID
            Primary key of the ``BodyOrm`` row to delete.

        Returns
        -------
        bool
            ``True`` when the row was found and deleted; ``False`` when it
            does not exist or is out of scope.
        """
        self.info(f"DeleteBody.execute: project={project_id} model={model_id} lens={lens_id}")

        body = await self._session.get(BodyOrm, lens_id)
        if body is None:
            self.warning(f"BodyOrm {lens_id} not found — no-op")
            return False
        if body.app_project_id != project_id or body.model_id != model_id:
            self.warning(
                f"BodyOrm {lens_id} scope mismatch "
                f"(project={body.app_project_id} model={body.model_id}) — no-op"
            )
            return False

        formation_id = body.formation_id
        body_ordinal = body.body_ordinal

        await self._session.delete(body)
        await self._session.commit()

        self.success(
            f"DeleteBody done: body={lens_id} "
            f"formation={formation_id} ordinal={body_ordinal} deleted"
        )
        return True
