"""Use case — delete a litho lens and its owned synthetic contacts.

Deletion order (single transaction):
1. SELECT the synthetic-only contacts that belong to this lens
   (``borehole_id IS NULL AND cpt_id IS NULL AND lens_id = ?``).
   The FK on ``formation_contact.lens_id`` is ON DELETE SET NULL, so
   deleting the lens first would null out the pointer BEFORE we can
   collect the ids — collect FIRST, then delete the lens, then delete
   the collected synthetic contacts.
2. DELETE the ``litho_lens`` row (CASCADE evaporates
   ``litho_lens_absence`` rows automatically).
3. DELETE the synthetic contacts collected in step 1.
   Anchored contacts (borehole_id or cpt_id set) keep their geometry;
   only their ``lens_id`` column was cleared by the FK SET NULL in
   step 2.
4. Commit.

The sections whose ``seeded_formation_contact_ids`` referenced the now-
deleted synthetic contacts are NOT updated here — stale ids in the
seeded set are silently ignored by the section renderer (the filter by
id-membership skips absent contacts), so no cleanup is needed.  This
matches the existing pattern for manually-deleted contacts.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.litho_lens_orm import LithoLensOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class DeleteLithoLens(GroundModelLogger):
    """Delete a litho lens and its owned synthetic contacts.

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
        """Delete the lens and its synthetic contacts.

        Parameters
        ----------
        project_id : UUID
            Project scope guard.
        model_id : UUID
            Model scope guard.
        lens_id : UUID
            The lens to delete.

        Returns
        -------
        bool
            ``True`` when the lens was found and deleted, ``False`` when
            the lens does not exist or is out of project/model scope.
        """
        self.info(f"DeleteLithoLens.execute: project={project_id} model={model_id} lens={lens_id}")

        # ------------------------------------------------------------------
        # 1. Load the lens with scope guards.
        # ------------------------------------------------------------------
        lens = await self._session.get(LithoLensOrm, lens_id)
        if lens is None:
            self.warning(f"LithoLens {lens_id} not found — no-op")
            return False
        if lens.app_project_id != project_id or lens.model_id != model_id:
            self.warning(
                f"LithoLens {lens_id} scope mismatch "
                f"(project={lens.app_project_id}, model={lens.model_id}) — no-op"
            )
            return False

        # ------------------------------------------------------------------
        # 2. Collect synthetic contacts BEFORE deleting the lens.
        #    The FK is SET NULL on delete, so we must grab the ids now.
        # ------------------------------------------------------------------
        synthetic_ids_result = (
            (
                await self._session.execute(
                    select(FormationContactOrm.id).where(
                        FormationContactOrm.lens_id == lens_id,
                        FormationContactOrm.borehole_id.is_(None),
                        FormationContactOrm.cpt_id.is_(None),
                        FormationContactOrm.synthetic_x.is_not(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        synthetic_ids = list(synthetic_ids_result)
        self.debug(f"Found {len(synthetic_ids)} synthetic contact(s) owned by lens {lens_id}")

        # ------------------------------------------------------------------
        # 3. Delete the lens row (CASCADE removes litho_lens_absence rows).
        # ------------------------------------------------------------------
        await self._session.delete(lens)
        await self._session.flush()
        self.debug(f"LithoLens {lens_id} deleted (absence rows CASCADE-removed)")

        # ------------------------------------------------------------------
        # 4. Delete the collected synthetic contacts.
        # ------------------------------------------------------------------
        if synthetic_ids:
            await self._session.execute(
                delete(FormationContactOrm).where(FormationContactOrm.id.in_(synthetic_ids))
            )
            await self._session.flush()
            self.debug(f"Deleted {len(synthetic_ids)} synthetic contact(s): {synthetic_ids}")

        # ------------------------------------------------------------------
        # 5. Commit.
        # ------------------------------------------------------------------
        await self._session.commit()
        self.success(
            f"DeleteLithoLens done: lens={lens_id} synthetic_contacts_removed={len(synthetic_ids)}"
        )
        return True
