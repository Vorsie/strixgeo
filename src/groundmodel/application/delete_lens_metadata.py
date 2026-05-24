"""Use case — delete the LithoLensOrm metadata row for a lens body.

Position 4 architecture (#101 R3).  Unlike the Approach C ``DeleteLithoLens``,
there are no synthetic contacts or absence rows owned by the metadata row:

* ``formation_absence`` rows are scoped to a formation, not to a lens metadata
  row.  They survive metadata deletion (user may have already confirmed some
  absences as ``'manual'``).  This is intentional — the body still exists in
  the correlation graph; only its name disappears.
* Synthetic pinch-out contacts are scoped to the formation as well; they are
  not deleted when metadata is removed.

Deletion is therefore just a single-row DELETE on ``litho_lens`` with scope
guards.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.litho_lens_orm import LithoLensOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class DeleteLensMetadata(GroundModelLogger):
    """Delete the LithoLensOrm metadata row for a lens body.

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
            Primary key of the ``LithoLensOrm`` row to delete.

        Returns
        -------
        bool
            ``True`` when the row was found and deleted; ``False`` when it
            does not exist or is out of scope.
        """
        self.info(
            f"DeleteLensMetadata.execute: project={project_id} model={model_id} lens={lens_id}"
        )

        lens = await self._session.get(LithoLensOrm, lens_id)
        if lens is None:
            self.warning(f"LithoLensOrm {lens_id} not found — no-op")
            return False
        if lens.app_project_id != project_id or lens.model_id != model_id:
            self.warning(
                f"LithoLensOrm {lens_id} scope mismatch "
                f"(project={lens.app_project_id} model={lens.model_id}) — no-op"
            )
            return False

        formation_id = lens.formation_id
        body_ordinal = lens.body_ordinal

        await self._session.delete(lens)
        await self._session.commit()

        self.success(
            f"DeleteLensMetadata done: lens={lens_id} "
            f"formation={formation_id} ordinal={body_ordinal} deleted"
        )
        return True
