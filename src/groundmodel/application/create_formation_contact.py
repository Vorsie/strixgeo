"""Create-formation-contact use case.

Wraps the repository insert with the project-standard use-case
shape: owns its session commit, logs at the application boundary,
and is the hook future editor-side orchestration (e.g. "run the
no-gaps validator after every save and return the issues alongside
the inserted row") will extend without churning callers.

The XOR check on the anchor (borehole_id / cpt_id) lives at three
boundaries by design:

1. Pydantic ``FormationContactCreateRequest`` rejects bad bodies
   at the HTTP boundary with a clean 422.
2. The repository raises ``ValueError`` as a defence-in-depth for
   any non-API caller (bundle restore, future CLI tools, tests).
3. A DB ``CheckConstraint`` is the final safety net.

The use case does NOT re-check — it trusts the layer above and
passes the call through.
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


class CreateFormationContact(GroundModelLogger):
    """Insert one formation contact and commit the transaction."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session
        self._repo = GeologyRepository(session)

    async def execute(
        self,
        *,
        model_id: UUID,
        formation_id: UUID,
        depth_top_m: float,
        borehole_id: UUID | None = None,
        cpt_id: UUID | None = None,
        source: str = "manual_pick",
        confidence: str = "medium",
        observation_id: UUID | None = None,
        observation_layer_id: UUID | None = None,
        notes: str | None = None,
    ) -> FormationContactOrm:
        """Insert a contact under ``model_id`` and commit.

        Parameters
        ----------
        model_id : UUID
            Model the contact belongs to.
        formation_id : UUID
            Formation whose top this pick marks.
        depth_top_m : float
            Depth (m) of the formation top at the anchor column.
        borehole_id, cpt_id : UUID | None
            Anchor investigation. Exactly one must be set — the
            repository raises ``ValueError`` otherwise.
        source, confidence : str
            Provenance + engineer-certainty tags.
        observation_id, observation_layer_id : UUID | None
            Optional backlinks when the pick was derived from a
            DOV observation row.
        notes : str | None
            Free-text engineer note specific to this pick.

        Returns
        -------
        FormationContactOrm
            The freshly-inserted row with all DB defaults populated.

        Raises
        ------
        ValueError
            When the anchor XOR rule is violated.
        """
        self.info(f"Creating formation contact: model={model_id}, formation={formation_id}")
        contact = await self._repo.create_contact(
            model_id=model_id,
            formation_id=formation_id,
            depth_top_m=depth_top_m,
            borehole_id=borehole_id,
            cpt_id=cpt_id,
            source=source,
            confidence=confidence,
            observation_id=observation_id,
            observation_layer_id=observation_layer_id,
            notes=notes,
        )
        await self._session.commit()
        await self._session.refresh(contact)
        self.success(f"Formation contact created: {contact.id}")
        return contact
