"""Delete-litho-layer use case (A4 slice 4 — native /layers DELETE path).

Drops one ``litho_layer`` row and reconciles the downstream state that
the deletion touches:

* For accepted layers, the LL→FC trigger removes the matching
  ``formation_contact`` mirror automatically.
* Correlation edges referencing the deleted layer cascade away via the
  ``litho_contact_correlation_edge.contact_*_id → litho_layer(id)``
  ON DELETE CASCADE FK installed in migration ``q1k2l3m4n5o6``.

After those cascades fire the use case re-runs ``ResolveLithoInstances``
so ``instance_ordinal`` values stay coherent with the new edge graph,
marks the corresponding (model, formation) surface stale (accepted-only
— pending layers don't contribute to the TIN), and unseeds the layer id
from every cross-section's ``seeded_formation_contact_ids`` so the
explicit-content invariant doesn't bloat across delete cycles. All
mutations land in one commit.

Lens detection is NOT fired here (owner directive 2026-05-31): stale
``LithoLensOrm`` rows survive a layer delete until the user clicks the
explicit "Detect lenses" verb (``POST .../lenses/detect``). The
renderer must tolerate dangling lens rows.

Pre-A4 the frontend deleted litho rows by calling
``DELETE /contacts/{id}`` and relying on the FC→LL trigger to prune the
matching layer. A4 slice 3 migrated the FE writers to ``/layers``, but
the DELETE endpoint was missed — the FE issued ``DELETE /layers/{id}``
and got 405 (dogfeed 2026-05-31). This use case lands the missing
server side.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.resolve_litho_instances_use_case import (
    ResolveLithoInstances,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.repositories.cross_section_repository import (
    CrossSectionRepository,
)
from groundmodel.infrastructure.db.repositories.geology_repository import (
    GeologyRepository,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (
    LithoLayerRepository,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class DeleteLithoLayer(GroundModelLogger):
    """Hard-delete one ``litho_layer`` row and reconcile downstream state.

    Mirrors ``DeleteFormationContact``'s shape so the litho writer path
    behaves identically to the legacy contact path that A4 retired.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session
        self._repo = LithoLayerRepository(session)
        self._geology = GeologyRepository(session)
        self._cross_sections = CrossSectionRepository(session)

    async def execute(
        self,
        layer_id: UUID,
        *,
        project_id: UUID,
        model_id: UUID,
    ) -> bool:
        """Delete ``layer_id`` and reconcile.

        Parameters
        ----------
        layer_id : UUID
            Primary key of the ``LithoLayer`` row to remove.
        project_id : UUID
            Project scope — used by the seeded-id sweep.
        model_id : UUID
            Lithostratigraphic model that owns the layer — used to scope
            the resolver to the right model.

        Returns
        -------
        bool
            ``True`` when a row was removed, ``False`` when the row was
            already gone (idempotent). The router treats both outcomes
            as 204.
        """
        self.info(f"Deleting litho layer: {layer_id} (model={model_id})")
        # Capture (model, formation, status) BEFORE the delete — the row
        # is gone after, and the stale-mark + post-cascade reconciliation
        # need the pre-state.
        pre = await self._session.get(LithoLayerOrm, layer_id)
        ok = await self._repo.delete_layer(layer_id)
        if ok and pre is not None:
            # Accepted layer → an FC mirror existed and the trigger just
            # removed it → the formation's surface is stale. Pending /
            # rejected layers never had an FC counterpart, so the TIN
            # was not built from them and nothing is stale.
            if pre.status == "accepted":
                await self._geology.mark_surfaces_stale([(pre.model_id, pre.formation_id)])

            self.debug(f"litho layer deleted — running resolver for model={model_id}")
            # Correlation edges referencing this layer just cascaded away
            # via the FK. Re-run the resolver so instance_ordinal values
            # stay coherent.  Lens detection is NOT fired here (owner
            # directive 2026-05-31).
            await ResolveLithoInstances(self._session).execute(
                model_id=model_id,
                commit=False,
            )

            # Unseed the deleted id from every section — same hygiene as
            # the FC-delete path. Flush-only; the commit below covers it.
            await self._cross_sections.remove_seeded_contact_ids(project_id, {layer_id})

        await self._session.commit()
        if ok:
            self.success(f"Litho layer deleted: {layer_id}")
        else:
            self.warning(f"Litho layer already absent: {layer_id}")
        return ok
