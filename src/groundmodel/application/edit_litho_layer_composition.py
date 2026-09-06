"""Edit-litho-layer-composition use case.

"Make this accepted SILT a ZAND" — repoint one accepted ``litho_layer`` to the
litho unit for a different ``(main soil code, admixtures)`` composition WITHOUT
deleting it (installer #21 PROD BLOCKER, owner 2026-09-06: "I have a silt I want
to make a sand … I can only delete it").

Flow
----
1. Resolve the target litho formation with the SHARED find-or-create helper
   (:func:`resolve_litho_formation`) — reuse the project's existing unit for that
   composition, or mint a new one (auto-named, coloured) when none exists. This
   is the same rule :class:`AcceptLithoSuggestions` keys units by.
2. Repoint the layer through the EXISTING :class:`UpdateLithoLayer` PATCH
   (``formation_id`` only) — depths, anchor and status are untouched, so the
   contiguity + no-overlap guards never fire.
3. Re-run :class:`ResolveLithoInstances`: composition drives body membership
   (a body is a connected component over SAME-litho layers), so a repoint can
   merge or split bodies and the instance ordinals + ``body_id`` stamps must be
   re-derived.

The created formation (when the composition is new) is flushed into the same
session BEFORE the PATCH, so ``UpdateLithoLayer``'s commit persists the new unit
and the repoint together.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.litho_formation_lookup import resolve_litho_formation
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.application.update_litho_layer import UpdateLithoLayer
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class EditLithoLayerComposition(GroundModelLogger):
    """Repoint one accepted litho layer to a different composition's unit."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        project_id: UUID,
        model_id: UUID,
        layer_id: UUID,
        litho_main_soil_code: str,
        admixtures: tuple[Admixture, ...],
    ) -> LithoLayerOrm | None:
        """Repoint ``layer_id`` to the litho unit for the target composition.

        Parameters
        ----------
        project_id : UUID
            Owning project (scope for the formation load + create).
        model_id : UUID
            The lithostratigraphic model the layer belongs to (IDOR scope).
        layer_id : UUID
            The accepted layer to recompose.
        litho_main_soil_code : str
            Target BaseLithology token (ZAND / KLEI / SILT / GRIND / VEEN).
        admixtures : tuple[Admixture, ...]
            Target admixtures.

        Returns
        -------
        LithoLayerOrm | None
            The updated layer, or ``None`` when the layer does not exist or is
            outside ``model_id``.
        """
        self.info(
            f"EditLithoLayerComposition: layer={layer_id} model={model_id} "
            f"→ {litho_main_soil_code} admix={[a.canonical_key() for a in admixtures]}"
        )

        # Scope read (IDOR guard): a missing / foreign-model layer is 404, and
        # never mints a new formation for a layer we cannot repoint.
        pre = await self._session.get(LithoLayerOrm, layer_id)
        if pre is None or pre.model_id != model_id:
            self.warning(
                f"EditLithoLayerComposition: layer={layer_id} not found in model {model_id}"
            )
            return None

        # Find-or-create the target unit (shared with the accept path). Flushed
        # into this session so the PATCH's commit persists both together.
        formation, created = await resolve_litho_formation(
            self._session,
            project_id=project_id,
            litho_main_soil_code=litho_main_soil_code,
            admixtures=admixtures,
        )
        if formation.id == pre.formation_id:
            # Already this composition — nothing to write. Return the row as-is
            # so the caller still gets a 200 with the current layer.
            self.debug(
                f"EditLithoLayerComposition: layer={layer_id} already on formation "
                f"{formation.id} — no-op"
            )
            return pre
        self.debug(
            f"EditLithoLayerComposition: formation "
            f"{'created' if created else 'reused'} {formation.id} for the target composition"
        )

        # Repoint through the existing PATCH use case (formation_id only — depths,
        # anchor and status kept). It takes the body-partition lock, marks the
        # 3-D solid cache stale, and commits (persisting the new formation too).
        updated = await UpdateLithoLayer(self._session).execute(
            layer_id, {"formation_id": formation.id}, model_id=model_id
        )
        if updated is None:
            return None

        # Composition drives body membership — re-derive ordinals + body_id.
        await ResolveLithoInstances(self._session).execute(model_id=model_id, commit=True)
        await self._session.refresh(updated)
        self.success(f"EditLithoLayerComposition ok layer={layer_id} → formation {formation.id}")
        return updated
