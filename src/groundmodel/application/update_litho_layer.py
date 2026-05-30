"""Update-litho-layer use case (Slice A2 of the unified litho boundary model).

PATCH a single ``litho_layer`` row's depth / formation / status /
confidence / anchor / coupling / notes. Routes through the application
layer so future cross-cutting concerns (audit log, refetch triggers,
side-effects on the geo↔litho coupling) have one seam to plug into.

Trust-the-caller: the Pydantic request schema enforces depth ordering
+ the literal allowlists; the DB CHECK constraints are the safety
net. This use case is a thin wrapper over the repository's update.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (
    LithoLayerRepository,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class UpdateLithoLayer(GroundModelLogger):
    """Apply a partial update to one ``litho_layer`` row + commit."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session
        self._repo = LithoLayerRepository(session)

    async def execute(
        self,
        layer_id: UUID,
        patch: dict[str, object],
    ) -> LithoLayerOrm | None:
        """Mutate the layer and commit.

        Parameters
        ----------
        layer_id : UUID
            Target row.
        patch : dict
            Column-name → new-value pairs. Empty patch = no-op (returns
            the unchanged row).

        Returns
        -------
        LithoLayerOrm | None
            The updated row, or ``None`` when the id does not exist.
        """
        self.debug(f"UpdateLithoLayer: id={layer_id} patch_keys={list(patch.keys())}")
        layer = await self._repo.update_layer(layer_id, patch)
        if layer is None:
            self.warning(f"UpdateLithoLayer: id={layer_id} not found")
            return None
        await self._session.commit()
        # onupdate=func.now() on updated_at expires the in-memory value
        # at flush; refresh so Pydantic's response serializer doesn't
        # try a lazy-load outside the async greenlet (MissingGreenlet).
        await self._session.refresh(layer)
        self.success(f"UpdateLithoLayer ok id={layer_id}")
        return layer
