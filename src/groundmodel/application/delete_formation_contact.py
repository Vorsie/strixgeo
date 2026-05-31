"""Delete-formation-contact use case.

Routes the editor's "remove this pick" intent through the
application layer. The scope check (contact belongs to the URL
model AND the model belongs to the URL project) lives in the
router; this layer trusts the call and just drops the row.

When the deleted contact belonged to a lithostratigraphic model,
the FK cascade removes any ``LithoContactCorrelationEdge`` rows that
referenced it.  The resolver is re-run inline so instance ordinals
stay coherent with the updated edge graph.  Lens detection is NOT
fired here (owner directive 2026-05-31): stale ``LithoLensOrm`` rows
are reconciled only on the explicit ``POST .../lenses/detect`` verb.
Non-litho models skip the resolver pass (no correlation edges exist
for geological contacts).
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.resolve_litho_instances_use_case import (
    ResolveLithoInstances,
)
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.repositories.cross_section_repository import (
    CrossSectionRepository,
)
from groundmodel.infrastructure.db.repositories.geology_repository import (
    GeologyRepository,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class DeleteFormationContact(GroundModelLogger):
    """Drop one formation-contact row and commit.

    For lithostratigraphic contacts, also re-runs the instance resolver
    and lens detector so that the correlation graph stays consistent
    after the FK cascade removes any edges that referenced the deleted
    contact.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session
        self._repo = GeologyRepository(session)
        self._sections = CrossSectionRepository(session)

    async def execute(
        self,
        contact_id: UUID,
        *,
        project_id: UUID,
        model_id: UUID,
    ) -> bool:
        """Delete ``contact_id`` and reconcile the correlation graph.

        Parameters
        ----------
        contact_id : UUID
            Primary key of the ``FormationContact`` row to remove.
        project_id : UUID
            Project scope.  Used by the seeded-id sweep that prunes the
            deleted contact from every cross-section's
            ``seeded_formation_contact_ids``.
        model_id : UUID
            Geological model that owns the contact — used to determine
            whether to run the litho cascade and to scope the resolver +
            detector to the right model.

        Returns
        -------
        bool
            ``True`` when a row was removed, ``False`` when the row was
            already gone (idempotent). The router treats both outcomes
            as 204.
        """
        self.info(f"Deleting formation contact: {contact_id} (model={model_id})")
        # Capture the (model, formation) before the delete so we know
        # which surface row to flip stale. No row → no flip needed
        # (the surface either doesn't exist or already has no source).
        pre = await self._session.get(FormationContactOrm, contact_id)
        ok = await self._repo.delete_contact(contact_id)
        if ok and pre is not None:
            # On-click build pivot: mark stale rather than recompute.
            await self._repo.mark_surfaces_stale([(pre.model_id, pre.formation_id)])

        # Litho-only cascade: the FK delete above removes any
        # LithoContactCorrelationEdge rows that referenced this contact.
        # Re-run the resolver so instance_ordinal values stay coherent.
        # Lens detection is NOT fired here (owner directive 2026-05-31) —
        # stale LithoLensOrm rows survive until "Detect lenses" runs.
        # Geological contacts have no correlation edges — skip the cascade.
        if ok:
            geo_model = await self._session.get(GeologicalModelOrm, model_id)
            if geo_model is not None and geo_model.kind == "lithostratigraphic":
                self.debug(f"litho contact deleted — running resolver for model={model_id}")
                await ResolveLithoInstances(self._session).execute(
                    model_id=model_id,
                    commit=False,
                )

            # Unseed the deleted contact from every section (explicit-content
            # invariant has no remover otherwise — the id would stay seeded
            # forever, bloating seeded_formation_contact_ids across delete
            # cycles). Flush-only; the commit below covers it atomically.
            await self._sections.remove_seeded_contact_ids(project_id, {contact_id})

        await self._session.commit()
        if ok:
            self.success(f"Formation contact deleted: {contact_id}")
        else:
            self.warning(f"Formation contact already absent: {contact_id}")
        return ok
