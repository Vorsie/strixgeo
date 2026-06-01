"""Use case — bulk-delete the purely-detected bodies of a litho model.

The Sections toolbar's "Delete all detected lenses" action clears every
auto-detected body wedge in one gesture instead of dissolving them one by
one.  The preserve rules mirror the ``DetectBodies`` reconcile sweep exactly
(spec §5.2): a body is deleted only when it is *purely detected* —

* ``name`` is NULL / blank (not user-named), AND
* neither side carries a user-claimed extent kind
  (``pinch_out_halfway`` / ``extrapolated`` / ``open``).

Named or user-claimed ("accepted") bodies survive — the engineer keeps the
interpretation they committed; only the machine-suggested wedges go away.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.shared.constants.extent_kind import is_user_claimed_extent_kind
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class DeleteDetectedBodies(GroundModelLogger):
    """Bulk-delete purely-detected bodies for one litho model.

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
    ) -> tuple[int, int]:
        """Delete every purely-detected body row for the model.

        Preserve guards (mirroring ``DetectBodies`` reconcile, spec §5.2):

        * ``name`` is set (non-blank) → user-named body; preserved.
        * Either side carries a user-claimed extent kind → preserved.

        Parameters
        ----------
        project_id : UUID
            Project scope guard.
        model_id : UUID
            Model scope guard.

        Returns
        -------
        tuple[int, int]
            ``(deleted_count, preserved_count)`` — how many rows were
            hard-deleted and how many were preserved by the guards.

        Notes
        -----
        Commits the transaction (matches the per-body ``DeleteBody``
        contract; this is a standalone user gesture, not a composed step).
        """
        self.info(f"DeleteDetectedBodies.execute: project={project_id} model={model_id}")

        rows = (
            (
                await self._session.execute(
                    select(BodyOrm).where(
                        BodyOrm.app_project_id == project_id,
                        BodyOrm.model_id == model_id,
                    )
                )
            )
            .scalars()
            .all()
        )

        deleted = 0
        preserved = 0
        for body in rows:
            named = body.name is not None and body.name.strip() != ""
            user_claimed = is_user_claimed_extent_kind(
                body.extent_left_kind
            ) or is_user_claimed_extent_kind(body.extent_right_kind)
            if named or user_claimed:
                preserved += 1
                continue
            await self._session.delete(body)
            deleted += 1

        await self._session.commit()
        self.success(
            f"DeleteDetectedBodies done: model={model_id} deleted={deleted} preserved={preserved}"
        )
        return deleted, preserved
