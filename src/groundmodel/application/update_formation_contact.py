"""Update-formation-contact use case.

The router has already established scope (the contact's
``model_id`` matches the URL and the model belongs to the project)
before this use case is called. The use case applies the patch,
commits, and returns the refreshed row.

The anchor (``borehole_id`` / ``cpt_id``) IS updatable — the
section editor's drag-re-anchor flow PATCHes both anchor fields
together (one with the new value, the other set to null) and the
schema's XOR validator enforces invariant safety. The repository's
``update_contact`` already setattrs whatever keys the patch dict
carries, so anchor changes flow through without a use-case change.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.recompute_formation_surface import (
    RecomputeFormationSurface,
)
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.repositories.geology_repository import (
    GeologyRepository,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class UpdateFormationContact(GroundModelLogger):
    """Apply a partial update to one formation contact and commit."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session
        self._repo = GeologyRepository(session)

    async def execute(
        self,
        contact_id: UUID,
        patch: dict[str, Any],
    ) -> FormationContactOrm | None:
        """Apply ``patch`` to ``contact_id``.

        Parameters
        ----------
        contact_id : UUID
            Row to update.
        patch : dict[str, Any]
            ``exclude_unset`` dump from the Pydantic request — only
            keys present here are written.

        Returns
        -------
        FormationContactOrm | None
            The refreshed row, or ``None`` when the row vanished
            between the router's scope check and this call (TOCTOU
            race). The router maps ``None`` to a 404.
        """
        self.info(f"Updating formation contact: {contact_id} ({len(patch)} field(s))")
        # Capture the pre-update (model, formation) so the recompute
        # below can refresh the OLD formation's surface when the
        # patch flips formation_id. The drag-re-anchor flow can also
        # cross formations indirectly (a contact moves to a borehole
        # whose neighbour-set differs); but those patches keep the
        # same formation_id, so one recompute on that formation
        # suffices.
        pre = await self._session.get(FormationContactOrm, contact_id)
        if pre is None:
            self.warning(f"Formation contact vanished pre-update: {contact_id}")
            return None
        old_model_id = pre.model_id
        old_formation_id = pre.formation_id
        updated = await self._repo.update_contact(contact_id, patch)
        if updated is None:
            self.warning(f"Formation contact vanished mid-update: {contact_id}")
            return None
        # Always recompute the post-update formation (depth / anchor /
        # source changes all affect the surface). Additionally
        # recompute the pre-update formation when the patch flipped
        # formation_id — that surface lost a contact.
        recompute = RecomputeFormationSurface(self._session)
        await recompute.execute(model_id=updated.model_id, formation_id=updated.formation_id)
        if old_model_id == updated.model_id and old_formation_id != updated.formation_id:
            await recompute.execute(model_id=old_model_id, formation_id=old_formation_id)
        await self._session.commit()
        await self._session.refresh(updated)
        self.success(f"Formation contact updated: {contact_id}")
        return updated
