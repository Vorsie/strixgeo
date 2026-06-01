"""Unlink a lithostratigraphic contact from its coupled geological contact.

Sets ``parent_geo_contact_id = None`` on the litho contact.  The geological
contact is not moved or deleted — this is purely a relationship removal.
The only safety valve needed for a wrong auto-link: the user can break it
and the two contacts continue to exist independently.

PROJECT-SCOPE GUARD
-------------------
The contact's model must belong to ``project_id``.  The guard mirrors
``AcceptLithoSuggestions`` — loaded via the contact's ``model.app_project_id``
relationship.  A missing contact or a project mismatch raises ``ValueError``
and aborts before any mutation.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.domain.value_objects.formation_contact_result import FormationContactResult
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class UnlinkLithoFromGeo(GroundModelLogger):
    """Use case: break the litho↔geo coupling on a single contact (#162 Task 6).

    Nulls ``parent_geo_contact_id`` on the given lithostratigraphic contact.
    Does not touch the geological contact.  Does not rebuild surfaces
    (the contact geometry hasn't changed, only the coupling label).

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session
        self._repo = GeologyRepository(session)

    async def execute(
        self,
        *,
        project_id: UUID,
        contact_id: UUID,
    ) -> FormationContactResult | None:
        """Remove the geo coupling from a litho contact.

        Parameters
        ----------
        project_id : UUID
            Project scope guard — the contact's model must belong to this
            project.  Raises ``ValueError`` when the guard fails.
        contact_id : UUID
            The lithostratigraphic contact to unlink.

        Returns
        -------
        FormationContactResult | None
            Immutable snapshot of the updated contact row
            (``parent_geo_contact_id`` is now ``None``), or ``None`` when
            the contact does not exist.

        Raises
        ------
        ValueError
            When the contact is not found or its model does not belong to
            ``project_id``.
        """
        self.info(f"UnlinkLithoFromGeo.execute: contact_id={contact_id} project={project_id}")

        # Two-step scope guard (mirrors AcceptLithoSuggestions pattern):
        # 1. Load the contact by primary key.
        # 2. Load its model and check app_project_id.
        # Two separate session.get calls avoid selectinload (which would
        # require the ORM relationship to be eagerly loaded and complicates
        # unit-test mocking).
        contact = await self._session.get(FormationContactOrm, contact_id)
        if contact is None:
            raise ValueError(f"Contact {contact_id} not found in project {project_id}")

        model = await self._session.get(GeologicalModelOrm, contact.model_id)
        if model is None or model.app_project_id != project_id:
            raise ValueError(f"Contact {contact_id} not found in project {project_id}")

        # Null the coupling — no other mutation.
        contact.parent_geo_contact_id = None

        await self._session.commit()
        # Refresh after commit so scalar columns (updated_at, etc.) are
        # populated before the snapshot is taken — same pattern as
        # CreateFormationContact.
        await self._session.refresh(contact)
        self.success(f"UnlinkLithoFromGeo: contact {contact_id} unlinked from geo coupling")
        return FormationContactResult.from_orm(contact)
