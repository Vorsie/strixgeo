"""Delete-formation-contact use case.

Routes the editor's "remove this pick" intent through the
application layer. The scope check (contact belongs to the URL
model AND the model belongs to the URL project) lives in the
router; this layer trusts the call and just drops the row.

Contacts are leaves in the geological-model tree, so no
cascade-aware orchestration is needed today. If a future
"undo last pick" feature lands, it extends this use case (e.g.
emit a soft-delete row, or stash the contact's serialised form in
the editor's transient state).
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.repositories.geology_repository import (
    GeologyRepository,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class DeleteFormationContact(GroundModelLogger):
    """Drop one formation-contact row and commit."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session
        self._repo = GeologyRepository(session)

    async def execute(self, contact_id: UUID) -> bool:
        """Delete ``contact_id``.

        Returns
        -------
        bool
            ``True`` when a row was removed, ``False`` when the row
            was already gone (idempotent). The router treats both
            outcomes as 204.
        """
        self.info(f"Deleting formation contact: {contact_id}")
        # Capture the (model, formation) before the delete so we know
        # which surface row to flip stale. No row → no flip needed
        # (the surface either doesn't exist or already has no source).
        pre = await self._session.get(FormationContactOrm, contact_id)
        ok = await self._repo.delete_contact(contact_id)
        if ok and pre is not None:
            # On-click build pivot: mark stale rather than recompute.
            await self._repo.mark_surfaces_stale([(pre.model_id, pre.formation_id)])
        await self._session.commit()
        if ok:
            self.success(f"Formation contact deleted: {contact_id}")
        else:
            self.warning(f"Formation contact already absent: {contact_id}")
        return ok
