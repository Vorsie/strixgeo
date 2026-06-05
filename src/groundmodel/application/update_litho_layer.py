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

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (
    LithoLayerRepository,
)
from groundmodel.shared.exceptions import LithoLayerOverlapError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# The exclusion constraint added in f7a8b9c0d1e2 — its name appears verbatim in
# the asyncpg error text, so we can tell it apart from any other integrity
# violation and translate only this one into a clean domain error.
_NO_OVERLAP_CONSTRAINT = "litho_layer_accepted_no_overlap"


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

        Raises
        ------
        LithoLayerOverlapError
            When the edit would overlap an accepted sibling on the same
            investigation (the deferred no-overlap exclusion constraint fires
            at commit). Any other integrity error propagates unchanged.
        """
        self.debug(f"UpdateLithoLayer: id={layer_id} patch_keys={list(patch.keys())}")
        layer = await self._repo.update_layer(layer_id, patch)
        if layer is None:
            self.warning(f"UpdateLithoLayer: id={layer_id} not found")
            return None
        try:
            await self._session.commit()
        except IntegrityError as err:
            await self._session.rollback()
            if _NO_OVERLAP_CONSTRAINT in str(err.orig):
                self.warning(
                    f"UpdateLithoLayer: id={layer_id} rejected — edit would overlap "
                    "an accepted layer on the same investigation"
                )
                raise LithoLayerOverlapError(layer_id) from err
            raise
        # onupdate=func.now() on updated_at expires the in-memory value
        # at flush; refresh so Pydantic's response serializer doesn't
        # try a lazy-load outside the async greenlet (MissingGreenlet).
        await self._session.refresh(layer)
        self.success(f"UpdateLithoLayer ok id={layer_id}")
        return layer
