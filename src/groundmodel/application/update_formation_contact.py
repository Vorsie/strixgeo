"""Update-formation-contact use case.

The router has already established scope (the contact's
``model_id`` matches the URL and the model belongs to the project)
before this use case is called. The use case applies the patch,
commits, and returns the refreshed row.

The anchor (``borehole_id`` / ``cpt_id``) is intentionally NOT
updatable — repointing a contact at a different investigation is
rare and easy to do wrong; delete + create is the safer flow.
Pydantic ``FormationContactUpdateRequest`` enforces this by simply
not exposing the anchor fields, so the patch dict reaching this
layer never carries them.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

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
        updated = await self._repo.update_contact(contact_id, patch)
        if updated is None:
            self.warning(f"Formation contact vanished mid-update: {contact_id}")
            return None
        await self._session.commit()
        await self._session.refresh(updated)
        self.success(f"Formation contact updated: {contact_id}")
        return updated
